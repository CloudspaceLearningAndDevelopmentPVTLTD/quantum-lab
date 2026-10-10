/**
 * sessionPlan.ts — a compact, structured study plan for the tutor's context.
 *
 * The coach page shows the learner three ranked cards; the tutor needs the same
 * opinion in a shape a model can read. This module turns the SAME inputs the
 * coach page uses (local progress, quiz scores, exam attempts) into a small
 * JSON-serialisable plan: which skills are weak, which concepts come next, and
 * a four-step session (diagnose → teach → practice → check) with concrete
 * references — a lesson slug, a challenge id, or a viz route — for each step.
 *
 * It does not re-decide anything. The ranking IS `recommend()` from
 * ./recommend.ts, imported and called, never copied: if the coach's rules
 * change, the tutor's plan changes with them, and the two can never disagree.
 * Everything here is deterministic and offline — same progress, same plan.
 *
 * PRIVACY SHAPE: this runs in the browser, on browser-local data. What leaves
 * the device is only the returned plan (a handful of slugs and rounded
 * mastery numbers), and only when the learner has the tutor's "share my skill
 * map" switch on. Raw progress never goes anywhere. Keep it that way: never
 * add free-text fields, timestamps, or anything a learner typed to this shape.
 */

import { CHALLENGES } from '@/lib/challenges/catalogue'
import type { ExamAttempt } from '@/lib/exams/types'
import type { Progress } from '@/lib/lessons/progress'
import { nodeFor, SIMULATOR_SLUG, topologicalOrder } from './graph'
import {
  MASTERY_THRESHOLD,
  masteryByConcept,
  recommend,
  type CoachSignals,
} from './recommend'

export type PlanStepKind = 'diagnose' | 'teach' | 'practice' | 'check'

/** A concrete destination. At least one field is always set. */
export interface PlanRef {
  lessonSlug?: string
  challengeId?: string
  /** An app route, e.g. '/simulator' or '/visualizations/bloch-sphere'. */
  vizRoute?: string
}

export interface PlanStep {
  kind: PlanStepKind
  ref: PlanRef
  /** One short sentence the tutor can lean on. Derived, never learner-typed. */
  note: string
}

export interface WeakSkill {
  /** Concept id — identical to the lesson slug throughout CONCEPT_GRAPH. */
  id: string
  /** Mastery 0..1, rounded to 2dp so the serialised plan stays compact. */
  mastery: number
}

export interface SessionPlan {
  weakSkills: WeakSkill[]
  nextConcepts: string[]
  suggestedSession: PlanStep[]
}

function label(slug: string): string {
  return nodeFor(slug)?.label ?? slug
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The first challenge that drills `slug`, in catalogue declaration order —
 * stable because the catalogue is data and its tests pin every entry. Falls
 * back to the concept's first visualization (or the simulator) when no
 * challenge exists for it, so `practice` always has somewhere real to point.
 */
function practiceRefFor(slug: string): PlanRef | null {
  const challenge = CHALLENGES.find((c) => c.lessonSlug === slug)
  if (challenge) return { lessonSlug: slug, challengeId: challenge.id }
  const viz = nodeFor(slug)?.vizSlugs[0]
  if (viz === undefined) return null
  return {
    lessonSlug: slug,
    vizRoute: viz === SIMULATOR_SLUG ? '/simulator' : `/visualizations/${viz}`,
  }
}

/**
 * Build the plan. Same argument shape as `recommend()` on purpose — a call
 * site that can rank cards can build a plan, with nothing extra to fetch.
 *
 * Empty progress is not special-cased: `recommend()` already answers a blank
 * slate with the first zero-prerequisite lesson, so a brand-new learner gets a
 * "start here" plan (teach → practice → check on 'what-is-a-qubit') out of the
 * same code path the tests pin exactly.
 */
export function buildSessionPlan(
  progress: Progress,
  examAttempts: readonly ExamAttempt[],
  goal?: string,
  signals?: CoachSignals
): SessionPlan {
  const mastery = masteryByConcept(progress, examAttempts)

  // Weak = STARTED and below the mastery bar. An untouched concept is not
  // "weak", it is simply next — listing all of them would tell the tutor the
  // learner is bad at things they have never seen.
  const started = new Set([...progress.completed, ...Object.keys(progress.quizScores)])
  const weakSkills: WeakSkill[] = topologicalOrder()
    .filter((id) => started.has(id) && (mastery[id] ?? 0) < MASTERY_THRESHOLD)
    .map((id) => ({ id, mastery: round2(mastery[id] ?? 0) }))

  const recs = recommend(progress, examAttempts, goal, signals)

  const revise = recs.find((r) => r.kind === 'revise' && r.lessonSlug !== undefined)
  const advances = recs.filter((r) => r.kind === 'advance' && r.lessonSlug !== undefined)
  const nextConcepts = advances.map((r) => r.lessonSlug as string)

  // Course finished (or nothing rankable at all): an honest empty session
  // beats inventing steps the recommender did not ask for.
  const teachSlug = advances[0]?.lessonSlug
  const focusSlug = revise?.lessonSlug ?? teachSlug
  if (focusSlug === undefined) {
    return { weakSkills, nextConcepts, suggestedSession: [] }
  }

  const suggestedSession: PlanStep[] = []

  // diagnose — only when the recommender's top rule found shaky ground.
  if (revise?.lessonSlug !== undefined) {
    suggestedSession.push({
      kind: 'diagnose',
      ref: { lessonSlug: revise.lessonSlug },
      note: `Retake the "${label(revise.lessonSlug)}" quiz to pin down the gap — the last score was below the 70% bar.`,
    })
  }

  // teach — the recommender's top ADVANCE, which already respects goals and
  // prerequisites. Absent only when revising is the whole session.
  if (teachSlug !== undefined) {
    suggestedSession.push({
      kind: 'teach',
      ref: { lessonSlug: teachSlug },
      note: `Read "${label(teachSlug)}" next — every prerequisite for it is met.`,
    })
  }

  // practice — drill the weakest thing on the table, not the newest: doing
  // outranks reading, and a wobbly foundation needs the reps more.
  const practiceRef = practiceRefFor(focusSlug)
  if (practiceRef !== null) {
    suggestedSession.push({
      kind: 'practice',
      ref: practiceRef,
      note:
        practiceRef.challengeId !== undefined
          ? `Apply "${label(focusSlug)}" hands-on in this challenge.`
          : `See "${label(focusSlug)}" move instead of only reading about it.`,
    })
  }

  // check — close the loop on the session's focus with its quiz.
  suggestedSession.push({
    kind: 'check',
    ref: { lessonSlug: focusSlug },
    note: `Finish with the "${label(focusSlug)}" quiz to confirm it stuck.`,
  })

  return { weakSkills, nextConcepts, suggestedSession }
}
