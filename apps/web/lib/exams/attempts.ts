/**
 * attempts.ts — the ARCHIVE of pre-server exam attempts. Read-only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING WRITES THIS STORE ANY MORE, AND NOTHING MAY.
 *
 * Until certification moved server-side, an attempt — its answers, its score,
 * its pass — was a JSON blob in `localStorage`, and the certificate was drawn
 * in the browser from that blob. Two lines in a devtools console produced a
 * pass. That is why `startAttempt` and `saveAttempt` are gone from this file:
 * the record of a sitting is now a row the server writes (see
 * `lib/exams/store.ts`), and leaving the old writers here would have left a
 * second, forgeable source of truth for anything that forgot which to read.
 *
 * ── What happens to attempts people already have ────────────────────────────
 *
 * They are HONOURED AS UNVERIFIED, and they are labelled as such wherever they
 * appear. Concretely:
 *
 *   · `/certify` reads them through `listLegacyAttempts()` and shows them in
 *     their own panel, headed "from before scores were server-checked", with a
 *     button that deletes them.
 *   · They cannot become a certificate. `claimCertificate` only ever looks at
 *     server rows, and there is no code path from this module to one.
 *   · They do not contribute to "your best" — that number now comes from
 *     `/api/exams/summary`, which reads server rows only.
 *   · `/coach` still reads them through `listAttempts()`, and that is
 *     deliberate: the coach recommends what to revise next from local signals
 *     and never claims anything is verified. As people sit new exams the
 *     recommendation quality there degrades until /coach is moved onto the
 *     summary endpoint. That is a known, written-down gap, not an oversight.
 *
 * Discarding them silently was the alternative and was rejected: someone who
 * passed last week and finds their history gone has been told, in effect, that
 * their study did not happen. Honouring them as credentials was the other
 * alternative and is exactly the hole this workstream closed.
 *
 * The parsing is unchanged and stays paranoid: corrupt or hand-edited JSON is
 * treated exactly like no data at all, so a candidate who edited their old
 * localStorage cannot crash the new UI with it. Callers must still render the
 * empty state first and load in a useEffect, or SSR and the client disagree.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AnswerState, ExamAttempt } from './types'

const KEY = 'quantum-lab.exam-attempts'

/** Set once the learner has dismissed the archive panel on /certify. */
const DISMISSED_KEY = 'quantum-lab.exam-attempts.dismissed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAnswer(raw: unknown): AnswerState | null {
  if (!isRecord(raw)) return null
  const questionId = raw.questionId
  if (typeof questionId !== 'string') return null

  const selectedIds = Array.isArray(raw.selectedIds)
    ? raw.selectedIds.filter((v): v is string => typeof v === 'string')
    : []
  const flagged = raw.flagged === true
  const numberValue =
    typeof raw.numberValue === 'number' && Number.isFinite(raw.numberValue)
      ? raw.numberValue
      : undefined

  return numberValue !== undefined
    ? { questionId, selectedIds, flagged, numberValue }
    : { questionId, selectedIds, flagged }
}

function normalizeAttempt(raw: unknown): ExamAttempt | null {
  if (!isRecord(raw)) return null
  const { id, examId, startedAt, seed } = raw
  if (typeof id !== 'string' || typeof examId !== 'string') return null
  if (typeof startedAt !== 'string' || typeof seed !== 'number' || !Number.isFinite(seed)) {
    return null
  }

  const questionIds = Array.isArray(raw.questionIds)
    ? raw.questionIds.filter((v): v is string => typeof v === 'string')
    : []

  const answers: Record<string, AnswerState> = {}
  if (isRecord(raw.answers)) {
    for (const [key, value] of Object.entries(raw.answers)) {
      const answer = normalizeAnswer(value)
      if (answer) answers[key] = answer
    }
  }

  const attempt: ExamAttempt = { id, examId, startedAt, seed, questionIds, answers }

  if (typeof raw.finishedAt === 'string') attempt.finishedAt = raw.finishedAt
  if (typeof raw.score === 'number' && Number.isFinite(raw.score)) attempt.score = raw.score
  if (typeof raw.passed === 'boolean') attempt.passed = raw.passed
  if (typeof raw.timeSpentMs === 'number' && Number.isFinite(raw.timeSpentMs)) {
    attempt.timeSpentMs = raw.timeSpentMs
  }

  return attempt
}

function readAll(): ExamAttempt[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeAttempt)
      .filter((a): a is ExamAttempt => a !== null)
  } catch {
    return []
  }
}

/** Newest first. Filtered to one exam when `examId` is given. */
export function listAttempts(examId?: string): ExamAttempt[] {
  const all = examId === undefined ? readAll() : readAll().filter((a) => a.examId === examId)
  return all.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )
}

/**
 * The archive, for the panel on /certify. Only FINISHED attempts: an
 * abandoned, never-graded sitting from the old design is not a result anybody
 * wants shown back to them.
 */
export function listLegacyAttempts(examId?: string): ExamAttempt[] {
  if (isArchiveDismissed()) return []
  return listAttempts(examId).filter(
    (a) => a.finishedAt !== undefined && typeof a.score === 'number'
  )
}

/*
 * `latestAttempt`, `bestScore` and `hasPassed` used to live here and are gone.
 * They were how /certify filled in "your best" and its "Passed ✓" badge, i.e.
 * the product asked the candidate's own browser whether the candidate had
 * passed. Those numbers now come from `/api/exams/summary`, which reads server
 * rows. The functions are deleted rather than deprecated because a leftover
 * `bestScore()` is precisely the thing a future edit reaches for when it wants
 * a score without a fetch.
 */

function isArchiveDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Delete the archive at the learner's request.
 *
 * Both keys are written: the data goes, and the dismissal flag stays so a
 * `localStorage.removeItem` that silently fails (private browsing, quota) does
 * not resurrect the panel on the next page load.
 */
export function dismissLegacyAttempts(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing sensible to do; the panel is cosmetic either way.
  }
}
