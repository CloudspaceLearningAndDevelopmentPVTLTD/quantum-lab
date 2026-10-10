'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import FirstCircuit from '@/components/onboarding/FirstCircuit'
import PathPicker from '@/components/onboarding/PathPicker'
import { Button } from '@/components/ui/button'
import {
  collectEvidence,
  journeyProgress,
  type JourneyProgress,
} from '@/lib/analytics/journey'
import { getEvents } from '@/lib/analytics/track'
import { readProgress as readChallengeProgress } from '@/lib/challenges/types'
import { loadProgress } from '@/lib/lessons/progress'
import {
  ONBOARDING_DONE_STEP,
  dismissOnboarding,
  loadOnboarding,
  markSeen,
  markStepComplete,
  type OnboardingPath,
} from '@/lib/onboarding/state'
import { PATHS, totalMinutes } from '@/lib/onboarding/steps'

type Screen = 'circuit' | 'path' | 'done'

/**
 * THE CIRCUIT COMES FIRST. This used to be path-picker → circuit → done, which
 * put a three-way "what brings you here?" question — a question whose answer
 * changes nothing until the last screen — between a first-time visitor and the
 * only thing on this site that no article, video or textbook can do: place two
 * gates and watch real measured physics come back. Effort before payoff, on
 * the one screen where a visitor has the least reason to spend any.
 *
 * Reordered, the payoff is the first thing they touch and the segmentation
 * question is asked afterwards, when it is answering "what next?" — which is
 * the only moment it is actually useful. Both screens remain skippable.
 */
const SCREENS: { id: Screen; label: string }[] = [
  { id: 'circuit', label: 'First circuit' },
  { id: 'path', label: 'Your path' },
  { id: 'done', label: "You're set" },
]

export default function WelcomeFlow({ onDismissed }: { onDismissed?: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [screen, setScreen] = useState<Screen>('circuit')
  const [path, setPathState] = useState<OnboardingPath | null>(null)

  // Every localStorage read happens after mount, so the server and the first
  // client render agree. Until then we render the skeleton below, which
  // occupies the same box — no hydration mismatch, no layout shift.
  useEffect(() => {
    const state = loadOnboarding()
    setPathState(state.path)
    markSeen()
    setMounted(true)
  }, [])

  // Derived on demand rather than held in state: it is only read on the last
  // screen, and it must reflect work done in other tabs since this one mounted.
  const [journey, setJourney] = useState<JourneyProgress | null>(null)

  const finish = () => {
    markStepComplete(ONBOARDING_DONE_STEP)
    const state = loadOnboarding()
    setJourney(
      journeyProgress(
        state.path,
        collectEvidence(getEvents(), loadProgress(), readChallengeProgress()),
        state.completedSteps
      )
    )
    setScreen('done')
  }

  const dismiss = () => {
    dismissOnboarding()
    onDismissed?.()
  }

  const index = SCREENS.findIndex((s) => s.id === screen)
  const chosen = path ? PATHS[path] : null
  const minutes = path ? totalMinutes(path) : 0

  return (
    <div className="card mx-auto w-full max-w-2xl p-6 md:p-8">
      {/* Step indicator — rendered on server and client identically. */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Onboarding progress">
        {SCREENS.map((s, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo'
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className="flex-1 border-t-2 pt-2 text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200"
                style={{
                  borderColor: state === 'todo' ? 'var(--line)' : 'var(--q-violet)',
                  color: state === 'todo' ? 'var(--ink-muted)' : 'var(--q-violet-text)',
                }}
              >
                {i + 1}. {s.label}
              </span>
            </li>
          )
        })}
      </ol>

      {!mounted ? (
        // Same footprint as the picker so nothing jumps when state arrives.
        <div className="min-h-[420px]" aria-hidden="true" />
      ) : screen === 'circuit' ? (
        // No `onBack` on the first screen — there is nothing behind it.
        <FirstCircuit onDone={() => setScreen('path')} onSkip={() => setScreen('path')} />
      ) : screen === 'path' ? (
        <PathPicker
          selected={path}
          onSelect={(p) => {
            setPathState(p)
            finish()
          }}
          onSkip={finish}
          onBack={() => setScreen('circuit')}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <p className="section-label">Step 3 of 3</p>
            <h2 className="section-title mt-2">You&rsquo;re set</h2>
            <p className="section-desc mt-2">
              {chosen
                ? `Here is the rest of the "${chosen.label}" route — about ${minutes} minutes end to end. Take it in any order, or ignore it entirely.`
                : 'You skipped the path picker, so here is the whole site instead. The course is the safest place to start.'}
            </p>
          </div>

          {chosen && path ? (
            <>
              {/* A step already backed by evidence — a finished lesson, a
                  solved challenge, a circuit actually run — is ticked here
                  rather than offered again. Someone who found the simulator on
                  their own before opening this page should not be told to go
                  and do it. `journey` is null only if this screen were somehow
                  reached without `finish()`, in which case nothing is ticked
                  and the list is exactly what it always was. */}
              <ol className="space-y-2">
                {chosen.steps.map((step, i) => {
                  const done =
                    journey?.steps.find((s) => s.step.id === step.id)?.status === 'done'
                  return (
                    <li key={step.id}>
                      <Link
                        href={step.href}
                        className="card-hover focus-ring flex items-start gap-3 rounded-card border border-line bg-surface-2 p-3"
                      >
                        <span aria-hidden="true" className="text-lg leading-none">
                          {step.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-bold text-ink">
                              {i + 1}. {step.title}
                            </span>
                            <span
                              className="shrink-0 text-[11px]"
                              style={{
                                color: done ? 'var(--q-teal-text)' : 'var(--ink-muted)',
                              }}
                            >
                              {done ? 'done' : `${step.estMinutes} min`}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs text-ink-secondary">
                            {step.blurb}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ol>

              <Button asChild className="inline-flex">
                <Link href={chosen.steps[0].href}>{chosen.steps[0].cta} →</Link>
              </Button>
            </>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/learn">Start the course →</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/simulator">Open the simulator</Link>
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setScreen('path')}>
              Back
            </Button>
            <Button type="button" variant="secondary" onClick={dismiss}>
              Don&rsquo;t show onboarding again
            </Button>
          </div>
        </div>
      )}

      {mounted && screen !== 'done' ? (
        <div className="mt-6 border-t border-line pt-4 text-center">
          <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={dismiss}>
            Dismiss onboarding — I&rsquo;ll find my own way around
          </Button>
        </div>
      ) : null}
    </div>
  )
}
