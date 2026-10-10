'use client'

/**
 * ResumeBanner — the one persistent onboarding surface, mounted in
 * app/layout.tsx above <main>.
 *
 * It answers three different questions with three different lines, and
 * renders nothing at all the rest of the time:
 *
 *  1. FIRST VISIT — "there is a two-minute way in". `/welcome` is linked from
 *     nowhere else in the product: not the nav, not the home page, not the
 *     footer. Without this line the entire first-run flow is reachable only by
 *     typing the URL. Suppressed the moment there is any evidence the visitor
 *     found their own way in, because interrupting someone who is already
 *     doing the thing is worse than saying nothing.
 *
 *  2. MID-PATH — "step 3 of 6", pointing at the next step of the path they
 *     chose. Before this component derived progress, `nextStep()` was fed a
 *     `completedSteps` list that no path step was ever written into, so it
 *     returned step 1 forever: the banner told a learner four lessons deep to
 *     pick up where they left off and sent them back to lesson one. Progress
 *     now comes from `lib/analytics/journey.ts`, which reads what they
 *     actually did.
 *
 *  3. RETURNING AFTER A GAP — "welcome back, here is where you were".
 *
 * THINGS THAT MUST NOT BE ADDED HERE, and why:
 *  - no day counters, no "you missed N days", no broken-streak language. The
 *    gap is used only to switch the copy to orientation; it is never shown as
 *    a number, because a number you are behind on is a debt, and this is a
 *    place to learn physics.
 *  - no countdowns, no "expires", no seat/spot counts. Nothing here is scarce.
 *  - no network call. Everything below is read from this device.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { daysSinceLastActive } from '@/lib/analytics/aggregate'
import {
  EMPTY_EVIDENCE,
  collectEvidence,
  journeyProgress,
  type JourneyProgress,
} from '@/lib/analytics/journey'
import { getEvents } from '@/lib/analytics/track'
import { readProgress as readChallengeProgress } from '@/lib/challenges/types'
import { loadProgress } from '@/lib/lessons/progress'
import { dismissOnboarding, loadOnboarding, markStepComplete } from '@/lib/onboarding/state'
import type { OnboardingStep } from '@/lib/onboarding/steps'

/**
 * How long an absence has to be before the copy changes to "welcome back".
 * Seven days: shorter and it fires on an ordinary weekend, which would make it
 * meaningless. It only ever changes wording — nothing is withheld or reset.
 */
const RETURN_AFTER_DAYS = 7

type Mode =
  | { kind: 'none' }
  | { kind: 'invite' }
  | { kind: 'resume'; step: OnboardingStep; progress: JourneyProgress; returning: boolean }

/**
 * Decide what to show, from local state only.
 *
 * Split out from the component so the rule is one readable function rather
 * than a chain of early returns inside an effect.
 */
function decideMode(): Mode {
  const onboarding = loadOnboarding()

  // A dismissal is permanent, for every mode. Escaping onboarding has to stick.
  if (onboarding.dismissedAt !== undefined) return { kind: 'none' }

  const events = getEvents()
  const evidence =
    events.length === 0
      ? { ...EMPTY_EVIDENCE, lessonsCompleted: new Set(loadProgress().completed) }
      : collectEvidence(events, loadProgress(), readChallengeProgress())

  if (onboarding.path === null) {
    // Never started, and no sign they are already busy elsewhere.
    const busy =
      evidence.lessonsCompleted.size > 0 ||
      evidence.vizOpened.size > 0 ||
      evidence.challengesSolved.size > 0 ||
      evidence.circuitRuns > 0
    return !onboarding.seen && !busy ? { kind: 'invite' } : { kind: 'none' }
  }

  const progress = journeyProgress(onboarding.path, evidence, onboarding.completedSteps)
  if (progress.next === null) return { kind: 'none' }

  const gap = daysSinceLastActive(events)
  return {
    kind: 'resume',
    step: progress.next,
    progress,
    returning: gap !== null && gap >= RETURN_AFTER_DAYS,
  }
}

export default function ResumeBanner() {
  // `none` until the effect has run: every read below is localStorage, so the
  // first client render has to match the server's (which shows nothing).
  const [mode, setMode] = useState<Mode>({ kind: 'none' })
  const pathname = usePathname()

  // Re-derived on navigation: finishing a lesson should move the counter on
  // the next page, not on the next full reload.
  //
  // COST: one localStorage read + JSON.parse of at most 1,000 events (the ring
  // buffer cap in track.ts) plus two small stores, per navigation, after paint.
  //
  // Measured on the worst case — a full 1,000-event buffer, 148 KB of JSON,
  // parsed and normalized: median 1.95 ms, p95 3.81 ms over 50 runs in this
  // container. It runs in an effect, so it is off the paint path, but it is not
  // free. If MAX_EVENTS ever rises materially, memoise on the raw string rather
  // than re-parsing on every navigation.
  useEffect(() => {
    setMode(decideMode())
  }, [pathname])

  const dismiss = () => {
    dismissOnboarding()
    setMode({ kind: 'none' })
  }

  // The welcome flow is the thing being advertised; advertising it on top of
  // itself is noise.
  if (pathname === '/welcome') return null
  if (mode.kind === 'none') return null

  return (
    <div className="border-b border-line bg-surface-2">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2.5 text-sm">
        {mode.kind === 'invite' ? (
          <>
            <span aria-hidden="true" className="text-base leading-none">
              👋
            </span>
            <p className="min-w-0 flex-1 truncate text-ink-secondary">
              New here? Build a working two-qubit circuit in about two minutes
              <span className="ml-2 text-xs text-ink-muted">no account, nothing to install</span>
            </p>
            <Link
              href="/welcome"
              className="focus-ring shrink-0 text-sm font-semibold text-q-violet-text"
            >
              Start here →
            </Link>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="text-base leading-none">
              {mode.step.icon}
            </span>
            <p className="min-w-0 flex-1 truncate text-ink-secondary">
              {mode.returning ? (
                <>
                  Welcome back — here is where you were:{' '}
                  <span className="font-semibold text-ink">{mode.step.title}</span>
                </>
              ) : (
                <>
                  Pick up where you left off —{' '}
                  <span className="font-semibold text-ink">{mode.step.title}</span>
                </>
              )}
              <span className="ml-2 text-xs text-ink-muted">
                {mode.progress.completed} of {mode.progress.total} done · {mode.step.estMinutes} min
              </span>
            </p>
            <Link
              href={mode.step.href}
              // Recorded as VISITED, not completed: it moves the pointer on so
              // the same step is not re-offered on every page load, and it is
              // deliberately not counted in "N of M done", which only ever
              // reflects real evidence. See lib/analytics/journey.ts.
              onClick={() => markStepComplete(mode.step.id)}
              className="focus-ring shrink-0 text-sm font-semibold text-q-violet-text"
            >
              Continue →
            </Link>
          </>
        )}
        <button
          type="button"
          aria-label="Dismiss onboarding reminder permanently"
          title="Dismiss permanently"
          className="focus-ring shrink-0 rounded px-2 py-1 text-ink-muted transition-colors hover:text-ink"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
