/**
 * Due-count for the review queue — "how many cards are waiting?", answered
 * from this device only.
 *
 * Client-safe on purpose: the question pool is built from the structural
 * OUTLINES in lib/lessons (block kinds + quiz question ids, no text), so this
 * module can sit in the global client graph without dragging lesson bodies
 * into the bundle — the boundary lib/lessons/bundle.test.ts enforces.
 *
 * The number is information, not leverage (docs/ONBOARDING.md): callers may
 * say "5 cards due" and must never turn it into urgency, debt, or a streak to
 * defend.
 */

import { LESSONS } from '@/lib/lessons'
import { isLessonFree } from '@/lib/lessons/access'
import {
  cardKey,
  dueKeys,
  loadSchedule,
  seedFromQuizScores,
  type ReviewSchedule,
} from '@/lib/review/scheduler'
import { loadProgress } from '@/lib/lessons/progress'

/**
 * Quiz question ids per reviewable lesson. Only free (foundations) lessons
 * qualify: /review renders question text into a public page, and the advanced
 * track's text is entitlement-gated — see lib/lessons/access.ts.
 */
export function reviewableQuestionIdsByLesson(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const lesson of LESSONS) {
    if (!isLessonFree(lesson.slug)) continue
    const ids = lesson.blocks.flatMap((block) =>
      block.kind === 'quiz' ? block.questions.map((q) => q.id) : [],
    )
    if (ids.length > 0) out[lesson.slug] = ids
  }
  return out
}

/** Every reviewable card key, in course order. */
export function reviewableKeys(): string[] {
  const byLesson = reviewableQuestionIdsByLesson()
  return Object.keys(byLesson).flatMap((slug) =>
    byLesson[slug]!.map((id) => cardKey(slug, id)),
  )
}

/**
 * Pure core: cards due at `now`, given a schedule and quiz scores. The clock
 * is an argument, per the scheduler's no-Date.now rule.
 */
export function countDue(
  schedule: ReviewSchedule,
  quizScores: Record<string, number>,
  now: Date,
): number {
  const byLesson = reviewableQuestionIdsByLesson()
  const seeded = seedFromQuizScores(schedule, quizScores, byLesson, now)
  return dueKeys(seeded, reviewableKeys(), now).length
}

/**
 * Convenience for UI: read localStorage and count. SSR-safe (0 on the
 * server), so callers still follow the render-empty-then-effect rule from
 * lib/lessons/progress.ts.
 */
export function loadDueCount(now: Date): number {
  if (typeof window === 'undefined') return 0
  return countDue(loadSchedule(), loadProgress().quizScores, now)
}
