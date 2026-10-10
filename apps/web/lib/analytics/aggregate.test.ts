/**
 * aggregate.ts — the arithmetic behind every number on /insights.
 *
 * These reducers had no tests at all, which matters more than usual here: they
 * are the only place in the product where a learner is shown a claim about
 * themselves. A streak that over-counts is flattery, a day bucket in the wrong
 * timezone silently splits an evening's work in two, and both are the sort of
 * thing that stays wrong for a year because nobody can tell by looking.
 *
 * Everything below is timezone-agnostic: dates are built with the local-time
 * `new Date(y, m, d, h)` constructor, exactly as `dayKey` reads them, so this
 * file passes in UTC and in Asia/Kolkata alike.
 */

import { describe, expect, it } from 'vitest'

import {
  activeDays,
  countByName,
  dailySeries,
  dayKey,
  daysSinceLastActive,
  lastActiveDay,
  learningSummary,
  sessionCount,
  streak,
  topProps,
} from '@/lib/analytics/aggregate'
import type { AnalyticsEvent, EventName } from '@/lib/analytics/events'
import type { Progress } from '@/lib/lessons/progress'

/** An event at a local wall-clock time, so day bucketing is exercised honestly. */
function at(
  y: number,
  m: number,
  d: number,
  hour = 12,
  minute = 0,
  name: EventName = 'circuit.run',
  props: Record<string, string | number | boolean> = {}
): AnalyticsEvent {
  return {
    name,
    at: new Date(y, m - 1, d, hour, minute).toISOString(),
    props,
    sessionId: 's1',
  }
}

const NO_PROGRESS: Progress = { completed: [], quizScores: {} }

describe('dayKey', () => {
  it('uses local calendar days, not UTC', () => {
    // 23:30 local on the 5th is the 5th, whatever UTC thinks.
    expect(dayKey(new Date(2026, 2, 5, 23, 30))).toBe('2026-03-05')
    expect(dayKey(new Date(2026, 2, 6, 0, 30))).toBe('2026-03-06')
  })
})

describe('dailySeries', () => {
  it('is dense and zero-filled across quiet days', () => {
    const events = [at(2026, 3, 1), at(2026, 3, 1), at(2026, 3, 5)]
    const series = dailySeries(events, 'circuit.run', 5, new Date(2026, 2, 5, 18))

    expect(series.map((p) => p.date)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ])
    // The three quiet days are present as zeros. A sparse series would draw a
    // straight line from the 1st to the 5th as if they had not happened.
    expect(series.map((p) => p.value)).toEqual([2, 0, 0, 0, 1])
  })

  it('ignores other event names and events outside the window', () => {
    const events = [
      at(2026, 3, 5, 12, 0, 'lesson.completed'),
      at(2026, 1, 1, 12, 0, 'circuit.run'),
      at(2026, 3, 5, 13, 0, 'circuit.run'),
    ]
    const series = dailySeries(events, 'circuit.run', 3, new Date(2026, 2, 5, 18))
    expect(series.map((p) => p.value)).toEqual([0, 0, 1])
  })

  it('returns nothing for a zero-day window', () => {
    expect(dailySeries([at(2026, 3, 5)], 'circuit.run', 0, new Date(2026, 2, 5))).toEqual([])
  })
})

describe('streak', () => {
  const run = (days: [number, number][], now: Date) =>
    streak(
      days.map(([m, d]) => at(2026, m, d)),
      now
    )

  it('counts a run that ends today', () => {
    expect(run([[3, 3], [3, 4], [3, 5]], new Date(2026, 2, 5, 9))).toEqual({
      current: 3,
      longest: 3,
    })
  })

  it('still counts a run that ended yesterday — the day is not over', () => {
    expect(run([[3, 3], [3, 4]], new Date(2026, 2, 5, 9))).toEqual({ current: 2, longest: 2 })
  })

  it('reports current 0 for a run that ended two days ago', () => {
    // THE point of the rule: a streak that ended is not one you are still on.
    // If this ever returns 3 again, /insights is flattering people.
    expect(run([[3, 1], [3, 2], [3, 3]], new Date(2026, 2, 5, 9))).toEqual({
      current: 0,
      longest: 3,
    })
  })

  it('keeps the longest run from history while the current one is shorter', () => {
    expect(
      run([[3, 1], [3, 2], [3, 3], [3, 4], [3, 10], [3, 11]], new Date(2026, 2, 11, 9))
    ).toEqual({ current: 2, longest: 4 })
  })

  it('counts multiple events on one day once', () => {
    const events = [at(2026, 3, 5, 9), at(2026, 3, 5, 10), at(2026, 3, 5, 23)]
    expect(streak(events, new Date(2026, 2, 5, 23, 59))).toEqual({ current: 1, longest: 1 })
  })

  it('is zero for an empty buffer', () => {
    expect(streak([], new Date(2026, 2, 5))).toEqual({ current: 0, longest: 0 })
  })
})

describe('lastActiveDay / daysSinceLastActive', () => {
  it('is null with no history, so "welcome back" can never fire on a first visit', () => {
    expect(lastActiveDay([])).toBeNull()
    expect(daysSinceLastActive([], new Date(2026, 2, 5))).toBeNull()
  })

  it('counts whole local days since the most recent event', () => {
    const events = [at(2026, 3, 1), at(2026, 2, 26, 20)]
    expect(lastActiveDay(events)).toBe('2026-03-01')
    expect(daysSinceLastActive(events, new Date(2026, 2, 1, 8))).toBe(0)
    expect(daysSinceLastActive(events, new Date(2026, 2, 2, 8))).toBe(1)
    expect(daysSinceLastActive(events, new Date(2026, 2, 15, 8))).toBe(14)
  })

  it('clamps a future-dated event to 0 rather than reporting a negative gap', () => {
    // A clock change or an imported buffer must not read as "returned before
    // they left" — that would make the banner say "welcome back" to nobody.
    expect(daysSinceLastActive([at(2026, 3, 20)], new Date(2026, 2, 5))).toBe(0)
  })
})

describe('countByName / activeDays / sessionCount / topProps', () => {
  it('reports every name in the taxonomy, zeros included', () => {
    const counts = countByName([at(2026, 3, 1, 12, 0, 'circuit.run')])
    expect(counts['circuit.run']).toBe(1)
    expect(counts['exam.completed']).toBe(0)
  })

  it('counts distinct local days', () => {
    expect(activeDays([at(2026, 3, 1, 9), at(2026, 3, 1, 23), at(2026, 3, 4)])).toBe(2)
  })

  it('counts distinct sessions and ignores empty ids', () => {
    const events: AnalyticsEvent[] = [
      { ...at(2026, 3, 1), sessionId: 'a' },
      { ...at(2026, 3, 1), sessionId: 'b' },
      { ...at(2026, 3, 1), sessionId: 'a' },
      { ...at(2026, 3, 1), sessionId: '' },
    ]
    expect(sessionCount(events)).toBe(2)
  })

  it('ranks prop values, breaking ties by label', () => {
    const events = [
      at(2026, 3, 1, 9, 0, 'viz.opened', { slug: 'grover' }),
      at(2026, 3, 1, 9, 1, 'viz.opened', { slug: 'grover' }),
      at(2026, 3, 1, 9, 2, 'viz.opened', { slug: 'bloch-sphere' }),
      at(2026, 3, 1, 9, 3, 'viz.opened', { slug: 'qft' }),
      at(2026, 3, 1, 9, 4, 'circuit.run', { slug: 'ignored' }),
    ]
    expect(topProps(events, 'viz.opened', 'slug', 2)).toEqual([
      { label: 'grover', value: 2 },
      { label: 'bloch-sphere', value: 1 },
    ])
  })
})

describe('learningSummary', () => {
  it('unions lesson completions from events and from course progress', () => {
    const events = [at(2026, 3, 1, 9, 0, 'lesson.completed', { slug: 'interference' })]
    const progress: Progress = { completed: ['what-is-a-qubit', 'interference'], quizScores: {} }
    expect(learningSummary(events, progress).lessonsCompleted).toBe(2)
  })

  it('counts a visualization once however many times it is opened', () => {
    const events = [
      at(2026, 3, 1, 9, 0, 'viz.opened', { slug: 'grover' }),
      at(2026, 3, 1, 9, 5, 'viz.interacted', { slug: 'grover' }),
      at(2026, 3, 1, 9, 9, 'viz.opened', { slug: 'qft' }),
    ]
    expect(learningSummary(events, NO_PROGRESS).vizExplored).toBe(2)
  })

  it('estimates minutes as 5 per occupied 5-minute bucket, not as elapsed time', () => {
    // Two events 4 minutes apart usually share a bucket; one an hour later does
    // not. The number is deliberately coarse — see the docstring on the
    // function. If this ever starts tracking real elapsed time, something has
    // started listening to focus/blur and docs/ANALYTICS.md is out of date.
    const events = [at(2026, 3, 1, 9, 0), at(2026, 3, 1, 9, 1), at(2026, 3, 1, 10, 0)]
    expect(learningSummary(events, NO_PROGRESS).minutesEstimate).toBe(10)
  })

  it('averages quiz scores to one decimal and survives an empty score map', () => {
    expect(learningSummary([], { completed: [], quizScores: { a: 80, b: 95 } }).quizAverage).toBe(
      87.5
    )
    expect(learningSummary([], NO_PROGRESS).quizAverage).toBe(0)
  })
})
