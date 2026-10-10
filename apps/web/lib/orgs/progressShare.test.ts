/**
 * progressShare.test.ts — the disclosure and the bounds on a shared snapshot.
 *
 * The first test is the important one and it is not about code correctness: it
 * fails if someone adds a field to ProgressSnapshot without adding a line to the
 * sentence a learner is shown before they consent. A snapshot that quietly grows
 * wider than its own disclosure is exactly the failure this feature exists to
 * avoid.
 */

import { describe, expect, it } from 'vitest'
import { emptySnapshot } from '@/lib/orgs/assignments'
import {
  MAX_ID_LENGTH,
  MAX_QUIZ_ENTRIES,
  MAX_SNAPSHOT_IDS,
  SHARED_FIELDS,
  SNAPSHOT_FIELDS,
  describeSnapshot,
  normalizeSnapshot,
} from '@/lib/orgs/progressShare'

describe('the disclosure', () => {
  it('has exactly one plain-words line per field of the snapshot', () => {
    // If this fails, either a field was added to ProgressSnapshot without
    // telling the learner about it, or a line was removed. Fix the list, not
    // the test.
    expect(SHARED_FIELDS).toHaveLength(SNAPSHOT_FIELDS.length)
    expect(SNAPSHOT_FIELDS).toEqual(Object.keys(emptySnapshot()))
  })

  it('names every field of a snapshot in the summary a learner is shown', () => {
    const text = describeSnapshot(
      normalizeSnapshot({
        lessons: ['a'],
        quizScores: { a: 3 },
        challenges: ['b', 'c'],
        exams: ['d'],
      })
    )
    expect(text).toContain('1 lesson complete')
    expect(text).toContain('1 quiz score')
    expect(text).toContain('2 challenges solved')
    expect(text).toContain('1 exam passed')
  })
})

describe('normalizeSnapshot', () => {
  it('turns anything unrecognisable into an empty snapshot rather than throwing', () => {
    expect(normalizeSnapshot(null)).toEqual(emptySnapshot())
    expect(normalizeSnapshot('lessons')).toEqual(emptySnapshot())
    expect(normalizeSnapshot([1, 2, 3])).toEqual(emptySnapshot())
  })

  it('keeps the good parts of a partly malformed payload', () => {
    const snapshot = normalizeSnapshot({
      lessons: ['a', 42, '', 'a', 'b'],
      quizScores: { a: 3, b: 'four', c: Number.NaN, d: -1 },
      challenges: 'not-an-array',
      exams: ['e'],
    })
    expect(snapshot.lessons).toEqual(['a', 'b'])
    expect(snapshot.quizScores).toEqual({ a: 3 })
    expect(snapshot.challenges).toEqual([])
    expect(snapshot.exams).toEqual(['e'])
  })

  it('bounds every list, so a POST cannot become a key-value store', () => {
    const many = Array.from({ length: MAX_SNAPSHOT_IDS + 50 }, (_, i) => `id-${i}`)
    expect(normalizeSnapshot({ lessons: many }).lessons).toHaveLength(MAX_SNAPSHOT_IDS)

    const long = 'x'.repeat(MAX_ID_LENGTH + 1)
    expect(normalizeSnapshot({ lessons: [long] }).lessons).toEqual([])

    const scores: Record<string, number> = {}
    for (let i = 0; i < MAX_QUIZ_ENTRIES + 20; i += 1) scores[`s${i}`] = 1
    expect(Object.keys(normalizeSnapshot({ quizScores: scores }).quizScores)).toHaveLength(
      MAX_QUIZ_ENTRIES
    )
  })

  it('sorts ids, so an unchanged snapshot serialises identically every time', () => {
    const a = normalizeSnapshot({ lessons: ['b', 'a'], challenges: ['z', 'y'] })
    const b = normalizeSnapshot({ lessons: ['a', 'b'], challenges: ['y', 'z'] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
