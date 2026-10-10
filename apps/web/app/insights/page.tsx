'use client'

/**
 * /insights — a personal learning dashboard.
 *
 * This page is for the LEARNER, not an operator. Every number on it is computed
 * in this browser from the local event buffer plus local lesson progress; there
 * is no request to a server anywhere in this file, and nothing here is ever
 * uploaded. Data is read after mount so the server-rendered markup and the first
 * client render agree — skeleton tiles hold the layout in the meantime.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { announce } from '@/lib/a11y/announce'
import { Histogram } from '@/components/ui/Histogram'
import { StatTile, StatTileSkeleton } from '@/components/analytics/StatTile'
import { UsageChart, type UsagePoint } from '@/components/analytics/UsageChart'
import {
  EVENT_NAMES,
  type AnalyticsEvent,
  type EventName,
} from '@/lib/analytics/events'
import {
  clearEvents,
  getEvents,
  hasBrowserPrivacySignal,
  isOptedOut,
  replaceEvents,
  setOptedOut,
  REMOTE_INGESTION_CONFIGURED,
} from '@/lib/analytics/track'
import {
  dailySeries,
  learningSummary,
  streak,
  topProps,
  type LearningSummary,
} from '@/lib/analytics/aggregate'
import { allSlugs } from '@/lib/lessons'
import { loadProgress, type Progress } from '@/lib/lessons/progress'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { listCircuits, storageMode } from '@/lib/circuit-store'
import { mulberry32 } from '@/lib/quantum'

const WINDOW_DAYS = 30
const EXAM_ATTEMPTS_KEY = 'quantum-lab.exam-attempts'

// Same reason as LESSON_SLUGS: the eight entries that used to be listed here
// were all real, but only by luck of nobody having renamed a route.
const VIZ_SLUGS = VISUALIZATIONS.map((viz) => viz.href.split('/').pop() ?? '')
/**
 * Derived, never listed. The previous hardcoded array held three slugs that
 * were never lessons ('superposition', 'quantum-gates', 'grovers-algorithm'),
 * so half the sample lesson events carried a slug that `getLesson` cannot
 * resolve — any per-lesson breakdown of the sample data counted nothing for
 * them and silently under-reported. Reading the real order keeps this correct
 * when a lesson is added, renamed or removed.
 */
const LESSON_SLUGS = allSlugs()

/**
 * Exam attempts are owned by another module that may not exist in this build, so
 * they are read straight out of localStorage behind a try/catch. An absent or
 * malformed key simply means "no attempts" — never an error on this page.
 */
function readExamAttemptCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(EXAM_ATTEMPTS_KEY)
    if (!raw) return 0
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/** Sum the per-name dense series into one dense "any activity" series. */
function totalDailySeries(events: AnalyticsEvent[], days: number): UsagePoint[] {
  const base = dailySeries(events, EVENT_NAMES[0], days)
  const totals = base.map((point) => ({ date: point.date, value: point.value }))
  for (let n = 1; n < EVENT_NAMES.length; n += 1) {
    const series = dailySeries(events, EVENT_NAMES[n] as EventName, days)
    for (let i = 0; i < totals.length; i += 1) {
      totals[i].value += series[i]?.value ?? 0
    }
  }
  return totals
}

/** Last-7 vs previous-7 change, for the stat-tile deltas. */
function weekOverWeek(series: UsagePoint[]): number {
  if (series.length < 14) return 0
  const tail = series.slice(-7).reduce((a, p) => a + p.value, 0)
  const prior = series.slice(-14, -7).reduce((a, p) => a + p.value, 0)
  return tail - prior
}

/**
 * Seed a plausible 30 days of activity so an empty dashboard can still be
 * explored. Every generated event carries `sample: true` and the page says so
 * loudly; "Delete all analytics" removes them like any other event.
 */
function generateSampleEvents(): AnalyticsEvent[] {
  const rng = mulberry32(20260816)
  const events: AnalyticsEvent[] = []
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  for (let dayOffset = WINDOW_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(today.getTime())
    day.setDate(day.getDate() - dayOffset)
    // Roughly two study days in three, with a busier stretch near the end.
    const intensity = rng() < 0.32 ? 0 : 1 + Math.floor(rng() * 5)
    const sessionId = `sample-${dayOffset}`

    for (let k = 0; k < intensity; k += 1) {
      const at = new Date(day.getTime())
      at.setMinutes(at.getMinutes() + Math.floor(rng() * 220))
      const roll = rng()
      const name: EventName =
        roll < 0.24
          ? 'lesson.viewed'
          : roll < 0.36
            ? 'lesson.completed'
            : roll < 0.48
              ? 'quiz.answered'
              : roll < 0.68
                ? 'circuit.run'
                : roll < 0.76
                  ? 'circuit.saved'
                  : roll < 0.92
                    ? 'viz.opened'
                    : 'tutor.asked'

      const props: Record<string, string | number | boolean> = { sample: true }
      if (name.startsWith('lesson') || name === 'quiz.answered') {
        props.slug = LESSON_SLUGS[Math.floor(rng() * LESSON_SLUGS.length)]
      } else if (name.startsWith('viz')) {
        props.slug = VIZ_SLUGS[Math.floor(rng() * VIZ_SLUGS.length)]
      } else if (name.startsWith('circuit')) {
        props.qubits = 2 + Math.floor(rng() * 3)
      }

      events.push({ name, at: at.toISOString(), props, sessionId })
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at))
  return events
}

const SKELETON_TILES = [
  'Lessons completed',
  'Current streak',
  'Circuits run',
  'Quiz average',
  'Visualizations',
  'Time invested',
]

export default function InsightsPage() {
  const [ready, setReady] = useState(false)
  const [events, setEvents] = useState<AnalyticsEvent[]>([])
  const [progress, setProgress] = useState<Progress>({ completed: [], quizScores: {} })
  const [optedOut, setOptedOutState] = useState(false)
  const [forcedOut, setForcedOut] = useState(false)
  const [examAttempts, setExamAttempts] = useState(0)
  const [savedCircuits, setSavedCircuits] = useState<number | null>(null)
  const [mode, setMode] = useState<'supabase' | 'local'>('local')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const switchId = useId()

  const refresh = useCallback(() => {
    setEvents(getEvents())
    setProgress(loadProgress())
    setOptedOutState(isOptedOut())
    setForcedOut(hasBrowserPrivacySignal())
    setExamAttempts(readExamAttemptCount())
    setMode(storageMode())
  }, [])

  useEffect(() => {
    refresh()
    setReady(true)
    let active = true
    listCircuits()
      .then((items) => {
        if (active) setSavedCircuits(items.length)
      })
      .catch(() => {
        if (active) setSavedCircuits(null)
      })
    return () => {
      active = false
    }
  }, [refresh])

  const summary: LearningSummary = useMemo(
    () => learningSummary(events, progress),
    [events, progress]
  )
  const streaks = useMemo(() => streak(events), [events])
  const activity = useMemo(() => totalDailySeries(events, WINDOW_DAYS), [events])
  const lessonsSeries = useMemo(
    () => dailySeries(events, 'lesson.completed', WINDOW_DAYS),
    [events]
  )
  const runsSeries = useMemo(() => dailySeries(events, 'circuit.run', WINDOW_DAYS), [events])
  const vizRanking = useMemo(() => topProps(events, 'viz.opened', 'slug', 8), [events])
  const isSample = useMemo(() => events.some((e) => e.props.sample === true), [events])

  const activitySpark = useMemo(() => activity.slice(-14).map((p) => p.value), [activity])
  const runsSpark = useMemo(() => runsSeries.slice(-14).map((p) => p.value), [runsSeries])
  const lessonsSpark = useMemo(() => lessonsSeries.slice(-14).map((p) => p.value), [lessonsSeries])

  const handleDownload = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: 'Qubit16 local analytics. This file never left your device unless you shared it.',
      events: getEvents(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'qubit16-analytics.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      // A11Y (WCAG 3.3.4 / 4.1.3): arming a destructive confirm by swapping the
      // label of the button that still holds focus is not reliably re-read.
      announce('Delete all analytics? Press the button again to confirm. This cannot be undone.')
      return
    }
    clearEvents()
    setConfirmDelete(false)
    refresh()
    announce('All analytics deleted from this browser. The dashboard is now empty.')
  }, [confirmDelete, refresh])

  const handleToggleOptOut = useCallback(() => {
    if (forcedOut) return
    const next = !optedOut
    setOptedOut(next)
    setOptedOutState(next)
    if (next) setEvents([])
    else refresh()
    // aria-checked covers the switch itself; this covers the consequence,
    // which is that every chart on the page has just appeared or vanished.
    announce(
      next
        ? 'Analytics off. Recording stopped and this dashboard is now empty.'
        : 'Analytics on. Recording resumed.'
    )
  }, [forcedOut, optedOut, refresh])

  const handleSample = useCallback(() => {
    replaceEvents(generateSampleEvents())
    refresh()
    // The empty state is replaced by six stat tiles, two charts and a
    // histogram, none of which are in a live region.
    announce(
      `Sample data generated for the last ${WINDOW_DAYS} days. The dashboard below is now filled with generated numbers, clearly labelled, and removable with "Delete all analytics".`
    )
  }, [refresh])

  const hasEvents = events.length > 0

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="mb-8">
        <p className="section-label">Insights</p>
        <h1 className="section-title mt-1">Your learning</h1>
        <p className="section-desc mt-2 max-w-2xl">
          Everything on this page is computed in your browser from data that never leaves your
          device. No cookies, no third-party scripts, no fingerprinting, no cross-site
          identifiers — just a capped local log of what you did in Qubit16.
          {REMOTE_INGESTION_CONFIGURED ? (
            <>
              {' '}
              This deployment has an ingestion endpoint configured, so events may also be sent
              there when you are not opted out.
            </>
          ) : null}
        </p>
        {examAttempts > 0 ? (
          <p className="mt-3 text-xs text-ink-muted">
            {examAttempts} practice exam attempt{examAttempts === 1 ? '' : 's'} stored in this
            browser.
          </p>
        ) : null}
      </header>

      {isSample ? (
        <div className="card mb-6 border-q-amber/40 p-4 text-sm text-ink-secondary">
          <span className="pill mr-2 border-q-amber/50 text-q-amber-text">Sample data</span>
          These numbers are generated, not yours. Use “Delete all analytics” below to clear them.
        </div>
      ) : null}

      {/* ── Headline numbers ── a stat tile is the right form for a single value */}
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {!ready ? (
          SKELETON_TILES.map((label) => <StatTileSkeleton key={label} label={label} />)
        ) : (
          <>
            <StatTile
              label="Lessons completed"
              value={summary.lessonsCompleted}
              accent="violet"
              sparkline={lessonsSpark}
              delta={weekOverWeek(lessonsSeries)}
              hint="vs prior 7 days"
            />
            <StatTile
              label="Current streak"
              value={`${streaks.current} d`}
              accent="teal"
              hint={`longest ${streaks.longest} d`}
            />
            <StatTile
              label="Circuits run"
              value={summary.circuitsRun}
              accent="amber"
              sparkline={runsSpark}
              delta={weekOverWeek(runsSeries)}
              hint={
                savedCircuits === null
                  ? 'vs prior 7 days'
                  : `${savedCircuits} saved ${mode === 'supabase' ? 'to your account' : 'in this browser'}`
              }
            />
            <StatTile
              label="Quiz average"
              value={summary.quizAverage > 0 ? `${summary.quizAverage}%` : '—'}
              accent="rose"
              hint="across graded quizzes"
            />
            <StatTile
              label="Visualizations"
              value={summary.vizExplored}
              accent="sky"
              hint="distinct explored"
            />
            <StatTile
              label="Time invested"
              value={`${summary.minutesEstimate} min`}
              accent="violet"
              sparkline={activitySpark}
              hint="estimated, not timed"
            />
          </>
        )}
      </section>

      {!ready ? (
        <div className="card h-64 animate-pulse" />
      ) : !hasEvents ? (
        <section className="card p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">Nothing to show yet</h2>
          <p className="section-desc mx-auto mt-2 max-w-md">
            {optedOut
              ? 'Analytics are switched off for this browser, so nothing is being recorded. Turn them back on below if you would like this dashboard to fill in.'
              : 'Read a lesson, run a circuit, or open a visualization and this page will fill in. Nothing is recorded anywhere but here.'}
          </p>
          {!optedOut ? (
            <button type="button" className="btn-ghost focus-ring mt-5" onClick={handleSample}>
              Generate sample data
            </button>
          ) : null}
          <p className="mt-3 text-[11px] text-ink-muted">
            Sample data is clearly labelled and removable at any time.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {/* Single series → one hue, no legend: the title names what is plotted. */}
          <UsageChart
            series={[{ name: 'Events', data: activity }]}
            title={`Daily activity — last ${WINDOW_DAYS} days`}
            unit="events"
          />

          {/* Two series → legend + direct end-labels, hues from the fixed order. */}
          <UsageChart
            series={[
              { name: 'Lessons completed', data: lessonsSeries },
              { name: 'Circuits run', data: runsSeries },
            ]}
            title={`Learning vs building — last ${WINDOW_DAYS} days`}
          />

          <section className="card p-5">
            <h2 className="mb-1 text-[13px] font-semibold text-ink-secondary">Most explored</h2>
            <p className="mb-4 text-xs text-ink-muted">
              Visualizations you opened most often, by slug.
            </p>
            {vizRanking.length > 0 ? (
              <Histogram
                data={vizRanking}
                title="Visualization opens"
                unit="opens"
                maxBars={8}
              />
            ) : (
              <p className="py-8 text-center text-sm text-ink-muted">
                No visualizations opened yet.
              </p>
            )}
          </section>
        </div>
      )}

      {/* ── Privacy controls ── */}
      <section className="card mt-8 p-5">
        <h2 className="text-[13px] font-semibold text-ink-secondary">Your data, your call</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
          Events are kept in this browser only, capped at the most recent 1,000, and dropped
          oldest-first after that. Clearing site data removes them completely.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={!optedOut}
            /*
             * A11Y (WCAG 2.5.3 Label in Name, Level A). This carried
             * aria-label="Record analytics in this browser", which REPLACES the
             * accessible name rather than adding to it — so the visible text
             * "Analytics on" / "Analytics off" appeared nowhere in the name and
             * a voice-control user saying "click Analytics on" hit nothing.
             * The description is the right slot for the extra context: it is
             * announced after the name, and it does not displace it.
             */
            aria-describedby={`${switchId}-desc`}
            disabled={forcedOut}
            onClick={handleToggleOptOut}
            className="focus-ring flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-secondary transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                optedOut ? 'bg-surface-3' : 'bg-q-violet'
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white transition-transform ${
                  optedOut ? 'translate-x-0' : 'translate-x-4'
                }`}
              />
            </span>
            {optedOut ? 'Analytics off' : 'Analytics on'}
          </button>
          <span id={`${switchId}-desc`} className="sr-only">
            Record analytics in this browser. Nothing is uploaded.
          </span>

          <button type="button" className="btn-ghost focus-ring" onClick={handleDownload}>
            Download my data
          </button>

          <button
            type="button"
            className="btn-ghost focus-ring"
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? 'Click again to confirm' : 'Delete all analytics'}
          </button>
        </div>

        {forcedOut ? (
          <p className="mt-4 text-xs text-q-amber-text">
            Your browser is sending Do Not Track or Global Privacy Control, so analytics stay off
            and this switch is locked. A site-level toggle that could override a browser-level
            signal would make that signal meaningless.
          </p>
        ) : null}

        <p className="mt-4 text-xs text-ink-muted">
          Full details of what is recorded, and how to wire a self-hosted backend, are in
          docs/ANALYTICS.md.
        </p>
      </section>
    </div>
  )
}
