'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LESSONS, TRACKS } from '@/lib/lessons'
import { loadProgress } from '@/lib/lessons/progress'
import type { Lesson, Level } from '@/lib/lessons/types'

interface LessonNavProps {
  currentSlug: string
}

const LEVEL_TONE: Record<Level, string> = {
  Beginner: 'border-q-teal/40 text-q-teal-text',
  Intermediate: 'border-q-amber/40 text-q-amber-text',
  Advanced: 'border-q-rose/40 text-q-rose-text',
}

/**
 * Every track, in TRACKS order, with lesson numbering continuous across them.
 *
 * This list used to be `TRACKS[0]` only. The consequence was invisible while
 * `/learn` also linked to the foundations seven, and became reachable the
 * moment the index started linking the advanced four: on `/learn/shor` the
 * sidebar was headed "Quantum Foundations", listed seven lessons the reader
 * was not on, marked none of them current, and offered no way back to the
 * lesson they were reading. Derive from TRACKS; do not index one by hand.
 */
const TRACK_LESSONS: { track: (typeof TRACKS)[number]; lessons: Lesson[]; offset: number }[] =
  (() => {
    let offset = 0
    return TRACKS.map((track) => {
      const lessons = track.lessonSlugs
        .map((slug) => LESSONS.find((lesson) => lesson.slug === slug))
        .filter((lesson): lesson is Lesson => lesson !== undefined)
      const entry = { track, lessons, offset }
      offset += lessons.length
      return entry
    })
  })()

export function LessonNav({ currentSlug }: LessonNavProps) {
  // Start empty so server and client render the same markup, then fill in
  // real progress after mount.
  const [completed, setCompleted] = useState<string[]>([])

  useEffect(() => {
    setCompleted(loadProgress().completed)
  }, [])

  return (
    <nav aria-label="Course lessons" className="lg:sticky lg:top-20">
      {TRACK_LESSONS.map(({ track, lessons, offset }) => (
        <div key={track.id} className={offset === 0 ? undefined : 'mt-6'}>
          <p className="section-label">{track.name}</p>
          <ol start={offset + 1} className="mt-3 space-y-1">
            {lessons.map((lesson, index) => {
          const isCurrent = lesson.slug === currentSlug
          const isDone = completed.includes(lesson.slug)

          return (
            <li key={lesson.slug}>
              <Link
                href={`/learn/${lesson.slug}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={`focus-ring block rounded-lg border px-3 py-2.5 transition-colors duration-150 ${
                  isCurrent
                    ? 'border-q-violet/50 bg-surface-2'
                    : 'border-transparent hover:border-line hover:bg-surface'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                      isDone
                        ? 'bg-q-teal text-bg'
                        : 'border border-line-strong text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-[13px] font-semibold leading-snug ${
                        isCurrent ? 'text-ink' : 'text-ink-secondary'
                      }`}
                    >
                      <span className="mr-1.5 text-ink-muted">{offset + index + 1}.</span>
                      {lesson.title}
                    </p>
                    <p className="mt-1.5 flex items-center gap-2">
                      <span className={`pill ${LEVEL_TONE[lesson.level]}`}>
                        {lesson.level}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {lesson.minutes} min
                      </span>
                      <span className="sr-only">
                        {isDone ? 'Completed' : 'Not yet completed'}
                      </span>
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          )
            })}
          </ol>
        </div>
      ))}
    </nav>
  )
}
