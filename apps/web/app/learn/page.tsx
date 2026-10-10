'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import CourseSignup from '@/components/email/CourseSignup'
import { ProgressRing } from '@/components/lesson/ProgressRing'
import { LESSONS, TRACKS, allSlugs } from '@/lib/lessons'
import { loadProgress, resetProgress } from '@/lib/lessons/progress'
import type { Lesson, Level } from '@/lib/lessons/types'

const LEVEL_TONE: Record<Level, string> = {
  Beginner: 'border-q-teal/40 text-q-teal-text',
  Intermediate: 'border-q-amber/40 text-q-amber-text',
  Advanced: 'border-q-rose/40 text-q-rose-text',
}

/**
 * Both tracks, in `TRACKS` order.
 *
 * This page used to render `TRACKS[0]` only, which meant the four Advanced
 * lessons — written, routed, indexed by search, and examined by the Advanced
 * certification — had no entry point anywhere in the course UI. The only ways
 * in were the command palette and a coach recommendation. Meanwhile the
 * progress ring below has always counted `allSlugs()`, so a learner who
 * finished every lesson the page showed them was told "7 of 11 complete" with
 * no way to find the other four. Anything added to `TRACKS` now appears here;
 * nothing is track-indexed by hand.
 */
const TRACK_LESSONS: { track: (typeof TRACKS)[number]; lessons: Lesson[] }[] = TRACKS.map(
  (track) => ({
    track,
    lessons: track.lessonSlugs
      .map((slug) => LESSONS.find((lesson) => lesson.slug === slug))
      .filter((lesson): lesson is Lesson => lesson !== undefined),
  }),
)

const FOUNDATIONS = TRACK_LESSONS[0]

export default function LearnIndexPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="max-w-2xl">
        <p className="section-label">Course</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">Learn</h1>
        <p className="section-desc mt-3">
          {/* Counts are derived, never written out — a hardcoded number in prose is a
              guaranteed future lie the first time a lesson is added. */}
          A guided path from &ldquo;what is a qubit&rdquo; to Grover&rsquo;s search in{' '}
          {FOUNDATIONS.lessons.length} lessons, then {TRACK_LESSONS[1].lessons.length} more
          that pick up where it stops. Each lesson builds directly on the one before it, and
          each links to a live simulation you can play with — so every idea you read about is
          an idea you can go and poke at until it makes sense.
        </p>
      </header>

      <ProgressPanel />

      {TRACK_LESSONS.map(({ track, lessons }, trackIndex) => (
        <section key={track.id} className="mt-12" aria-labelledby={`track-${track.id}`}>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id={`track-${track.id}`} className="section-title text-2xl">
              {track.name}
            </h2>
            {track.id === 'advanced' ? (
              <span className="pill border-q-violet/40 text-q-violet-text">
                Included with Pro
              </span>
            ) : (
              <span className="pill border-q-teal/40 text-q-teal-text">Free</span>
            )}
          </div>
          <p className="section-desc mt-2 max-w-3xl">{track.blurb}</p>

          {track.id === 'advanced' ? (
            <p className="mt-2 max-w-3xl text-[13px] text-ink-muted">
              {/* No count in this sentence on purpose — see the header comment:
                  a hardcoded number here went stale once already ("These four"). */}
              These lessons assume the whole of Quantum Foundations — and the later ones build
              on each other: quantum machine learning and QAOA both reuse the variational loop
              from the NISQ lesson.
              <span data-store-hide>
                {' '}
                <Link href="/pricing" className="focus-ring text-ink-secondary underline">
                  See what Pro includes
                </Link>
                .
              </span>
            </p>
          ) : null}

          <ol className="mt-6 space-y-3">
            {lessons.map((lesson, index) => (
              <li key={lesson.slug}>
                {/* Numbering continues across tracks: the advanced lessons are lesson 8
                    onward of one course, not a second course starting again at 1. */}
                <LessonRow
                  lesson={lesson}
                  index={
                    index +
                    TRACK_LESSONS.slice(0, trackIndex).reduce((n, t) => n + t.lessons.length, 0)
                  }
                />
              </li>
            ))}
          </ol>
        </section>
      ))}

      {/* The 7-day email course signup lives HERE, below both tracks, and
          nowhere else: a person at the bottom of the course index has seen
          what the lessons are and is choosing how to work through them —
          the one audience for whom "a day at a time, by email" is an offer
          rather than an interruption. The component's copy carries the
          honest terms (double opt-in, one-click unsubscribe, no tracking);
          see docs/ONBOARDING.md §"Email: nothing is sent, on purpose". */}
      <section aria-label="Email course signup" className="mt-16 max-w-2xl border-t pt-8">
        <CourseSignup />
        <p className="mt-3 text-[13px] text-ink-muted">
          The same seven ideas as the foundations track, one per morning, each ending at a
          simulation you can drag. No account needed, no tracking pixels, and the emails are
          plain text — your address is stored for this course only and never shared.
        </p>
      </section>
    </div>
  )
}

/** Progress summary — mount-gated so the server markup and first client render match. */
function ProgressPanel() {
  const [mounted, setMounted] = useState(false)
  const [completed, setCompleted] = useState<string[]>([])
  const [lastVisited, setLastVisited] = useState<string | undefined>(undefined)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const refresh = useCallback(() => {
    const progress = loadProgress()
    setCompleted(progress.completed)
    setLastVisited(progress.lastVisited)
  }, [])

  useEffect(() => {
    refresh()
    setMounted(true)
  }, [refresh])

  const slugs = allSlugs()
  const doneCount = slugs.filter((slug) => completed.includes(slug)).length
  const ratio = slugs.length === 0 ? 0 : doneCount / slugs.length

  const resumeSlug =
    lastVisited !== undefined && slugs.includes(lastVisited) ? lastVisited : slugs[0]
  // LESSONS, not one track's list: the last-read lesson may be an advanced one,
  // and looking it up in the foundations array only would silently drop the
  // "Last read" line for exactly the learners who paid.
  const resumeLesson = LESSONS.find((lesson) => lesson.slug === resumeSlug)

  function handleReset() {
    if (!confirmingReset) {
      setConfirmingReset(true)
      return
    }
    resetProgress()
    setConfirmingReset(false)
    refresh()
  }

  return (
    <section className="card mt-8 flex flex-wrap items-center gap-6 p-6">
      <div className="min-h-[96px] min-w-[96px]">
        {mounted ? <ProgressRing ratio={ratio} size={96} /> : null}
      </div>

      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-bold text-ink">
          {mounted ? `${doneCount} of ${slugs.length} lessons complete` : 'Your progress'}
        </p>
        <p className="mt-1 text-[13px] text-ink-secondary">
          {mounted && doneCount === slugs.length
            ? 'You have finished both tracks — every lesson is marked complete.'
            : 'Progress is stored in this browser by default, and is only uploaded if you opt into sharing it with an organisation.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href={`/learn/${resumeSlug}`} className="btn-primary focus-ring">
            {mounted && lastVisited !== undefined
              ? 'Continue where you left off'
              : 'Start the course'}
          </Link>
          <button type="button" onClick={handleReset} className="btn-ghost focus-ring">
            {confirmingReset ? 'Click again to confirm' : 'Reset progress'}
          </button>
        </div>
        {mounted && resumeLesson && lastVisited !== undefined ? (
          <p className="mt-3 text-[12px] text-ink-muted">
            Last read: {resumeLesson.title}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function LessonRow({ lesson, index }: { lesson: Lesson; index: number }) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDone(loadProgress().completed.includes(lesson.slug))
  }, [lesson.slug])

  return (
    <Link
      href={`/learn/${lesson.slug}`}
      className="card card-hover focus-ring flex items-start gap-4 p-5"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-sm font-bold text-ink-secondary"
      >
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        {/* h3, not h2: each track is now an h2 section, and a lesson title is a
            level below its track. Skipping or flattening levels is what makes a
            screen-reader heading list unusable for navigation. */}
        <h3 className="text-[15px] font-bold text-ink">{lesson.title}</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-secondary">
          {lesson.subtitle}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`pill ${LEVEL_TONE[lesson.level]}`}>{lesson.level}</span>
          <span className="text-[12px] text-ink-muted">{lesson.minutes} min</span>
        </p>
      </div>

      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done ? 'bg-q-teal text-bg' : 'border border-line-strong text-transparent'
        }`}
      >
        <span aria-hidden="true">✓</span>
        <span className="sr-only">{done ? 'Completed' : 'Not yet completed'}</span>
      </span>
    </Link>
  )
}
