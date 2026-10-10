/**
 * /review — spaced-repetition over the lesson quiz bank (roadmap #5).
 *
 * A Server Component on purpose: quiz question text lives in the lesson
 * BODIES, which are reachable only through lib/lessons/server.ts (see that
 * file's header — the bundle test keeps bodies out of every client chunk).
 * This page assembles the reviewable pool on the server and hands it to the
 * client session as props.
 *
 * ONLY FREE (foundations) LESSONS ARE IN THE POOL. This page has no
 * entitlement check — like every RSC in this app it cannot know who is asking
 * (lib/lessons/access.ts explains why) — so serialising an advanced lesson's
 * quiz text into this page's HTML would hand paid course content to curl.
 * When a per-user content route exists for review, the pool can widen; until
 * then, absence is the honest gate.
 *
 * Scheduling, grading and the queue itself are entirely client-side and
 * local-first — lib/review/scheduler.ts and docs/ANALYTICS.md.
 */

import type { Metadata } from 'next'

import { LESSONS } from '@/lib/lessons'
import { isLessonFree } from '@/lib/lessons/access'
import { getLessonBody } from '@/lib/lessons/server'
import { pageMetadata } from '@/lib/seo'
import { ReviewSession, type ReviewCard } from './ReviewSession'

export const metadata: Metadata = pageMetadata({
  title: 'Review',
  description:
    'A few minutes of recall practice. Questions from quizzes you have taken come back on a spacing schedule, computed and stored on your device.',
  path: '/review',
})

/** Every quiz question of every free lesson, in course order. */
function reviewPool(): ReviewCard[] {
  const pool: ReviewCard[] = []
  for (const lesson of LESSONS) {
    if (!isLessonFree(lesson.slug)) continue
    const blocks = getLessonBody(lesson.slug)
    if (!blocks) continue
    for (const block of blocks) {
      if (block.kind !== 'quiz') continue
      for (const question of block.questions) {
        pool.push({ ...question, lessonSlug: lesson.slug, lessonTitle: lesson.title })
      }
    }
  }
  return pool
}

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold text-ink">Review</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
          Recall beats re-reading. Questions from quizzes you have already taken come
          back here on a spacing schedule: get one right and it returns later; miss it
          and it returns sooner. The schedule lives in this browser and nowhere else.
        </p>
      </header>

      <div className="mt-8">
        <ReviewSession cards={reviewPool()} />
      </div>
    </div>
  )
}
