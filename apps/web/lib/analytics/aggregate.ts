/**
 * aggregate.ts — pure reducers over an AnalyticsEvent[].
 *
 * Nothing in this file touches `window`, `localStorage`, or `fetch`. Every
 * function takes events in and returns plain data out, which makes the numbers
 * on /insights unit-testable without a DOM and keeps the "computed in your
 * browser" claim easy to audit: this is all the computation there is.
 *
 * Day boundaries are LOCAL, not UTC — a learner's "yesterday" is their
 * yesterday, and a UTC bucket would silently split evening sessions in the
 * Americas across two days.
 */

import type { Progress } from '@/lib/lessons/progress'
import { EVENT_NAMES, type AnalyticsEvent, type EventName } from '@/lib/analytics/events'

export interface DailyPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  value: number
}

export interface StreakResult {
  current: number
  longest: number
}

export interface TopProp {
  label: string
  value: number
}

export interface LearningSummary {
  lessonsCompleted: number
  quizAverage: number
  circuitsRun: number
  vizExplored: number
  minutesEstimate: number
}

// ── date helpers ──────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `YYYY-MM-DD` in the viewer's local timezone. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseAt(event: AnalyticsEvent): Date | null {
  const ms = Date.parse(event.at)
  return Number.isNaN(ms) ? null : new Date(ms)
}

/** Local midnight of `date`, so day arithmetic is not thrown off by the clock. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + delta)
  return next
}

function dayNumber(key: string): number {
  // Days since epoch for a `YYYY-MM-DD` key, used only for adjacency tests.
  const [y, m, d] = key.split('-').map((part) => Number.parseInt(part, 10))
  return Math.round(new Date(y, (m ?? 1) - 1, d ?? 1).getTime() / 86_400_000)
}

// ── reducers ──────────────────────────────────────────────────

/** How many times each event name occurs. Every name is present, zero included. */
export function countByName(events: AnalyticsEvent[]): Record<EventName, number> {
  const counts = {} as Record<EventName, number>
  for (const name of EVENT_NAMES) counts[name] = 0
  for (const event of events) {
    if (event.name in counts) counts[event.name] += 1
  }
  return counts
}

/**
 * A DENSE daily count for one event name over the last `days` days, oldest first.
 *
 * The zero-filling is the point. A sparse series — only the days that happen to
 * have data — draws a line that hops straight from Monday to Friday as if the
 * three quiet days did not exist, which reads as sustained activity when it was
 * actually a gap. Dense-with-zeros is the only honest shape for a time series.
 */
export function dailySeries(
  events: AnalyticsEvent[],
  name: EventName,
  days: number,
  now: Date = new Date()
): DailyPoint[] {
  const span = Math.max(0, Math.floor(days))
  if (span === 0) return []

  const today = startOfDay(now)
  const buckets = new Map<string, number>()
  for (let i = span - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(addDays(today, -i)), 0)
  }

  for (const event of events) {
    if (event.name !== name) continue
    const at = parseAt(event)
    if (!at) continue
    const key = dayKey(at)
    const existing = buckets.get(key)
    if (existing !== undefined) buckets.set(key, existing + 1)
  }

  return Array.from(buckets, ([date, value]) => ({ date, value }))
}

/** Distinct local days on which anything at all happened. */
export function activeDays(events: AnalyticsEvent[]): number {
  return distinctDayKeys(events).length
}

function distinctDayKeys(events: AnalyticsEvent[]): string[] {
  const keys = new Set<string>()
  for (const event of events) {
    const at = parseAt(event)
    if (at) keys.add(dayKey(at))
  }
  return Array.from(keys).sort()
}

/**
 * Consecutive-day streaks.
 *
 * `longest` is the longest run of adjacent active days anywhere in the history.
 * `current` is the run ending on the most recent active day, and it only counts
 * as "current" when that day is today or yesterday — a streak that ended a week
 * ago is not one you are still on, and showing it as live would be flattery
 * rather than information.
 */
export function streak(events: AnalyticsEvent[], now: Date = new Date()): StreakResult {
  const keys = distinctDayKeys(events)
  if (keys.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let run = 1
  let runEndingAtLast = 1

  for (let i = 1; i < keys.length; i += 1) {
    const adjacent = dayNumber(keys[i]) - dayNumber(keys[i - 1]) === 1
    run = adjacent ? run + 1 : 1
    if (run > longest) longest = run
    runEndingAtLast = run
  }

  const today = dayNumber(dayKey(startOfDay(now)))
  const lastActive = dayNumber(keys[keys.length - 1])
  const lag = today - lastActive
  const current = lag === 0 || lag === 1 ? runEndingAtLast : 0

  return { current, longest }
}

/**
 * The most recent local day on which anything happened, `YYYY-MM-DD`, or null.
 */
export function lastActiveDay(events: AnalyticsEvent[]): string | null {
  const keys = distinctDayKeys(events)
  return keys.length === 0 ? null : keys[keys.length - 1]
}

/**
 * Whole local days between the last recorded activity and `now`, or null when
 * there is no history at all.
 *
 * 0 = today, 1 = yesterday. Used to decide whether a returning learner gets
 * "here is where you were" instead of the ordinary resume line. It exists so
 * absence can be answered with orientation rather than a scold — nothing in
 * this app counts days missed, and this number must never be used to.
 *
 * Negative lags (an event dated in the future — a clock change, an imported
 * buffer) clamp to 0 rather than reading as "returned before they left".
 */
export function daysSinceLastActive(
  events: AnalyticsEvent[],
  now: Date = new Date()
): number | null {
  const last = lastActiveDay(events)
  if (last === null) return null
  const lag = dayNumber(dayKey(startOfDay(now))) - dayNumber(last)
  return lag < 0 ? 0 : lag
}

/** The most common values of one prop on one event name, highest first. */
export function topProps(
  events: AnalyticsEvent[],
  name: EventName,
  propKey: string,
  limit = 5
): TopProp[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.name !== name) continue
    const value = event.props[propKey]
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const label = String(value)
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, Math.floor(limit)))
}

/** Distinct per-tab sessions represented in the buffer. */
export function sessionCount(events: AnalyticsEvent[]): number {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.sessionId) ids.add(event.sessionId)
  }
  return ids.size
}

const FIVE_MINUTES_MS = 5 * 60 * 1000

/**
 * Headline numbers for the dashboard.
 *
 * `minutesEstimate` is a HEURISTIC, not real timing. Qubit16 does not run a
 * clock, does not listen for focus/blur, and does not ping a server every 15
 * seconds — all of which would be far more invasive than the thing they measure.
 * Instead: bucket every event into a distinct 5-minute window and count 5 minutes
 * per occupied window. Reading a lesson for 40 minutes without clicking anything
 * reads as 5; a burst of clicking reads as 5 too. Treat it as "roughly how much
 * of your time this app has been part of", never as a timesheet.
 */
export function learningSummary(
  events: AnalyticsEvent[],
  progress: Progress
): LearningSummary {
  const counts = countByName(events)

  const completedFromEvents = new Set<string>()
  for (const event of events) {
    if (event.name !== 'lesson.completed') continue
    const slug = event.props.slug
    if (typeof slug === 'string' && slug) completedFromEvents.add(slug)
  }
  for (const slug of progress.completed) completedFromEvents.add(slug)

  const scores = Object.values(progress.quizScores).filter((n) => Number.isFinite(n))
  const quizAverage =
    scores.length === 0
      ? 0
      : Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10

  const vizSlugs = new Set<string>()
  for (const event of events) {
    if (event.name !== 'viz.opened' && event.name !== 'viz.interacted') continue
    const slug = event.props.slug
    if (typeof slug === 'string' && slug) vizSlugs.add(slug)
  }

  const buckets = new Set<number>()
  for (const event of events) {
    const at = parseAt(event)
    if (at) buckets.add(Math.floor(at.getTime() / FIVE_MINUTES_MS))
  }

  return {
    lessonsCompleted: completedFromEvents.size,
    quizAverage,
    circuitsRun: counts['circuit.run'],
    vizExplored: vizSlugs.size,
    minutesEstimate: buckets.size * 5,
  }
}
