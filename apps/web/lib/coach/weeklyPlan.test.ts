/**
 * Tests for the persistent weekly plan. Every planning function takes the
 * clock as an argument, so all of this runs against fixed instants — same
 * evidence, same goal, same clock must mean the same plan, byte for byte.
 *
 * The properties pinned here are the module's contract:
 *  · determinism under a fixed clock
 *  · prerequisite order: no item before the items of its `requires`
 *  · re-planning is non-destructive: done items keep their tick and their week
 *  · a goal change redraws only the undone tail
 */

import { afterEach, describe, expect, it } from 'vitest'
import { LESSONS } from '@/lib/lessons'
import type { Progress } from '@/lib/lessons/progress'
import { nodeFor } from './graph'
import {
  MAX_ITEMS_PER_WEEK,
  WEEKLY_PLAN_KEY,
  buildWeeklyPlan,
  currentWeekIndex,
  destinationForItem,
  loadWeeklyPlan,
  normalizeWeeklyPlan,
  refreshWeeklyPlan,
  saveWeeklyPlan,
  type PlanEvidence,
  type PlanItem,
  type WeeklyPlan,
} from './weeklyPlan'

const T0 = new Date('2026-08-25T09:00:00.000Z')
const T1 = new Date('2026-09-01T09:00:00.000Z')

function evidence(progress?: Partial<Progress>, solved: string[] = []): PlanEvidence {
  return {
    progress: { completed: [], quizScores: {}, ...progress },
    examAttempts: [],
    solvedChallengeIds: solved,
  }
}

/** Raw correct-answer count for a perfect quiz on `slug` (scores are counts). */
function perfectScore(slug: string): number {
  const lesson = LESSONS.find((l) => l.slug === slug)
  if (!lesson) throw new Error(`no lesson ${slug}`)
  return lesson.blocks.reduce(
    (sum, b) => (b.kind === 'quiz' ? sum + b.questions.length : sum),
    0
  )
}

function flatten(plan: WeeklyPlan): PlanItem[] {
  return plan.weeks.flatMap((w) => w.items)
}

function findItem(plan: WeeklyPlan, id: string): PlanItem | undefined {
  return flatten(plan).find((item) => item.id === id)
}

describe('buildWeeklyPlan', () => {
  it('is deterministic with a fixed clock', () => {
    const a = buildWeeklyPlan('shor', evidence(), T0)
    const b = buildWeeklyPlan('shor', evidence(), T0)
    expect(a).toEqual(b)
    expect(a.startedAt).toBe(T0.toISOString())
    expect(a.updatedAt).toBe(T0.toISOString())
  })

  it('buckets 2-4 items per week and never splits a concept group', () => {
    for (const goal of ['shor', 'entanglement', '']) {
      const plan = buildWeeklyPlan(goal, evidence(), T0)
      expect(plan.weeks.length).toBeGreaterThan(0)
      for (const week of plan.weeks) {
        expect(week.items.length).toBeGreaterThanOrEqual(2)
        expect(week.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_WEEK)
      }
    }
  })

  it('covers exactly the goal path: everything toward shor, nothing off it', () => {
    const slugs = new Set(flatten(buildWeeklyPlan('shor', evidence(), T0)).map((i) => i.lessonSlug))
    expect(slugs).toEqual(
      new Set([
        'what-is-a-qubit',
        'superposition-and-measurement',
        'interference',
        'gates-and-circuits',
        'entanglement',
        'grover',
        'shor',
      ])
    )
  })

  it('never schedules a lesson before the lessons it requires', () => {
    // The whole-course plan (no goal) exercises every edge in the graph.
    const items = flatten(buildWeeklyPlan('', evidence(), T0))
    const position = new Map(items.map((item, index) => [item.id, index]))
    for (const item of items) {
      if (item.kind !== 'lesson') continue
      for (const req of nodeFor(item.lessonSlug)?.requires ?? []) {
        const reqPos = position.get(`lesson:${req}`)
        expect(reqPos, `${req} missing from plan for ${item.lessonSlug}`).toBeDefined()
        expect(reqPos!).toBeLessThan(position.get(item.id)!)
      }
    }
  })

  it('pre-ticks work already evidenced — done outside the plan still counts', () => {
    const plan = buildWeeklyPlan(
      'grover',
      evidence({ completed: ['what-is-a-qubit'] }, ['flip-it']),
      T0
    )
    expect(findItem(plan, 'lesson:what-is-a-qubit')?.done).toBe(true)
    expect(findItem(plan, 'challenge:flip-it')?.done).toBe(true)
    // Reading alone is not review mastery — the quiz has not been passed.
    expect(findItem(plan, 'review:what-is-a-qubit')?.done).toBe(false)
    expect(findItem(plan, 'lesson:superposition-and-measurement')?.done).toBe(false)
  })

  it('ticks a review item once the concept clears the mastery bar', () => {
    const slug = 'what-is-a-qubit'
    const plan = buildWeeklyPlan(
      'grover',
      evidence({ completed: [slug], quizScores: { [slug]: perfectScore(slug) } }),
      T0
    )
    expect(findItem(plan, `review:${slug}`)?.done).toBe(true)
  })
})

describe('refreshWeeklyPlan', () => {
  it('is deterministic and stamps updatedAt from the injected clock only', () => {
    const prev = buildWeeklyPlan('shor', evidence(), T0)
    const a = refreshWeeklyPlan(prev, 'shor', evidence({ completed: ['what-is-a-qubit'] }), T1)
    const b = refreshWeeklyPlan(prev, 'shor', evidence({ completed: ['what-is-a-qubit'] }), T1)
    expect(a).toEqual(b)
    expect(a.startedAt).toBe(T0.toISOString()) // creation instant survives
    expect(a.updatedAt).toBe(T1.toISOString())
  })

  it('keeps a completed item ticked and in its original week', () => {
    const prev = buildWeeklyPlan('shor', evidence(), T0)
    const next = refreshWeeklyPlan(prev, 'shor', evidence({ completed: ['what-is-a-qubit'] }), T1)
    const item = next.weeks[0]!.items.find((i) => i.id === 'lesson:what-is-a-qubit')
    expect(item?.done).toBe(true)
  })

  it('never un-ticks: a tick survives even when the evidence later regresses', () => {
    const prev = buildWeeklyPlan('shor', evidence(), T0)
    const done = refreshWeeklyPlan(prev, 'shor', evidence({ completed: ['what-is-a-qubit'] }), T1)
    // Evidence gone (say, a cleared quiz store elsewhere) — history stands.
    const regressed = refreshWeeklyPlan(done, 'shor', evidence(), T1)
    expect(findItem(regressed, 'lesson:what-is-a-qubit')?.done).toBe(true)
  })

  it('never resets wholesale: every done item survives every refresh', () => {
    let plan = buildWeeklyPlan('shor', evidence(), T0)
    plan = refreshWeeklyPlan(
      plan,
      'shor',
      evidence({ completed: ['what-is-a-qubit', 'superposition-and-measurement'] }, ['flip-it']),
      T1
    )
    const doneIds = flatten(plan).filter((i) => i.done).map((i) => i.id)
    expect(doneIds.length).toBeGreaterThan(0)
    const again = refreshWeeklyPlan(plan, 'shor', evidence(), T1)
    for (const id of doneIds) {
      expect(findItem(again, id)?.done, `${id} lost by refresh`).toBe(true)
    }
  })

  it('re-plans only the tail on a goal change: history kept, undone off-path items dropped', () => {
    const prev = buildWeeklyPlan('shor', evidence(), T0)
    const withHistory = refreshWeeklyPlan(
      prev,
      'shor',
      evidence({ completed: ['what-is-a-qubit'] }),
      T1
    )
    const retargeted = refreshWeeklyPlan(
      withHistory,
      'entanglement',
      evidence({ completed: ['what-is-a-qubit'] }),
      T1
    )
    // The finished head is untouched…
    expect(findItem(retargeted, 'lesson:what-is-a-qubit')?.done).toBe(true)
    // …the tail now stops at the new goal…
    const ids = new Set(flatten(retargeted).map((i) => i.id))
    expect(ids.has('lesson:entanglement')).toBe(true)
    expect(ids.has('lesson:grover')).toBe(false)
    expect(ids.has('lesson:shor')).toBe(false)
    // …and widening the goal again re-grows it without disturbing the head.
    const widened = refreshWeeklyPlan(
      retargeted,
      'shor',
      evidence({ completed: ['what-is-a-qubit'] }),
      T1
    )
    expect(findItem(widened, 'lesson:what-is-a-qubit')?.done).toBe(true)
    expect(findItem(widened, 'lesson:shor')).toBeDefined()
  })

  it('builds from scratch when there is no previous plan', () => {
    expect(refreshWeeklyPlan(null, 'grover', evidence(), T0)).toEqual(
      buildWeeklyPlan('grover', evidence(), T0)
    )
  })
})

describe('currentWeekIndex', () => {
  it('points at the first week with anything left, and the last when all is done', () => {
    const plan = buildWeeklyPlan('grover', evidence(), T0)
    expect(currentWeekIndex(plan)).toBe(0)

    const allDone: WeeklyPlan = {
      ...plan,
      weeks: plan.weeks.map((w) => ({ items: w.items.map((i) => ({ ...i, done: true })) })),
    }
    expect(currentWeekIndex(allDone)).toBe(allDone.weeks.length - 1)

    const midway: WeeklyPlan = {
      ...allDone,
      weeks: allDone.weeks.map((w, wi) =>
        wi < 2 ? w : { items: w.items.map((i) => ({ ...i, done: false })) }
      ),
    }
    expect(currentWeekIndex(midway)).toBe(2)
  })
})

describe('destinationForItem', () => {
  it('routes each kind to a real page', () => {
    const plan = buildWeeklyPlan('grover', evidence(), T0)
    const lesson = flatten(plan).find((i) => i.kind === 'lesson')!
    const challenge = flatten(plan).find((i) => i.kind === 'challenge')!
    const review = flatten(plan).find((i) => i.kind === 'review')!
    expect(destinationForItem(lesson)).toBe(`/learn/${lesson.lessonSlug}`)
    expect(destinationForItem(challenge)).toBe(`/challenges/${challenge.challengeId}`)
    expect(destinationForItem(review)).toBe('/review')
  })
})

describe('normalizeWeeklyPlan', () => {
  it('drops malformed items without discarding the healthy ones', () => {
    const good: PlanItem = {
      id: 'lesson:what-is-a-qubit',
      kind: 'lesson',
      lessonSlug: 'what-is-a-qubit',
      label: 'Read "What Is a Qubit?"',
      done: true,
    }
    const plan = normalizeWeeklyPlan({
      goal: 'grover',
      startedAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
      weeks: [{ items: [good, { id: 42 }, null, { ...good, kind: 'homework' }] }],
    })
    expect(plan?.weeks[0]?.items).toEqual([good])
  })

  it('reads structural garbage as absent, so the caller rebuilds', () => {
    expect(normalizeWeeklyPlan(null)).toBeNull()
    expect(normalizeWeeklyPlan([1, 2])).toBeNull()
    expect(normalizeWeeklyPlan({ goal: 'x', startedAt: 'not-a-date', updatedAt: 'y', weeks: [] })).toBeNull()
    expect(normalizeWeeklyPlan({ goal: 'x', weeks: 'nope' })).toBeNull()
  })
})

describe('storage', () => {
  // The vitest environment is node: `window` does not exist, exactly like SSR.
  it('is a safe no-op with no window', () => {
    expect(loadWeeklyPlan()).toBeNull()
    expect(() => saveWeeklyPlan(buildWeeklyPlan('', evidence(), T0))).not.toThrow()
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

    it('round-trips a plan under the single documented key', () => {
      ;(globalThis as { window?: unknown }).window = fakeWindow
      const plan = buildWeeklyPlan('grover', evidence({ completed: ['what-is-a-qubit'] }), T0)
      saveWeeklyPlan(plan)
      expect(store.has(WEEKLY_PLAN_KEY)).toBe(true)
      expect(loadWeeklyPlan()).toEqual(plan)
    })

    it('reads corrupt JSON as absent', () => {
      ;(globalThis as { window?: unknown }).window = fakeWindow
      store.set(WEEKLY_PLAN_KEY, '{nope')
      expect(loadWeeklyPlan()).toBeNull()
    })
  })
})
