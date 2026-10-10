/**
 * journey.ts — where a learner actually is on their chosen path, derived.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `lib/onboarding/steps.ts` defines three paths of 3–6 steps and exports
 * `nextStep(path, completedSteps)`. Nothing in the product ever put a path
 * step id into `completedSteps`: the only ids ever written are
 * `first-circuit` and `onboarding-complete`. So `nextStep` returned step 1
 * forever, and the resume banner — the one surface a returning learner sees —
 * said "pick up where you left off" while pointing at the thing they finished
 * on day one. Progress was not merely invisible, it was wrong.
 *
 * The fix is derivation rather than more bookkeeping. Every step already
 * leaves a trace somewhere the learner's own device: a completed lesson in
 * `lib/lessons/progress`, a solved challenge in `lib/challenges/types`, a
 * `viz.opened` / `circuit.run` / `hardware.submitted` event in the local
 * analytics buffer. Reading those is free, needs no new instrumentation in
 * components owned by other workstreams, and cannot drift out of sync with
 * what the learner actually did.
 *
 * ── PRIVACY ───────────────────────────────────────────────────────────────
 * Pure functions over data the caller already holds. No `window`, no
 * `fetch`, no storage access, nothing new recorded and nothing transmitted.
 * This module reads the same local buffer /insights reads and adds no event
 * to the closed taxonomy in `events.ts`. See docs/ANALYTICS.md.
 *
 * ── WHY IT LIVES IN lib/analytics ─────────────────────────────────────────
 * It is a reducer over `AnalyticsEvent[]`, which is what this directory is
 * for, and `lib/onboarding/**` belongs to another workstream in the current
 * split. Only type/data imports flow the other way.
 */

import type { AnalyticsEvent } from '@/lib/analytics/events'
import type { ProgressMap } from '@/lib/challenges/types'
import type { Progress } from '@/lib/lessons/progress'
import type { OnboardingPath } from '@/lib/onboarding/state'
import { PATHS, type OnboardingStep } from '@/lib/onboarding/steps'

/** Everything the status of a step can be decided from. */
export interface JourneyEvidence {
  /** Lesson slugs marked complete (course progress ∪ `lesson.completed`). */
  lessonsCompleted: ReadonlySet<string>
  /** Visualization slugs seen, from `viz.opened` / `viz.interacted`. */
  vizOpened: ReadonlySet<string>
  /** Challenge ids with `solved: true`. */
  challengesSolved: ReadonlySet<string>
  /** How many `circuit.run` events are in the buffer. */
  circuitRuns: number
  /** How many `hardware.submitted` events are in the buffer. */
  hardwareSubmissions: number
}

export const EMPTY_EVIDENCE: JourneyEvidence = {
  lessonsCompleted: new Set(),
  vizOpened: new Set(),
  challengesSolved: new Set(),
  circuitRuns: 0,
  hardwareSubmissions: 0,
}

/**
 * `done`    — the learner demonstrably did the thing (finished the lesson,
 *             solved the challenge, ran a circuit). Evidence, not a click.
 * `visited` — they followed the link from the resume banner. Not the same as
 *             doing it, so it is never counted as progress; it exists only so
 *             the "next" pointer moves on instead of re-offering the same step
 *             every single page load, which is what made the banner a nag.
 * `todo`    — neither.
 */
export type StepStatus = 'done' | 'visited' | 'todo'

export interface JourneyStep {
  step: OnboardingStep
  status: StepStatus
}

export interface JourneyProgress {
  steps: JourneyStep[]
  /** Steps with real evidence behind them. Never counts `visited`. */
  completed: number
  total: number
  /** The step to offer next, or null when every step is `done`. */
  next: OnboardingStep | null
  /** True only when every step has evidence. */
  allDone: boolean
}

// ── evidence ──────────────────────────────────────────────────

/**
 * Fold the local signals into one evidence bundle.
 *
 * `lessonsCompleted` unions the course progress store with `lesson.completed`
 * events because the two can legitimately disagree: the analytics buffer is a
 * 1,000-event ring that drops its oldest entries, and the progress store
 * survives an analytics opt-out (which deletes the buffer outright). Taking
 * the union means turning analytics off never erases visible progress.
 */
export function collectEvidence(
  events: readonly AnalyticsEvent[],
  lessons: Progress,
  challenges: ProgressMap
): JourneyEvidence {
  const lessonsCompleted = new Set<string>(lessons.completed)
  const vizOpened = new Set<string>()
  const challengesSolved = new Set<string>()
  let circuitRuns = 0
  let hardwareSubmissions = 0

  for (const event of events) {
    const slug = typeof event.props.slug === 'string' ? event.props.slug : ''
    switch (event.name) {
      case 'lesson.completed':
        if (slug) lessonsCompleted.add(slug)
        break
      case 'viz.opened':
      case 'viz.interacted':
        if (slug) vizOpened.add(slug)
        break
      case 'circuit.run':
        circuitRuns += 1
        break
      case 'hardware.submitted':
        hardwareSubmissions += 1
        break
      default:
        break
    }
  }

  for (const [id, entry] of Object.entries(challenges)) {
    if (entry.solved) challengesSolved.add(id)
  }

  return { lessonsCompleted, vizOpened, challengesSolved, circuitRuns, hardwareSubmissions }
}

/** `/learn/interference?x=1#y` → `['learn', 'interference']`. */
function segments(href: string): string[] {
  const path = href.split(/[?#]/)[0]
  return path.split('/').filter((part) => part.length > 0)
}

/**
 * Is there evidence this step was actually done?
 *
 * Steps are matched by their `href`, not by a hand-maintained second table —
 * a step whose href changes keeps working, and a step pointing somewhere with
 * no signal returns false rather than guessing.
 *
 * KNOWN IMPRECISION, deliberately not papered over: the developer path has two
 * steps on `/simulator` ("Bell state" and "Export OpenQASM 3"), so one run
 * satisfies both. There is no export event in the taxonomy, and adding one
 * that no component emits would be a decorative event and a worse lie than
 * this one. If an export event is ever wired up for real, special-case
 * `developer/qasm` here.
 */
export function hasEvidence(step: OnboardingStep, evidence: JourneyEvidence): boolean {
  const parts = segments(step.href)
  const [root, child] = parts

  switch (root) {
    case 'learn':
      return child !== undefined && evidence.lessonsCompleted.has(child)
    case 'visualizations':
      return child !== undefined && evidence.vizOpened.has(child)
    case 'challenges':
      return child === undefined
        ? evidence.challengesSolved.size > 0
        : evidence.challengesSolved.has(child)
    case 'simulator':
      return evidence.circuitRuns > 0
    case 'hardware':
      return evidence.hardwareSubmissions > 0
    default:
      return false
  }
}

export function stepStatus(
  step: OnboardingStep,
  evidence: JourneyEvidence,
  visitedIds: readonly string[]
): StepStatus {
  if (hasEvidence(step, evidence)) return 'done'
  return visitedIds.includes(step.id) ? 'visited' : 'todo'
}

/**
 * The whole path, resolved.
 *
 * `next` prefers the first `todo`; if every remaining step has only been
 * visited it falls back to the first of those, so the banner still has
 * somewhere to send them rather than vanishing mid-path. Only when every step
 * has real evidence does `next` become null.
 */
export function journeyProgress(
  path: OnboardingPath | null,
  evidence: JourneyEvidence,
  visitedIds: readonly string[] = []
): JourneyProgress {
  if (path === null) {
    return { steps: [], completed: 0, total: 0, next: null, allDone: false }
  }

  const steps: JourneyStep[] = PATHS[path].steps.map((step) => ({
    step,
    status: stepStatus(step, evidence, visitedIds),
  }))

  const completed = steps.filter((s) => s.status === 'done').length
  const next =
    steps.find((s) => s.status === 'todo')?.step ??
    steps.find((s) => s.status === 'visited')?.step ??
    null

  return {
    steps,
    completed,
    total: steps.length,
    next,
    allDone: steps.length > 0 && completed === steps.length,
  }
}
