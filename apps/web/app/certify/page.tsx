'use client'

/**
 * /certify — the certification index.
 *
 * Where the numbers on this page come from changed completely. "Your best" and
 * "Passed ✓" used to be read out of localStorage, which meant they were claims
 * the browser made about itself; they now come from `/api/exams/summary`, which
 * reads the server's attempt rows for the verified caller. A signed-in
 * candidate therefore sees the same history on a new laptop, and a candidate
 * who edits their storage sees no change at all.
 *
 * Track readiness is still local, and that is correct: lesson progress is a
 * study aid, has never claimed to be verified, and nothing is issued on it.
 *
 * Everything asynchronous is loaded in an effect and rendered as "—" first, the
 * same discipline the lesson pages use, because this route is statically
 * rendered and any other order is a hydration mismatch.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { EXAMS, examPoolSize } from '@/lib/exams/catalogue'
import { dismissLegacyAttempts, listLegacyAttempts } from '@/lib/exams/attempts'
import { authFetch } from '@/lib/authFetch'
import { completionRatio } from '@/lib/lessons/progress'
import { TRACKS } from '@/lib/lessons'
import { useEntitlement } from '@/components/billing/useEntitlement'
import { PLAN_BY_ID, hasFeature, requiredPlanFor } from '@/lib/plans'
import type { Exam, ExamAttempt } from '@/lib/exams/types'

interface ExamSummary {
  examId: string
  attempts: number
  bestScore: number | null
  passed: boolean
  certificateId?: string
  openAttemptExpiresAt?: string
}

interface ExamStats {
  summary: ExamSummary | undefined
  readiness: number
}

type StatsMap = Record<string, ExamStats>

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export default function CertifyPage() {
  const { entitlement, loading } = useEntitlement()
  const [stats, setStats] = useState<StatsMap | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [legacy, setLegacy] = useState<ExamAttempt[]>([])

  useEffect(() => {
    setLegacy(listLegacyAttempts())
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let summaries: ExamSummary[] = []
      try {
        const res = await authFetch('/api/exams/summary', { cache: 'no-store' })
        if (res.ok) {
          const body = (await res.json()) as { summaries?: ExamSummary[]; signedIn?: boolean }
          summaries = body.summaries ?? []
          if (!cancelled) setSignedIn(body.signedIn === true)
        }
        // A failed summary is not an error state on this page: the exam cards
        // still work, the candidate just sees "—" where a past score would be.
        // Blocking the whole index on a history lookup would be worse.
      } catch {
        summaries = []
      }
      if (cancelled) return

      const byExam = new Map(summaries.map((s) => [s.examId, s]))
      const next: StatsMap = {}
      for (const exam of EXAMS) {
        const track = TRACKS.find((t) => t.id === exam.trackId)
        next[exam.id] = {
          summary: byExam.get(exam.id),
          readiness: track ? completionRatio(track.lessonSlugs) : 0,
        }
      }
      setStats(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const discardLegacy = useCallback(() => {
    dismissLegacyAttempts()
    setLegacy([])
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="max-w-2xl">
        <p className="section-label">Certification</p>
        <h1 className="section-title mt-2 text-3xl md:text-4xl">
          Prove you actually understand it
        </h1>
        <p className="section-desc mt-3">
          {EXAMS.length} timed exams drawn from the course material. Questions are pulled at random from a
          much larger pool, so every attempt is a different paper — you cannot memorise your way
          through. Papers are served without their answers and graded on our server; pass while
          signed in and you get a certificate with a number anyone can check.
        </p>
      </header>

      <div className="mt-10 space-y-5">
        {EXAMS.map((exam) => (
          <ExamCard
            key={exam.id}
            exam={exam}
            stats={stats?.[exam.id]}
            locked={
              exam.requiresFeature !== undefined && !hasFeature(entitlement, exam.requiresFeature)
            }
            entitlementLoading={loading}
            signedIn={signedIn}
          />
        ))}
      </div>

      {legacy.length > 0 ? <LegacyPanel attempts={legacy} onDiscard={discardLegacy} /> : null}

      <section className="card mt-10 p-5">
        <h2 className="text-base font-bold text-ink">How grading works</h2>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-secondary">
          <li>
            Questions carry different point weights; your score is points earned over points
            available.
          </li>
          <li>
            &ldquo;Select all that apply&rdquo; questions are all-or-nothing — no partial credit,
            because ruling out the wrong options is the thing being tested.
          </li>
          <li>Unanswered questions are marked wrong, so there is never a reason to leave one blank.</li>
          <li>
            The clock is kept by our server and starts when you press Begin. Closing the tab does
            not pause it, and a submission that arrives after the deadline is refused — the paper is
            graded against the answers saved before it.
          </li>
          <li>
            Your answers are saved as you give them, so an attempt resumes on any device you are
            signed in on, not just the browser you started in.
          </li>
        </ul>
      </section>
    </div>
  )
}

/**
 * The migration panel.
 *
 * Attempts recorded before grading moved server-side are honoured as a record
 * of study and labelled as unverified, because they are: they were written by
 * the browser and anyone could have typed them. They are shown once, they
 * cannot become a certificate, and there is a button that deletes them. See the
 * header of lib/exams/attempts.ts for why this rather than silently discarding.
 */
function LegacyPanel({ attempts, onDiscard }: { attempts: ExamAttempt[]; onDiscard: () => void }) {
  return (
    <section className="card mt-10 border-q-amber/40 p-5" aria-label="Earlier attempts">
      <h2 className="text-base font-bold text-q-amber-text">
        {attempts.length} earlier {attempts.length === 1 ? 'attempt' : 'attempts'}, unverified
      </h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-secondary">
        These were recorded by this browser before exams were graded on our server. They are shown
        because they are your record of study, and they are marked unverified because nothing on our
        side ever saw them — they cannot be turned into a certificate. Sit the exam again, signed
        in, for a result that can be.
      </p>
      <ul className="mt-4 space-y-1.5">
        {attempts.slice(0, 8).map((attempt) => {
          const exam = EXAMS.find((e) => e.id === attempt.examId)
          return (
            <li key={attempt.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <span className="font-semibold text-ink">{exam?.title ?? attempt.examId}</span>
              <span className="text-ink-secondary">
                {typeof attempt.score === 'number' ? percent(attempt.score) : '—'}
              </span>
              <span className="pill border-line text-ink-muted">unverified</span>
              <span className="text-[12px] text-ink-muted">
                {new Date(attempt.startedAt).toISOString().slice(0, 10)}
              </span>
            </li>
          )
        })}
      </ul>
      <button type="button" onClick={onDiscard} className="btn-ghost focus-ring mt-4">
        Delete these from this browser
      </button>
    </section>
  )
}

interface ExamCardProps {
  exam: Exam
  stats: ExamStats | undefined
  locked: boolean
  entitlementLoading: boolean
  signedIn: boolean
}

function ExamCard({ exam, stats, locked, entitlementLoading, signedIn }: ExamCardProps) {
  const track = TRACKS.find((t) => t.id === exam.trackId)
  const requiredPlan =
    exam.requiresFeature !== undefined ? PLAN_BY_ID[requiredPlanFor(exam.requiresFeature)] : undefined
  const summary = stats?.summary
  const resuming = summary?.openAttemptExpiresAt !== undefined

  return (
    <article className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-ink">{exam.title}</h2>
            <span className="pill border-line text-ink-secondary">{exam.level}</span>
            {summary?.passed ? (
              <span className="pill border-q-teal/60 text-q-teal-text">Passed ✓</span>
            ) : null}
          </div>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-secondary">
            {exam.subtitle}
          </p>
          {/*
            The pool size is stated rather than implied. "Every attempt is a
            different paper" is a claim about a ratio, and a candidate deciding
            whether a resit is worth their time deserves the actual numbers.
            Counted from the id list in the catalogue — the questions themselves
            are not in this bundle and must not be.
          */}
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Drawn at random from a pool of {examPoolSize(exam.id)} questions.
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label="Questions" value={String(exam.questionCount)} />
        <Stat label="Time limit" value={`${exam.timeLimitMinutes} min`} />
        <Stat label="Pass mark" value={percent(exam.passMark)} />
        <Stat
          label="Your best"
          value={
            stats === undefined
              ? '—'
              : summary === undefined || summary.bestScore === null
                ? 'Not attempted'
                : percent(summary.bestScore)
          }
          tone={summary?.passed ? 'teal' : 'default'}
        />
      </dl>

      {summary?.certificateId ? (
        <p className="mt-4 text-[13px] text-q-teal-text">
          Certificate{' '}
          <Link href={`/verify/${summary.certificateId}`} className="focus-ring underline">
            {summary.certificateId}
          </Link>
          {' '}— anyone can check this number.
        </p>
      ) : null}

      {/* ── Readiness ───────────────────────────────────────────────── */}
      {track && stats !== undefined ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            <span>{track.name} progress</span>
            <span>{percent(stats.readiness)}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-q-violet"
              style={{ width: `${Math.round(stats.readiness * 100)}%` }}
            />
          </div>
          {stats.readiness < 1 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-q-amber-text">
              You have not finished every lesson in this track yet. You are welcome to attempt the
              exam anyway — attempts are unlimited — but working through the remaining lessons
              first will make it considerably easier.
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-q-teal-text">
              Track complete. You are ready for this one.
            </p>
          )}
        </div>
      ) : null}

      {/* ── Action ──────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {locked && !entitlementLoading ? (
          <div className="w-full rounded-card border border-q-amber/40 bg-surface-2 p-4">
            <p className="text-sm font-bold text-q-amber-text">
              Included with {requiredPlan?.name ?? 'Pro'}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
              The advanced certification sits behind the same plan as the advanced track it tests.
              The foundations certification is, and will remain, free.
            </p>
            <Link href="/pricing" className="btn-primary focus-ring mt-3 inline-block">
              See plans
            </Link>
          </div>
        ) : (
          <>
            <Link
              href={`/certify/${exam.id}`}
              className="btn-primary focus-ring"
              aria-disabled={entitlementLoading}
            >
              {resuming ? 'Resume attempt' : summary?.passed ? 'Retake exam' : 'Start exam'}
            </Link>
            {!signedIn ? (
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Signed out. You can sit it for practice — same paper, same grading — but a
                certificate names a person, so it needs an account.
              </p>
            ) : null}
          </>
        )}
      </div>
    </article>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'teal'
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm font-bold ${tone === 'teal' ? 'text-q-teal-text' : 'text-ink'}`}
      >
        {value}
      </dd>
    </div>
  )
}
