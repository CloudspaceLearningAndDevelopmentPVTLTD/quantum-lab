'use client'

/**
 * CohortProgress — how far the people on this licence have actually got.
 *
 * ── What changed here, and why it had to ─────────────────────
 * This component used to fabricate its own data. In local mode every row except
 * the viewer's came from a seeded PRNG (mulberry32, seeded off the member id);
 * with a backend configured, every row except the viewer's was hard zeroes,
 * because per-member progress had never been synced anywhere. Both were
 * presented in the same table, with the same styling, as "cohort progress" —
 * and the underlying reason was real: learner progress lives in localStorage on
 * the learner's own device (docs/ANALYTICS.md), so there was nothing to read.
 *
 * The fix is not to start collecting it quietly. It is consent:
 * lib/orgs/progressShare.ts holds the decision, components/admin/AssignedWork.tsx
 * is where a learner makes it, and POST /api/orgs/progress refuses a snapshot
 * from anyone who has not. This component now renders exactly what has been
 * shared and marks everyone else "not sharing".
 *
 * NO INVENTED NUMBERS MAY RETURN TO THIS FILE. A demo table that looks like a
 * real one is worse than an empty state, because an instructor cannot tell which
 * one they are looking at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { storageMode } from '@/lib/orgs/store'
import { LESSONS, TRACKS } from '@/lib/lessons'
import { relativeTime } from '@/lib/circuit-store'
import { fetchCohort, STAND_IN_NOTE } from '@/lib/orgs/classroomClient'
import type { CohortMemberProgress, ProgressSnapshot } from '@/lib/orgs/assignments'

export interface CohortProgressProps {
  orgId: string
}

type SortKey = 'completion' | 'name' | 'active'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'completion', label: 'Completion' },
  { id: 'name', label: 'Name' },
  { id: 'active', label: 'Last shared' },
]

const TOTAL_LESSONS = LESSONS.length
const FOUNDATIONS = TRACKS.find((t) => t.id === 'foundations')
const FOUNDATIONS_SLUGS = FOUNDATIONS ? FOUNDATIONS.lessonSlugs : []

/** Number of quiz questions in a lesson, so a raw score can become a ratio. */
const QUESTIONS_BY_SLUG = new Map<string, number>(
  LESSONS.map((lesson) => [
    lesson.slug,
    lesson.blocks.reduce(
      (sum, block) => (block.kind === 'quiz' ? sum + block.questions.length : sum),
      0
    ),
  ])
)

/**
 * Mean quiz score as a percentage, or null when nothing has been graded.
 *
 * A shared score is a COUNT of correct answers (that is what Quiz.tsx records),
 * so each one has to be divided by its own lesson's question count before the
 * mean means anything. A score for a lesson this deployment no longer has is
 * skipped rather than counted as zero.
 */
function quizAverage(snapshot: ProgressSnapshot): number | null {
  const ratios: number[] = []
  for (const [slug, score] of Object.entries(snapshot.quizScores)) {
    const total = QUESTIONS_BY_SLUG.get(slug) ?? 0
    if (total > 0) ratios.push(Math.min(1, Math.max(0, score / total)))
  }
  if (ratios.length === 0) return null
  return Math.round((ratios.reduce((sum, r) => sum + r, 0) / ratios.length) * 100)
}

function completionOf(row: CohortMemberProgress): number {
  if (!row.snapshot || TOTAL_LESSONS === 0) return 0
  return row.snapshot.lessons.length / TOTAL_LESSONS
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function daysSince(iso?: string): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY
  return (Date.now() - at) / 86_400_000
}

export default function CohortProgress({ orgId }: CohortProgressProps) {
  const [rows, setRows] = useState<CohortMemberProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('completion')

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await fetchCohort(orgId))
    } catch (err) {
      // A 403 here is the expected answer for a member: reading the cohort is an
      // owner/admin capability and the API decides that, not this component.
      setError(err instanceof Error ? err.message : 'Could not load cohort progress.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const sorted = useMemo(() => {
    const copy = [...rows]
    if (sort === 'name') return copy.sort((a, b) => a.email.localeCompare(b.email))
    if (sort === 'active') {
      return copy.sort((a, b) => daysSince(a.sharedAt) - daysSince(b.sharedAt))
    }
    return copy.sort((a, b) => completionOf(b) - completionOf(a))
  }, [rows, sort])

  const summary = useMemo(() => {
    // Every figure is computed over the people who share, and the denominator
    // is rendered next to it. Averaging non-sharers in as zero would understate
    // a cohort by exactly the number of people exercising a documented right.
    const shared = rows.filter((r) => r.snapshot !== null)
    return {
      sharing: shared.length,
      total: rows.length,
      medianCompletion: Math.round(median(shared.map(completionOf)) * 100),
      finishedFoundations: shared.filter(
        (r) =>
          FOUNDATIONS_SLUGS.length > 0 &&
          FOUNDATIONS_SLUGS.every((slug) => r.snapshot?.lessons.includes(slug))
      ).length,
    }
  }, [rows])

  if (loading) {
    return <div className="card p-8 text-center text-sm text-ink-secondary">Loading progress…</div>
  }

  if (error) {
    return (
      <div className="rounded-card border border-q-rose/40 bg-q-rose/10 p-3 text-sm text-q-rose-text">
        {error}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-semibold text-ink">Nothing to report yet</p>
        <p className="mt-1 text-sm text-ink-secondary">
          Progress appears here once members join the licence and choose to share it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Summary ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            Sharing progress
          </p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {summary.sharing}
            <span className="text-base font-semibold text-ink-muted"> / {summary.total}</span>
          </p>
          <p className="mt-1 text-xs text-ink-secondary">every figure here is over these people</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            Median completion
          </p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {summary.sharing === 0 ? '—' : `${summary.medianCompletion}%`}
          </p>
          <p className="mt-1 text-xs text-ink-secondary">of {TOTAL_LESSONS} lessons</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            Finished foundations
          </p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {summary.finishedFoundations}
            <span className="text-base font-semibold text-ink-muted"> / {summary.sharing}</span>
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            all {FOUNDATIONS_SLUGS.length} foundation lessons complete
          </p>
        </div>
      </div>

      {/* ── Sort control ───────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Sort by</span>
        {SORTS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={sort === option.id}
            className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              sort === option.id
                ? 'border-q-violet/50 bg-q-violet/10 text-q-violet-text'
                : 'border-line text-ink-secondary hover:text-ink'
            }`}
            onClick={() => setSort(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* ── Rows. Single series, so exactly one hue and no legend. ── */}
      <div className="card divide-y divide-line">
        {sorted.map((row) => {
          const snapshot = row.snapshot
          const percent = Math.round(completionOf(row) * 100)
          const average = snapshot ? quizAverage(snapshot) : null
          return (
            <div key={row.memberId} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-ink">{row.email}</span>
                {snapshot === null ? (
                  <span className="pill border-line text-ink-muted">not sharing</span>
                ) : (
                  <span className="text-xs text-ink-secondary">
                    {snapshot.lessons.length}/{TOTAL_LESSONS} lessons
                    <span className="text-ink-muted">
                      {' · '}
                      {average === null ? 'no quizzes' : `${average}% quiz avg`}
                      {' · '}
                      {snapshot.challenges.length} challenges
                      {' · '}
                      {snapshot.exams.length} exams passed
                    </span>
                  </span>
                )}
              </div>
              {snapshot === null ? (
                <p className="mt-1 text-[11px] text-ink-muted">
                  This person has not opted in to sharing their progress. That is not the same as
                  having done nothing.
                </p>
              ) : (
                <>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-q-violet transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-ink-secondary">
                      {percent}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {row.sharedAt ? `Shared ${relativeTime(row.sharedAt)}` : 'Never shared'}
                  </p>
                </>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-ink-muted">
        Progress is shared by the learner, not collected. A learner can stop at any time, which
        deletes what was shared — a row that disappears has not been lost, it has been withdrawn.
        {storageMode() === 'local' ? ` ${STAND_IN_NOTE}` : ''}
      </p>
    </div>
  )
}

export { CohortProgress }
