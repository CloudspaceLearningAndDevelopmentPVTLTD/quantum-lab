/**
 * progressSync.test.ts — signing in must never lose progress made on either
 * side, so the merge is a union of completions and the best score per quiz.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, getSupabase: () => null }))

const { mergeProgress } = await import('@/lib/lessons/progressSync')

describe('mergeProgress', () => {
  it('keeps every lesson completed on either device', () => {
    const merged = mergeProgress(
      { completed: ['a', 'b'], quizScores: {} },
      { completed: ['b', 'c'], quizScores: {} }
    )
    expect(merged.completed.sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps the best quiz score per lesson', () => {
    const merged = mergeProgress(
      { completed: [], quizScores: { a: 0.5, b: 1 } },
      { completed: [], quizScores: { a: 0.9, c: 0.2 } }
    )
    expect(merged.quizScores).toEqual({ a: 0.9, b: 1, c: 0.2 })
  })

  it("prefers this browser's last-visited lesson, falling back to the account's", () => {
    expect(
      mergeProgress(
        { completed: [], quizScores: {}, lastVisited: 'here' },
        { completed: [], quizScores: {}, lastVisited: 'there' }
      ).lastVisited
    ).toBe('here')
    expect(
      mergeProgress({ completed: [], quizScores: {} }, { completed: [], quizScores: {}, lastVisited: 'there' })
        .lastVisited
    ).toBe('there')
  })
})
