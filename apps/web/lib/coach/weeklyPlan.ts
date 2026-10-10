/**
 * weeklyPlan.ts — the persistent multi-week learning plan behind the coach.
 *
 * Where `recommend()` answers "what now?" and `sessionPlan.ts` answers "what
 * this sitting?", this module answers "what does the road to my goal look
 * like?": week-sized buckets of two to four concrete items — read a lesson,
 * solve a challenge, review a quiz — ordered so that nothing ever appears
 * before its prerequisites.
 *
 * DESIGN RULES (the same contract as lib/review/scheduler.ts):
 *  · Every planning function is PURE and takes the clock as a `Date` argument.
 *    No `Date.now()`, no `new Date()` — same evidence, same goal, same clock,
 *    same plan, byte for byte. Only the storage functions at the bottom touch
 *    the browser, and they are SSR-safe no-ops on the server.
 *  · Re-planning is NON-DESTRUCTIVE. When new evidence arrives (a lesson
 *    finished, a challenge solved, a quiz passed) or the goal changes, items
 *    already done keep their tick and their week; only the undone tail is
 *    recomputed and re-bucketed. A plan is never reset wholesale — history is
 *    the learner's, not the planner's.
 *  · A tick is DERIVED from real evidence (lesson progress, challenge store,
 *    mastery), never from a checkbox click — the plan reports what happened,
 *    it does not take dictation. And once earned, a tick is permanent: mastery
 *    later drifting below the bar surfaces as a *revise* recommendation on the
 *    coach cards, not as work silently un-done here. Un-ticking finished work
 *    is exactly the "lost progress" pattern docs/ONBOARDING.md forbids.
 *  · "This week" is the first week with something left in it — not a calendar
 *    countdown. A learner away for a month comes back to the same next step,
 *    with nothing expired and nothing reset (docs/ONBOARDING.md again: absence
 *    is met with orientation, not a scolding).
 *
 * The concept ordering is the graph's (`ancestorsOf`/`topologicalOrder`) and
 * the mastery bar is the recommender's (`MASTERY_THRESHOLD`) — imported, never
 * copied, so this plan can never disagree with the coach cards above it.
 */

import { CHALLENGES } from '@/lib/challenges/catalogue'
import type { ExamAttempt } from '@/lib/exams/types'
import type { Progress } from '@/lib/lessons/progress'
import { ancestorsOf, nodeFor, topologicalOrder } from './graph'
import { MASTERY_THRESHOLD, masteryByConcept } from './recommend'

export type PlanItemKind = 'lesson' | 'challenge' | 'review'

export interface PlanItem {
  /** Stable identity across re-plans: `lesson:<slug>`, `challenge:<id>`, `review:<slug>`. */
  id: string
  kind: PlanItemKind
  /** The concept this item serves — always a CONCEPT_GRAPH id. */
  lessonSlug: string
  /** Set only for kind 'challenge'. */
  challengeId?: string
  /** Short human label, derived from graph/catalogue data, never learner-typed. */
  label: string
  /** Derived from evidence at the last refresh; once true, stays true. */
  done: boolean
}

export interface PlanWeek {
  items: PlanItem[]
}

export interface WeeklyPlan {
  /** Concept id the plan aims at, or '' for the whole default curriculum. */
  goal: string
  /** ISO instant the plan was first created; survives every refresh. */
  startedAt: string
  /** ISO instant of the last refresh. */
  updatedAt: string
  weeks: PlanWeek[]
}

/** The single localStorage key the whole weekly-plan system uses. */
export const WEEKLY_PLAN_KEY = 'quantum-lab.weekly-plan'

/** A week holds at most this many items; concept groups (2-3 items) never split. */
export const MAX_ITEMS_PER_WEEK = 4

/**
 * Everything a tick can be derived from. All three live in this browser
 * already; the caller reads them and hands them over so this module stays pure.
 */
export interface PlanEvidence {
  progress: Progress
  examAttempts: readonly ExamAttempt[]
  /** Ids of solved challenges, from lib/challenges/types.ts `readProgress()`. */
  solvedChallengeIds: readonly string[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * Path → items
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The concepts the plan must cover, earliest prerequisite first. A goal prunes
 * the path to the goal's ancestor chain plus the goal itself; no goal (or an
 * unknown one) means the whole curriculum in dependency order.
 */
function conceptPath(goal: string): string[] {
  if (goal !== '' && nodeFor(goal) !== undefined) {
    return [...ancestorsOf(goal), goal]
  }
  return topologicalOrder()
}

/**
 * One concept's items, in the order you would do them: read it, drill it,
 * prove it. The challenge is the first catalogue entry for the concept —
 * declaration order is stable, the catalogue's tests pin every entry — and is
 * simply absent for concepts with no challenge, so a group is 2 or 3 items.
 */
function itemsForConcept(slug: string): PlanItem[] {
  const label = nodeFor(slug)?.label ?? slug
  const items: PlanItem[] = [
    { id: `lesson:${slug}`, kind: 'lesson', lessonSlug: slug, label: `Read "${label}"`, done: false },
  ]
  const challenge = CHALLENGES.find((c) => c.lessonSlug === slug)
  if (challenge) {
    items.push({
      id: `challenge:${challenge.id}`,
      kind: 'challenge',
      lessonSlug: slug,
      challengeId: challenge.id,
      label: `Challenge: ${challenge.title}`,
      done: false,
    })
  }
  items.push({
    id: `review:${slug}`,
    kind: 'review',
    lessonSlug: slug,
    label: `Review "${label}"`,
    done: false,
  })
  return items
}

/**
 * Is this item done, on today's evidence?
 *  · lesson    — the lesson is marked complete
 *  · challenge — that challenge is solved in the challenge store
 *  · review    — the concept sits at or above the coach's 80% mastery bar,
 *                which needs a passed quiz or a strong exam, not just reading
 */
function evidencedDone(
  item: PlanItem,
  evidence: PlanEvidence,
  mastery: Record<string, number>
): boolean {
  switch (item.kind) {
    case 'lesson':
      return evidence.progress.completed.includes(item.lessonSlug)
    case 'challenge':
      return item.challengeId !== undefined &&
        evidence.solvedChallengeIds.includes(item.challengeId)
    case 'review':
      return (mastery[item.lessonSlug] ?? 0) >= MASTERY_THRESHOLD
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Build / refresh
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Produce or refresh the plan. `prev === null` builds from scratch; otherwise
 * the previous plan's DONE items are kept exactly where they were (week and
 * tick both), and only the undone tail is recomputed from the goal and
 * today's evidence:
 *
 *  1. Each previous week is stripped to its done items (a tick from an earlier
 *     refresh is kept even if today's evidence has shifted — see the header).
 *     Weeks left with nothing are dropped; weeks with history stay put.
 *  2. The goal's concept path is walked in prerequisite order; every item not
 *     already kept becomes part of the pending tail, pre-ticked when the
 *     evidence already covers it (work done outside the plan still counts).
 *  3. Pending items are appended concept-group by concept-group, topping up
 *     the final week while the group fits under MAX_ITEMS_PER_WEEK and opening
 *     a new week when it does not. Groups never split across weeks, so a week
 *     is always a coherent 2-4 items.
 *
 * A goal change is not a special case: step 2 simply walks a different path,
 * so the finished head survives and only the road ahead is redrawn.
 */
export function refreshWeeklyPlan(
  prev: WeeklyPlan | null,
  goal: string,
  evidence: PlanEvidence,
  now: Date
): WeeklyPlan {
  const mastery = masteryByConcept(evidence.progress, evidence.examAttempts)

  // 1 — keep the done history in place.
  const weeks: PlanWeek[] = []
  const keptIds = new Set<string>()
  for (const week of prev?.weeks ?? []) {
    const done = week.items
      .filter((item) => item.done || evidencedDone(item, evidence, mastery))
      .map((item) => ({ ...item, done: true }))
    if (done.length === 0) continue
    for (const item of done) keptIds.add(item.id)
    weeks.push({ items: done })
  }

  // 2 — the pending tail, in prerequisite order, ticked where evidence says so.
  const pendingGroups: PlanItem[][] = []
  for (const slug of conceptPath(goal)) {
    const group = itemsForConcept(slug)
      .filter((item) => !keptIds.has(item.id))
      .map((item) => ({ ...item, done: evidencedDone(item, evidence, mastery) }))
    if (group.length > 0) pendingGroups.push(group)
  }

  // 3 — bucket the tail. Only the last week is ever topped up, so history
  // weeks in the middle are never disturbed.
  for (const group of pendingGroups) {
    const last = weeks[weeks.length - 1]
    if (last !== undefined && last.items.length + group.length <= MAX_ITEMS_PER_WEEK) {
      last.items.push(...group)
    } else {
      weeks.push({ items: group })
    }
  }

  return {
    goal,
    startedAt: prev?.startedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    weeks,
  }
}

/** Build a plan from nothing — sugar over `refreshWeeklyPlan(null, …)`. */
export function buildWeeklyPlan(
  goal: string,
  evidence: PlanEvidence,
  now: Date
): WeeklyPlan {
  return refreshWeeklyPlan(null, goal, evidence, now)
}

/**
 * The week to show: the FIRST week with anything left in it, or the last week
 * when everything is done. Deliberately not calendar arithmetic — a plan that
 * says "you are on week 5 and did none of it" is a scolding, and this product
 * does not do those (docs/ONBOARDING.md).
 */
export function currentWeekIndex(plan: WeeklyPlan): number {
  const index = plan.weeks.findIndex((week) => week.items.some((item) => !item.done))
  return index === -1 ? Math.max(0, plan.weeks.length - 1) : index
}

/** Where clicking an item goes. Reviews all funnel to /review by design. */
export function destinationForItem(item: PlanItem): string {
  if (item.kind === 'challenge' && item.challengeId !== undefined) {
    return `/challenges/${item.challengeId}`
  }
  if (item.kind === 'review') return '/review'
  return `/learn/${item.lessonSlug}`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Storage. Same contract as lib/review/scheduler.ts: SSR-safe, never throws,
 * corrupt JSON reads as "no plan" so the caller rebuilds from evidence.
 * ──────────────────────────────────────────────────────────────────────────── */

const ITEM_KINDS: readonly PlanItemKind[] = ['lesson', 'challenge', 'review']

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    (ITEM_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.lessonSlug === 'string' &&
    (v.challengeId === undefined || typeof v.challengeId === 'string') &&
    typeof v.label === 'string' &&
    typeof v.done === 'boolean'
  )
}

/**
 * Coerce unknown parsed JSON into a plan, or null when it is beyond saving.
 * Malformed ITEMS are dropped one at a time — a single hand-edited entry
 * should not erase the whole history — but a structurally broken plan (no
 * weeks array, unparseable dates) reads as absent so it gets rebuilt.
 */
export function normalizeWeeklyPlan(raw: unknown): WeeklyPlan | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (
    typeof p.goal !== 'string' ||
    typeof p.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.startedAt)) ||
    typeof p.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.updatedAt)) ||
    !Array.isArray(p.weeks)
  ) {
    return null
  }
  const weeks: PlanWeek[] = []
  for (const week of p.weeks) {
    if (typeof week !== 'object' || week === null) continue
    const items = (week as Record<string, unknown>).items
    if (!Array.isArray(items)) continue
    const kept = items.filter(isPlanItem).map((item) => ({
      id: item.id,
      kind: item.kind,
      lessonSlug: item.lessonSlug,
      ...(item.challengeId !== undefined ? { challengeId: item.challengeId } : {}),
      label: item.label,
      done: item.done,
    }))
    if (kept.length > 0) weeks.push({ items: kept })
  }
  return { goal: p.goal, startedAt: p.startedAt, updatedAt: p.updatedAt, weeks }
}

export function loadWeeklyPlan(): WeeklyPlan | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(WEEKLY_PLAN_KEY)
    if (!raw) return null
    return normalizeWeeklyPlan(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

export function saveWeeklyPlan(plan: WeeklyPlan): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(plan))
  } catch {
    // Quota or disabled storage — the in-memory plan still serves this
    // session; carry on, exactly as lib/review/scheduler.ts does.
  }
}
