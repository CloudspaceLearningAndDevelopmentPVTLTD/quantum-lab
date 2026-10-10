'use client'

/**
 * PathJourney — the milestone timeline on /paths/[slug].
 *
 * Steps arrive already resolved from the server (titles, hrefs, levels), so
 * this component only adds what needs the browser: which steps are done, the
 * "continue" button, manual ticks, and following the path.
 *
 * Lessons and challenges complete themselves — the lesson page and the grader
 * already record them — so they show a status, not a checkbox. Ticking a lesson
 * by hand would let a path claim a lesson was finished when its quiz was not.
 * Visualizations, tools and pages cannot be observed being understood, so the
 * learner ticks those themselves.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { announce } from '@/lib/a11y/announce'
import {
  isStepDone,
  loadPathsState,
  readCompletionSources,
  setActivePath,
  setTicked,
  STEP_KIND_LABEL,
  type CompletionSources,
  type ResolvedStep,
} from '@/lib/paths/resolve'

export interface JourneyMilestone {
  title: string
  summary: string
  steps: ResolvedStep[]
}

const LEVEL_PILL: Record<string, string> = {
  Beginner: 'border-q-teal/30 bg-q-teal/15 text-q-teal-text',
  Intermediate: 'border-q-violet/30 bg-q-violet/15 text-q-violet-text',
  Advanced: 'border-q-amber/30 bg-q-amber/15 text-q-amber-text',
}

const EMPTY: CompletionSources = { completedLessons: [], solvedChallenges: [], ticked: [] }

export function PathJourney({
  slug,
  title,
  rgb,
  milestones,
}: {
  slug: string
  title: string
  rgb: string
  milestones: JourneyMilestone[]
}) {
  const [sources, setSources] = useState<CompletionSources>(EMPTY)
  const [following, setFollowing] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setSources(readCompletionSources())
    setFollowing(loadPathsState().active === slug)
    setLoaded(true)
  }, [slug])

  const steps = useMemo(() => milestones.flatMap((m) => m.steps), [milestones])
  const done = steps.filter((s) => isStepDone(s, sources)).length
  const next = steps.find((s) => !isStepDone(s, sources))
  const ratio = steps.length ? done / steps.length : 0
  const finished = loaded && done === steps.length

  const toggle = useCallback((step: ResolvedStep, value: boolean) => {
    const state = setTicked(step.key, value)
    setSources((prev) => ({ ...prev, ticked: state.ticked }))
    announce(value ? `Marked “${step.title}” done.` : `Unmarked “${step.title}”.`)
  }, [])

  const toggleFollow = useCallback(() => {
    const nextValue = !following
    setActivePath(nextValue ? slug : undefined)
    setFollowing(nextValue)
    announce(nextValue ? `Following ${title}.` : `Stopped following ${title}.`)
  }, [following, slug, title])

  return (
    <>
      <section className="card z-10 mt-8 p-5 sm:sticky sm:top-16" aria-label="Your progress on this path">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {!loaded
                ? ' '
                : finished
                  ? 'Path complete — every step done.'
                  : done === 0
                    ? `${steps.length} steps ahead of you`
                    : `${done} of ${steps.length} steps done`}
            </p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Path progress"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={done}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: `rgb(${rgb})` }}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {next ? (
              <Link href={next.href} className="btn-primary focus-ring">
                {done === 0 ? 'Start' : 'Continue'}: {next.title}
              </Link>
            ) : null}
            <button type="button" onClick={toggleFollow} aria-pressed={following} className="btn-ghost focus-ring">
              {following ? '★ Following' : '☆ Follow this path'}
            </button>
          </div>
        </div>
      </section>

      {finished ? (
        <section
          className="card mt-6 p-6 text-center"
          style={{ backgroundImage: `radial-gradient(80% 120% at 50% 0%, rgb(${rgb} / 0.18), transparent 70%)` }}
          aria-label="Path complete"
        >
          <p aria-hidden="true" className="text-4xl">🏆</p>
          <h2 className="mt-2 text-xl font-bold text-ink">You finished {title}.</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-secondary">
            That is real work, done step by step. Make it official with a certification exam, or
            pick the next path — everything you have finished already counts there.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/certify" className="btn-primary focus-ring">Get certified</Link>
            <Link href="/paths" className="btn-ghost focus-ring">Choose the next path</Link>
          </div>
        </section>
      ) : null}

      <ol className="mt-10 space-y-10" aria-label="Milestones">
        {milestones.map((milestone, index) => {
          const milestoneDone = milestone.steps.filter((s) => isStepDone(s, sources)).length
          const complete = loaded && milestoneDone === milestone.steps.length
          return (
            <li key={milestone.title} className="relative pl-11 sm:pl-14">
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-full border-2 text-sm font-bold tabular-nums sm:h-10 sm:w-10"
                style={{
                  borderColor: `rgb(${rgb})`,
                  backgroundColor: complete ? `rgb(${rgb})` : 'transparent',
                  color: complete ? 'var(--surface)' : `rgb(${rgb})`,
                }}
              >
                {complete ? '✓' : index + 1}
              </span>
              {index < milestones.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-[-2.5rem] left-[17px] top-11 w-0.5 sm:left-[19px]"
                  style={{ backgroundColor: `rgb(${rgb} / 0.3)` }}
                />
              ) : null}

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-lg font-bold text-ink">
                  <span className="sr-only">Milestone {index + 1}: </span>
                  {milestone.title}
                </h2>
                <span className="text-xs font-semibold text-ink-muted">
                  {loaded ? `${milestoneDone}/${milestone.steps.length}` : `${milestone.steps.length} steps`}
                  {complete ? ' · milestone reached' : ''}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{milestone.summary}</p>

              <ul className="mt-4 space-y-2.5">
                {milestone.steps.map((step) => {
                  const stepDone = isStepDone(step, sources)
                  const isNext = loaded && next?.key === step.key
                  return (
                    <li
                      key={step.key}
                      className={`card flex items-start gap-3 p-3.5 transition-opacity sm:p-4 ${stepDone ? 'opacity-75' : ''}`}
                      style={isNext ? { boxShadow: `0 0 0 2px rgb(${rgb} / 0.6)` } : undefined}
                    >
                      <span aria-hidden="true" className="mt-0.5 text-xl leading-none">{step.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
                            {STEP_KIND_LABEL[step.kind]}
                          </span>
                          {step.level ? (
                            <span className={`pill ${LEVEL_PILL[step.level] ?? 'border-line text-ink-muted'}`}>{step.level}</span>
                          ) : null}
                          {step.minutes ? <span className="text-xs text-ink-muted">{step.minutes} min</span> : null}
                          {isNext ? (
                            <span className="pill border-line text-ink-secondary">Up next</span>
                          ) : null}
                        </div>
                        <Link
                          href={step.href}
                          className={`focus-ring mt-1 inline-block rounded text-[15px] font-semibold text-ink underline-offset-4 hover:underline ${stepDone ? 'line-through decoration-1' : ''}`}
                        >
                          {step.title}
                        </Link>
                        <p className="mt-0.5 text-sm text-ink-secondary">{step.why}</p>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        {step.autoTracked ? (
                          <span
                            className={`text-xs font-semibold ${stepDone ? 'text-q-teal-text' : 'text-ink-muted'}`}
                            title={step.kind === 'lesson' ? 'Completes when you finish the lesson' : 'Completes when you solve the challenge'}
                          >
                            {stepDone ? '✓ Done' : 'Auto-tracks'}
                          </span>
                        ) : (
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-secondary">
                            <input
                              type="checkbox"
                              className="focus-ring h-4 w-4 cursor-pointer accent-[var(--q-teal)]"
                              aria-label={`Mark “${step.title}” done`}
                              checked={stepDone}
                              disabled={!loaded}
                              onChange={(e) => toggle(step, e.target.checked)}
                            />
                            <span aria-hidden="true">Done</span>
                          </label>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>

      <p className="mt-8 text-xs text-ink-muted">
        Progress is stored in this browser only. Lessons tick themselves when you finish them and
        challenges when you solve them; everything else you tick yourself, because opening a page
        is not the same as understanding it.
      </p>
    </>
  )
}
