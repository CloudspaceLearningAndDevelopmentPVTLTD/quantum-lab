'use client'

/**
 * /coach — the adaptive learning path.
 *
 * Everything on this page is computed in this browser from this browser's own
 * data: lesson progress, exam attempts, saved circuits and the local analytics
 * buffer. There is no request to a server anywhere in this file, no API key,
 * and no model deciding anything. The ranking rules are listed at the bottom of
 * the page on purpose — learners trust a recommender they can audit.
 *
 * Progress is read AFTER mount, because localStorage does not exist during
 * server rendering. Skeletons hold the layout in the meantime so there is
 * neither a hydration mismatch nor a jump when the real numbers arrive.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { announce } from '@/lib/a11y/announce'
import { GOALS, GoalPicker, loadGoal } from '@/components/coach/GoalPicker'
import { NextUpCard } from '@/components/coach/NextUpCard'
import { SkillMap } from '@/components/coach/SkillMap'
import { FollowedPathCard } from '@/components/paths/FollowedPathCard'
import { ProgressRing } from '@/components/lesson/ProgressRing'
import { CONCEPT_GRAPH } from '@/lib/coach/graph'
import {
  masteredCount,
  masteryByConcept,
  recommend,
  type CoachSignals,
} from '@/lib/coach/recommend'
import {
  currentWeekIndex,
  destinationForItem,
  loadWeeklyPlan,
  refreshWeeklyPlan,
  saveWeeklyPlan,
  type WeeklyPlan,
} from '@/lib/coach/weeklyPlan'
import { readProgress as readChallengeProgress } from '@/lib/challenges/types'
import { loadProgress, type Progress } from '@/lib/lessons/progress'
import { listAttempts } from '@/lib/exams/attempts'
import type { ExamAttempt } from '@/lib/exams/types'
import { listCircuits } from '@/lib/circuit-store'
import { getEvents } from '@/lib/analytics/track'

const EMPTY_PROGRESS: Progress = { completed: [], quizScores: {} }
const TOTAL_CONCEPTS = CONCEPT_GRAPH.length
const FIRST_LESSON = 'what-is-a-qubit'

const RULES: { name: string; text: string }[] = [
  {
    name: 'Revise',
    text: 'A lesson you finished but quizzed below 70% on comes first — everything downstream of it is built on that footing.',
  },
  {
    name: 'Advance to your goal',
    text: 'If you have set a goal, the coach shows the earliest unmet prerequisite for it, not the next lesson in the list.',
  },
  {
    name: 'Practise',
    text: 'If you have read about gates but never built a circuit, building one beats reading the next page.',
  },
  {
    name: 'Advance',
    text: 'Otherwise, the next lesson whose prerequisites you have all met.',
  },
  {
    name: 'Explore',
    text: 'Last, a visualization for something you have read about but never actually seen move.',
  },
]

interface CoachData {
  progress: Progress
  attempts: ExamAttempt[]
  signals: CoachSignals
}

export default function CoachPage() {
  const [data, setData] = useState<CoachData | null>(null)
  const [goal, setGoal] = useState('')
  const [plan, setPlan] = useState<WeeklyPlan | null>(null)

  useEffect(() => {
    let cancelled = false

    const progress = loadProgress()
    const attempts = listAttempts()
    // Visualizations the learner has actually opened, from the local analytics
    // buffer. An absent buffer simply means "none seen", which only affects the
    // lowest-priority rule.
    const seenVizSlugs = Array.from(
      new Set(
        getEvents()
          .filter((event) => event.name === 'viz.opened' || event.name === 'viz.interacted')
          .map((event) => event.props.slug)
          .filter((slug): slug is string => typeof slug === 'string')
      )
    )

    setGoal(loadGoal())
    setData({ progress, attempts, signals: { seenVizSlugs } })

    // The circuit store may be backed by Supabase, so it is async. Until it
    // resolves, `circuitsBuilt` stays undefined and the practise rule is
    // skipped rather than guessed at. If it rejects, it stays undefined.
    listCircuits()
      .then((circuits) => {
        if (cancelled) return
        setData((current) =>
          current === null
            ? current
            : { ...current, signals: { ...current.signals, circuitsBuilt: circuits.length } }
        )
      })
      .catch(() => {
        // Signal unavailable — see the comment on CoachSignals.
      })

    return () => {
      cancelled = true
    }
  }, [])

  /*
   * The multi-week plan. Refreshed (never rebuilt from scratch) whenever the
   * evidence or the goal changes: `refreshWeeklyPlan` keeps every finished
   * item ticked and in its week, and redraws only the road ahead. All the
   * planning logic is pure and clock-injected in lib/coach/weeklyPlan.ts —
   * this effect is just the impure shell that reads the stores, passes the
   * real clock in, and writes the result back to its one localStorage key.
   */
  useEffect(() => {
    if (!data) return
    const solvedChallengeIds = Object.entries(readChallengeProgress())
      .filter(([, entry]) => entry.solved)
      .map(([id]) => id)
    const next = refreshWeeklyPlan(
      loadWeeklyPlan(),
      goal,
      {
        progress: data.progress,
        examAttempts: data.attempts,
        solvedChallengeIds,
      },
      new Date()
    )
    saveWeeklyPlan(next)
    setPlan(next)
  }, [data, goal])

  const progress = data ? data.progress : EMPTY_PROGRESS
  const attempts = useMemo(() => (data ? data.attempts : []), [data])

  const mastery = useMemo(
    () => masteryByConcept(progress, attempts),
    [progress, attempts]
  )

  const recommendations = useMemo(() => {
    if (!data) return []
    return recommend(data.progress, data.attempts, goal, data.signals)
  }, [data, goal])

  const completedCount = CONCEPT_GRAPH.filter((n) =>
    progress.completed.includes(n.lessonSlug)
  ).length
  const mastered = masteredCount(mastery)
  const ratio = TOTAL_CONCEPTS > 0 ? completedCount / TOTAL_CONCEPTS : 0

  /*
   * A11Y (WCAG 4.1.3). Picking a goal is the whole point of this page and its
   * only effect is somewhere else on it: the three recommendation cards below
   * are re-ranked. `aria-pressed` on the chip covers "this chip is now on"; it
   * says nothing about the three cards that just changed, which are not in a
   * live region and are too long to make one. Announcing the top
   * recommendation is the useful summary — it is the thing the coach is
   * actually telling the learner to do.
   *
   * Wrapped rather than announced from an effect on `goal`, because `goal` is
   * also set once on mount from localStorage and a page that talks to you
   * before you have touched it is a defect of its own.
   */
  const handleGoalChange = useCallback(
    (next: string) => {
      setGoal(next)
      if (!data) return
      const ranked = recommend(data.progress, data.attempts, next, data.signals)
      const label = GOALS.find((g) => g.slug === next)?.label ?? 'no goal'
      announce(
        ranked.length > 0
          ? `Goal set to ${label}. ${ranked.length} recommendation${ranked.length === 1 ? '' : 's'} re-ranked. Next up: ${ranked[0].title}. ${ranked[0].why}`
          : `Goal set to ${label}. No recommendations — the course is complete.`
      )
    },
    [data]
  )

  // Derived plan numbers for the panel. `currentWeekIndex` is the first week
  // with anything left in it — a position in the work, not on the calendar.
  const planWeekIndex = plan === null ? 0 : currentWeekIndex(plan)
  const planItems = useMemo(() => (plan?.weeks ?? []).flatMap((w) => w.items), [plan])
  const planItemCount = planItems.length
  const planDoneCount = planItems.filter((item) => item.done).length

  const loaded = data !== null
  const isNewLearner =
    loaded && progress.completed.length === 0 && Object.keys(progress.quizScores).length === 0

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      <header>
        <p className="section-label">Coach</p>
        <h1 className="section-title mt-1">What to study next</h1>
        <p className="section-desc mt-2 max-w-2xl">
          Computed from your own progress, in your browser. Nothing on this page
          is sent anywhere, and the rules behind every recommendation are listed
          at the bottom so you can check the coach&rsquo;s working.
        </p>
      </header>

      <section className="card mt-8 flex flex-wrap items-center gap-6 p-5">
        {loaded ? (
          <ProgressRing ratio={ratio} size={88} label="Course" />
        ) : (
          <div className="h-[88px] w-[88px] animate-pulse rounded-full bg-surface-2" />
        )}
        <div>
          <p className="text-lg font-bold text-ink">
            {loaded ? (
              <>
                {completedCount} of {TOTAL_CONCEPTS} lessons, {mastered}{' '}
                {mastered === 1 ? 'concept' : 'concepts'} mastered
              </>
            ) : (
              <span className="inline-block h-5 w-64 animate-pulse rounded bg-surface-2" />
            )}
          </p>
          <p className="section-desc mt-1">
            A concept counts as mastered at 80%, blending completion with your
            quiz and exam scores.
          </p>
        </div>
      </section>

      <FollowedPathCard />

      <section className="mt-10">
        <GoalPicker value={goal} onChange={handleGoalChange} />
      </section>

      <section className="mt-10">
        <h2 className="section-title text-xl">Your next three steps</h2>

        {!loaded ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-44 animate-pulse p-5">
                <div className="h-4 w-20 rounded bg-surface-2" />
                <div className="mt-4 h-5 w-3/4 rounded bg-surface-2" />
                <div className="mt-3 h-3 w-full rounded bg-surface-2" />
                <div className="mt-2 h-3 w-5/6 rounded bg-surface-2" />
              </div>
            ))}
          </div>
        ) : isNewLearner ? (
          /*
            A brand-new learner has nothing to rank, so ranking nothing would
            produce an empty page that looks broken. One unambiguous starting
            point instead — and the map below stays visible in its outlined
            state, so they can see where the path goes.
          */
          <article className="card mt-4 p-6 ring-1 ring-q-violet ring-offset-2 ring-offset-bg">
            {/* A11Y (WCAG 1.4.3): was the literal #c1bbfe, which measures
                1.78:1 on the light card surface. The token is that same value
                in dark (10.57:1) and darkens to 10.92:1 in light. */}
            <span
              className="pill"
              style={{ borderColor: 'var(--q-violet)', color: 'var(--q-violet-text)' }}
            >
              Start here
            </span>
            <h3 className="mt-3 text-xl font-bold text-ink">What Is a Qubit?</h3>
            <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
              You have not completed anything yet, so there is nothing to
              personalise from — and one clear first step beats a guess. This
              lesson has no prerequisites and every other concept on the map
              below sits downstream of it.
            </p>
            <div className="mt-4">
              <Link href={`/learn/${FIRST_LESSON}`} className="btn-primary focus-ring">
                Start the first lesson
              </Link>
            </div>
          </article>
        ) : recommendations.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {recommendations.map((rec, index) => (
              <NextUpCard
                key={`${rec.kind}-${rec.lessonSlug ?? ''}-${rec.vizSlug ?? ''}`}
                rec={rec}
                rank={index + 1}
              />
            ))}
          </div>
        ) : (
          <article className="card mt-4 p-6">
            <h3 className="text-lg font-bold text-ink">You have finished the course</h3>
            <p className="mt-2 text-sm text-ink-secondary">
              Every lesson is complete and every quiz is above the revision
              threshold. Sit a certification exam, or take a circuit of your own
              into the simulator.
            </p>
            <div className="mt-4 flex gap-3">
              <Link href="/certify" className="btn-primary focus-ring">
                Certification exams
              </Link>
              <Link href="/simulator" className="btn-ghost focus-ring">
                Open the simulator
              </Link>
            </div>
          </article>
        )}
      </section>

      {/*
        The multi-week plan. Rules it is held to (docs/ONBOARDING.md): ticks are
        DERIVED from what actually happened — a lesson completed, a challenge
        solved, a quiz passed — never from clicking the row; there is no streak,
        no countdown and no deadline anywhere in it; and "this week" is simply
        the first week with something left in it, so coming back after a month
        lands on the same next step with nothing expired or reset.
      */}
      <section className="mt-10">
        <h2 className="section-title text-xl">Your plan</h2>
        <p className="section-desc mt-1 max-w-2xl">
          A week-sized path toward your goal, computed here in your browser and
          rebuilt around whatever you have already finished. Ticks fill in on
          their own when you complete a lesson, solve a challenge or pass a
          quiz — the plan reads your progress, it never asks you to claim it.
          Changing your goal above redraws the road ahead and leaves finished
          work alone.
        </p>
        {plan === null || plan.weeks.length === 0 ? (
          <div className="card mt-4 h-40 animate-pulse p-5">
            <div className="h-4 w-28 rounded bg-surface-2" />
            <div className="mt-4 h-3 w-2/3 rounded bg-surface-2" />
            <div className="mt-2 h-3 w-1/2 rounded bg-surface-2" />
            <div className="mt-2 h-3 w-3/5 rounded bg-surface-2" />
          </div>
        ) : (
          <div className="card mt-4 p-5">
            <p className="section-label">
              Week {planWeekIndex + 1} of {plan.weeks.length}
            </p>
            <ul className="mt-3 space-y-2.5">
              {plan.weeks[planWeekIndex]!.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                      item.done
                        ? 'border-q-violet bg-surface-3 text-q-violet-text'
                        : 'border-line text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <Link
                    href={destinationForItem(item)}
                    className={`focus-ring text-sm ${
                      item.done ? 'text-ink-muted' : 'text-ink hover:underline'
                    }`}
                  >
                    {item.label}
                    <span className="sr-only">
                      {item.done ? ' — done' : ' — not done yet'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-ink-muted">
              {planDoneCount} of {planItemCount} items done across the whole
              plan. Nothing here expires, and a week that takes longer than a
              week costs you nothing.
            </p>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="section-title text-xl">Your skill map</h2>
        <p className="section-desc mt-1">
          Prerequisites run left to right. Everything to the right of a gap is
          waiting on it.
        </p>
        <div className="mt-4">
          <SkillMap
            mastery={mastery}
            {...(progress.lastVisited !== undefined
              ? { currentSlug: progress.lastVisited }
              : {})}
          />
        </div>
      </section>

      <footer className="mt-12 border-t border-line pt-6">
        <h2 className="section-label">How this is ranked</h2>
        <ol className="mt-3 space-y-2">
          {RULES.map((rule, index) => (
            <li key={rule.name} className="text-[13px] text-ink-secondary">
              <span className="font-semibold text-ink">
                {index + 1}. {rule.name}.
              </span>{' '}
              {rule.text}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11px] text-ink-muted">
          The ranking is deterministic and runs entirely offline — the same
          progress always produces the same three recommendations.
        </p>
      </footer>
    </div>
  )
}
