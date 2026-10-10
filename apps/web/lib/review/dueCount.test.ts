/**
 * Tests for the due-count util. Runs against the REAL course metadata (the
 * client-safe outlines in lib/lessons), so the pool reflects what /review will
 * actually offer; the clock is always injected, per the scheduler's rule.
 */

import { describe, expect, it } from 'vitest'
import { LESSONS } from '@/lib/lessons'
import { isLessonFree } from '@/lib/lessons/access'
import { emptySchedule, gradeInSchedule, seedFromQuizScores } from './scheduler'
import { countDue, reviewableKeys, reviewableQuestionIdsByLesson } from './dueCount'

const T0 = new Date('2026-08-25T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const FREE_QUIZZED = LESSONS.filter(
  (l) => isLessonFree(l.slug) && l.blocks.some((b) => b.kind === 'quiz'),
)

describe('reviewableQuestionIdsByLesson', () => {
  it('covers every free lesson with a quiz, and no paid lesson', () => {
    const byLesson = reviewableQuestionIdsByLesson()
    expect(Object.keys(byLesson).sort()).toEqual(FREE_QUIZZED.map((l) => l.slug).sort())
    for (const slug of Object.keys(byLesson)) {
      expect(isLessonFree(slug)).toBe(true)
      expect(byLesson[slug]!.length).toBeGreaterThan(0)
    }
  })
})

describe('countDue', () => {
  const firstSlug = FREE_QUIZZED[0]!.slug
  const firstIds = reviewableQuestionIdsByLesson()[firstSlug]!

  it('is 0 with nothing quizzed and nothing scheduled', () => {
    expect(countDue(emptySchedule(), {}, T0)).toBe(0)
  })

  it('counts freshly-seeded cards from a quizzed lesson as due now', () => {
    expect(countDue(emptySchedule(), { [firstSlug]: 1 }, T0)).toBe(firstIds.length)
  })

  it('drops a card from the count once graded into the future, until its due date', () => {
    const seeded = seedFromQuizScores(
      emptySchedule(),
      { [firstSlug]: 1 },
      reviewableQuestionIdsByLesson(),
      T0,
    )
    const key = `${firstSlug}:${firstIds[0]!}`
    const graded = gradeInSchedule(seeded, key, true, T0) // due in 1 day
    expect(countDue(graded, { [firstSlug]: 1 }, T0)).toBe(firstIds.length - 1)
    const tomorrow = new Date(T0.getTime() + DAY_MS)
    expect(countDue(graded, { [firstSlug]: 1 }, tomorrow)).toBe(firstIds.length)
  })

  it('ignores quiz scores for paid lessons — their questions are not in the pool', () => {
    expect(countDue(emptySchedule(), { 'not-a-free-lesson': 3 }, T0)).toBe(0)
  })
})

describe('reviewableKeys', () => {
  it('is deterministic and slug-qualified', () => {
    const keys = reviewableKeys()
    expect(keys).toEqual(reviewableKeys())
    expect(keys.every((k) => k.includes(':'))).toBe(true)
  })
})
