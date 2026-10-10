/**
 * Tests for the SM-2-lite scheduler. Every scheduling function takes the
 * clock as an argument, so all of this runs against fixed instants — a test
 * that read the real clock would be asserting on the weather.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  EASE_MIN,
  EASE_START,
  REVIEW_KEY,
  cardKey,
  dueKeys,
  emptySchedule,
  gradeCard,
  gradeInSchedule,
  loadSchedule,
  newCard,
  normalizeSchedule,
  saveSchedule,
  seedFromQuizScores,
  type ReviewSchedule,
} from './scheduler'

const T0 = new Date('2026-08-25T09:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysFrom(base: Date, iso: string): number {
  return (Date.parse(iso) - base.getTime()) / DAY_MS
}

describe('gradeCard', () => {
  it('walks a new card up 1 → 3 → interval × ease on repeated success', () => {
    const first = gradeCard(newCard(T0), true, T0)
    expect(first.intervalDays).toBe(1)
    expect(daysFrom(T0, first.due)).toBeCloseTo(1)

    const t1 = new Date(T0.getTime() + 1 * DAY_MS)
    const second = gradeCard(first, true, t1)
    expect(second.intervalDays).toBe(3)
    expect(daysFrom(t1, second.due)).toBeCloseTo(3)

    const t2 = new Date(t1.getTime() + 3 * DAY_MS)
    const third = gradeCard(second, true, t2)
    // 3 × ease (≈2.6 after two gains) rounded — strictly longer than before.
    expect(third.intervalDays).toBeGreaterThan(second.intervalDays)
    expect(third.intervalDays).toBe(Math.round(3 * second.ease))
  })

  it('grows ease on success and shrinks it on failure, floored at EASE_MIN', () => {
    const up = gradeCard(newCard(T0), true, T0)
    expect(up.ease).toBeGreaterThan(EASE_START)

    let card = newCard(T0)
    for (let i = 0; i < 20; i++) card = gradeCard(card, false, T0)
    expect(card.ease).toBeCloseTo(EASE_MIN)
  })

  it('resets a mature card to relearning on failure: interval 0, due within the hour', () => {
    let card = newCard(T0)
    card = gradeCard(card, true, T0)
    card = gradeCard(card, true, T0)
    expect(card.intervalDays).toBe(3)

    const failed = gradeCard(card, false, T0)
    expect(failed.intervalDays).toBe(0)
    expect(failed.streak).toBe(0)
    const minutesOut = (Date.parse(failed.due) - T0.getTime()) / 60000
    expect(minutesOut).toBeGreaterThan(0)
    expect(minutesOut).toBeLessThan(60)
  })

  it('treats an unseen card (undefined prev) as new', () => {
    const graded = gradeCard(undefined, true, T0)
    expect(graded.intervalDays).toBe(1)
    expect(graded.streak).toBe(1)
  })
})

describe('dueKeys', () => {
  const keys = ['a:q1', 'a:q2', 'b:q1', 'b:q2']

  function scheduleWith(entries: [string, string][]): ReviewSchedule {
    const s = emptySchedule()
    for (const [key, due] of entries) {
      s.cards[key] = { ease: EASE_START, intervalDays: 1, due, streak: 1 }
    }
    return s
  }

  it('is deterministic given a fixed clock: overdue first, ties by key', () => {
    const s = scheduleWith([
      ['b:q1', '2026-08-24T09:00:00.000Z'], // a day overdue
      ['a:q2', '2026-08-25T08:00:00.000Z'], // an hour overdue
      ['a:q1', '2026-08-25T08:00:00.000Z'], // same instant — key breaks the tie
      ['b:q2', '2026-08-26T09:00:00.000Z'], // tomorrow: not due
    ])
    expect(dueKeys(s, keys, T0)).toEqual(['b:q1', 'a:q1', 'a:q2'])
    // Same inputs, same answer.
    expect(dueKeys(s, keys, T0)).toEqual(dueKeys(s, keys, T0))
  })

  it('moves the boundary with the clock, not with the wall', () => {
    const s = scheduleWith([['a:q1', '2026-08-26T09:00:00.000Z']])
    expect(dueKeys(s, keys, T0)).toEqual([])
    expect(dueKeys(s, keys, new Date(T0.getTime() + DAY_MS))).toEqual(['a:q1'])
  })

  it('drops cards whose key is no longer in the offered pool', () => {
    const s = scheduleWith([['gone:q9', '2026-08-01T00:00:00.000Z']])
    expect(dueKeys(s, keys, T0)).toEqual([])
  })
})

describe('seedFromQuizScores', () => {
  const idsByLesson = { 'what-is-a-qubit': ['q1', 'q2'], superposition: ['q1'] }

  it('creates a due-now card per question of each quizzed lesson, and only those', () => {
    const seeded = seedFromQuizScores(
      emptySchedule(),
      { 'what-is-a-qubit': 2 },
      idsByLesson,
      T0,
    )
    expect(Object.keys(seeded.cards).sort()).toEqual([
      'what-is-a-qubit:q1',
      'what-is-a-qubit:q2',
    ])
    expect(seeded.cards[cardKey('what-is-a-qubit', 'q1')]!.due).toBe(T0.toISOString())
  })

  it('is idempotent and never overwrites an existing card', () => {
    let s = seedFromQuizScores(emptySchedule(), { superposition: 1 }, idsByLesson, T0)
    s = gradeInSchedule(s, 'superposition:q1', true, T0)
    const graded = s.cards['superposition:q1']!
    const again = seedFromQuizScores(s, { superposition: 1 }, idsByLesson, new Date())
    expect(again).toBe(s) // nothing to add → same object back
    expect(again.cards['superposition:q1']).toBe(graded)
  })

  it('ignores scores for lessons with no known questions', () => {
    const seeded = seedFromQuizScores(emptySchedule(), { mystery: 3 }, idsByLesson, T0)
    expect(seeded.cards).toEqual({})
  })
})

describe('normalizeSchedule', () => {
  it('drops malformed cards without discarding the healthy ones', () => {
    const good = { ease: 2.5, intervalDays: 3, due: T0.toISOString(), streak: 2 }
    const s = normalizeSchedule({
      cards: { keep: good, bad1: { ease: 'high' }, bad2: null, bad3: { ...good, due: 'not-a-date' } },
    })
    expect(Object.keys(s.cards)).toEqual(['keep'])
  })

  it('reads garbage as empty', () => {
    expect(normalizeSchedule(null).cards).toEqual({})
    expect(normalizeSchedule([1, 2]).cards).toEqual({})
    expect(normalizeSchedule({ cards: [] }).cards).toEqual({})
  })
})

describe('storage', () => {
  // The vitest environment is node: `window` does not exist, exactly like SSR.
  it('is a safe no-op with no window', () => {
    expect(loadSchedule().cards).toEqual({})
    expect(() => saveSchedule(emptySchedule())).not.toThrow()
  })

  describe('with a stubbed window', () => {
    const store = new Map<string, string>()
    const fakeWindow = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    }

    afterEach(() => {
      store.clear()
      delete (globalThis as { window?: unknown }).window
    })

    it('round-trips a schedule under the single documented key', () => {
      ;(globalThis as { window?: unknown }).window = fakeWindow
      const s = seedFromQuizScores(
        emptySchedule(),
        { 'what-is-a-qubit': 1 },
        { 'what-is-a-qubit': ['q1'] },
        T0,
      )
      saveSchedule(s)
      expect(store.has(REVIEW_KEY)).toBe(true)
      expect(loadSchedule()).toEqual(s)
    })

    it('reads corrupt JSON as empty', () => {
      ;(globalThis as { window?: unknown }).window = fakeWindow
      store.set(REVIEW_KEY, '{nope')
      expect(loadSchedule().cards).toEqual({})
    })
  })
})
