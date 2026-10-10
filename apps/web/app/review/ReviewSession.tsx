'use client'

/**
 * ReviewSession — the client half of /review.
 *
 * The server page hands this component the reviewable question pool (free
 * lessons only — see the page header for why) and everything after that is
 * this device talking to itself: the schedule is read from localStorage after
 * mount, graded answers are written straight back through lib/review/scheduler,
 * and no byte of it goes anywhere else (docs/ANALYTICS.md).
 *
 * Session shape, after Quantum Country: one card at a time, answer locks on
 * first pick, the explanation appears immediately whether right or wrong, and
 * a missed card is re-queued at the end of the same sitting so the session
 * ends on recall, not on failure.
 *
 * Anti-dark-pattern rules (docs/ONBOARDING.md) applied here: the due count is
 * stated once as a plain fact, an empty queue is presented as a finished job
 * rather than a lapse, and nothing on this screen counts days, shames a gap,
 * or manufactures urgency.
 *
 * Progress is read AFTER mount because localStorage does not exist during
 * server rendering; the first client render matches the server's skeleton.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import DevicePractice from '@/components/review/DevicePractice'
import { loadProgress } from '@/lib/lessons/progress'
import {
  cardKey,
  dueKeys,
  gradeInSchedule,
  loadSchedule,
  saveSchedule,
  seedFromQuizScores,
  type ReviewSchedule,
} from '@/lib/review/scheduler'
import type { QuizQuestion } from '@/lib/lessons/types'

export interface ReviewCard extends QuizQuestion {
  lessonSlug: string
  lessonTitle: string
}

interface SessionState {
  schedule: ReviewSchedule
  queue: string[]
  index: number
  right: number
  wrong: number
}

export function ReviewSession({ cards }: { cards: ReviewCard[] }) {
  const cardByKey = useMemo(() => {
    const map = new Map<string, ReviewCard>()
    for (const card of cards) map.set(cardKey(card.lessonSlug, card.id), card)
    return map
  }, [cards])

  const [session, setSession] = useState<SessionState | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    const now = new Date()
    const loaded = loadSchedule()
    // Read-only integration with the lesson quizzes: a lesson whose quiz was
    // taken (its slug is in the progress store's quizScores) seeds cards for
    // its questions. The progress store itself is never written from here.
    const idsByLesson: Record<string, string[]> = {}
    for (const card of cards) {
      ;(idsByLesson[card.lessonSlug] ??= []).push(card.id)
    }
    const seeded = seedFromQuizScores(loaded, loadProgress().quizScores, idsByLesson, now)
    if (seeded !== loaded) saveSchedule(seeded)

    const queue = dueKeys(seeded, [...cardByKey.keys()], now)
    setSession({ schedule: seeded, queue, index: 0, right: 0, wrong: 0 })
  }, [cards, cardByKey])

  // Skeleton until localStorage has been read — matches the server render.
  if (session === null) {
    return (
      <div className="card animate-pulse p-6">
        <div className="h-4 w-40 rounded bg-surface-2" />
        <div className="mt-4 h-20 rounded bg-surface-2" />
      </div>
    )
  }

  const { schedule, queue, index } = session
  const scheduledCount = Object.keys(schedule.cards).length

  // Never quizzed anything: explain how cards get here, without a nag.
  if (queue.length === 0 && scheduledCount === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-base font-bold text-ink">No cards yet</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
          Questions join your review queue automatically the first time you answer a
          lesson quiz. Work through a lesson, take its quiz, and come back — the
          queue builds itself.
        </p>
        <Link href="/learn" className="focus-ring mt-4 inline-block rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-line-strong">
          Browse the lessons
        </Link>
      </div>
    )
  }

  // Everything scheduled is in the future: that is success, and it says so.
  if (index >= queue.length) {
    const reviewed = session.right + session.wrong
    const nextDue = Object.values(schedule.cards)
      .map((c) => Date.parse(c.due))
      .filter((t) => Number.isFinite(t) && t > Date.now())
      .sort((a, b) => a - b)[0]
    return (
      <div className="card p-6">
        <h2 className="text-base font-bold text-ink">
          {reviewed > 0 ? 'Session done' : 'Nothing due right now'}
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
          {reviewed > 0 ? (
            <>
              You reviewed <strong className="font-semibold text-ink">{reviewed}</strong>{' '}
              {reviewed === 1 ? 'card' : 'cards'} and recalled{' '}
              <strong className="font-semibold text-ink">{session.right}</strong> on the
              first try.{' '}
            </>
          ) : null}
          Each card you get right moves further into the future — that spacing is the
          point, so an empty queue means the system is working.
          {nextDue !== undefined ? (
            <> The next card comes due {new Date(nextDue).toLocaleDateString()}.</>
          ) : null}
        </p>
        <Link href="/learn" className="focus-ring mt-4 inline-block rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-line-strong">
          Back to the course
        </Link>
      </div>
    )
  }

  const key = queue[index]!
  const card = cardByKey.get(key)
  // A schedule entry whose question left the course: skip it silently.
  if (card === undefined) {
    setSession({ ...session, index: index + 1 })
    return null
  }

  const locked = picked !== null

  function pick(optionId: string) {
    if (locked || card === undefined || session === null) return
    setPicked(optionId)
    const correct = optionId === card.correctId
    const next = gradeInSchedule(session.schedule, key, correct, new Date())
    saveSchedule(next)
    // A miss comes back at the end of this sitting (once per sitting): the
    // scheduler has already stamped it due-again-soon, but showing it now is
    // what makes the session end on a successful recall.
    const requeue =
      !correct && !session.queue.slice(session.index + 1).includes(key)
        ? [...session.queue, key]
        : session.queue
    setSession({
      ...session,
      schedule: next,
      queue: requeue,
      right: session.right + (correct ? 1 : 0),
      wrong: session.wrong + (correct ? 0 : 1),
    })
  }

  function advance() {
    if (session === null) return
    setPicked(null)
    setSession({ ...session, index: session.index + 1 })
  }

  return (
    <>
      <section className="card p-6" aria-label="Review card">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            Card {Math.min(index + 1, queue.length)} of {queue.length}
          </span>
          <span className="text-[11px] text-ink-muted">from {card.lessonTitle}</span>
        </div>

        <p className="mt-4 text-[15px] font-semibold leading-relaxed text-ink">{card.prompt}</p>

        <div className="mt-4 space-y-2">
          {card.options.map((option) => {
            const isPicked = picked === option.id
            const isCorrect = option.id === card.correctId
            const showCorrect = locked && isCorrect
            const showWrong = locked && isPicked && !isCorrect
            const tone = showCorrect
              ? 'border-q-teal/60 bg-q-teal/10 text-q-teal-text'
              : showWrong
                ? 'border-q-rose/60 bg-q-rose/10 text-q-rose-text'
                : locked
                  ? 'border-line bg-surface-2 text-ink-muted'
                  : 'border-line bg-surface-2 text-ink-secondary hover:border-line-strong hover:text-ink'
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => pick(option.id)}
                disabled={locked}
                aria-pressed={isPicked}
                className={`focus-ring flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors duration-150 disabled:cursor-default ${tone}`}
              >
                <span aria-hidden="true" className="mt-px w-3.5 shrink-0 font-bold">
                  {showCorrect ? '✓' : showWrong ? '✗' : ''}
                </span>
                <span>{option.text}</span>
              </button>
            )
          })}
        </div>

        {locked ? (
          <>
            <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-secondary">
              <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.09em] text-q-violet">
                Why
              </span>
              {card.explanation}
            </p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-[13px] text-ink-muted">
                {picked === card.correctId
                  ? 'Scheduled further out.'
                  : 'It will come around again at the end of this session.'}
              </p>
              <button
                type="button"
                onClick={advance}
                className="focus-ring rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink hover:border-line-strong"
              >
                {index + 1 < queue.length ? 'Next card' : 'Finish'}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-4 text-[13px] text-ink-muted">
            Pick an answer to lock it in and see the explanation.
          </p>
        )}
      </section>

      {/* Machine-written extras, deliberately OUTSIDE the card's <section> and
          in its own frame: they are practice prompts, not course content, and
          nothing they produce touches the schedule above. */}
      <DevicePractice topic={card.lessonTitle} className="mt-4" />
    </>
  )
}
