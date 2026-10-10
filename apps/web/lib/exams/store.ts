/**
 * store.ts — where an exam attempt and a certificate actually live.
 *
 * SERVER ONLY. Reads the service-role key when one is present.
 *
 * ── Why there are two backends, and what each one is honestly worth ─────────
 *
 * `supabase` — the real one. Rows in `exam_attempts` and `exam_certificates`
 *   (supabase/schema-exams.sql), written with the service role. RLS on those
 *   tables denies everything to the anon and authenticated roles, so the only
 *   path to a score is through this process, which computes it. A candidate
 *   cannot write their own score for the same reason they cannot write their
 *   own `subscriptions` row.
 *
 * `memory` — the fallback, used when `SUPABASE_SERVICE_ROLE_KEY` is unset. It
 *   is a Map in one Node process. It keeps the SECURITY property that matters
 *   here — the answer key never reaches the browser early, and the score is
 *   computed server-side from stored answers — and it loses the DURABILITY
 *   property completely: a redeploy, a scale-to-zero, or a second serverless
 *   instance and the attempt is gone or invisible. Every response that depends
 *   on it carries `durable: false`, the runner says so to the candidate before
 *   they spend twenty-five minutes, and `/verify` refuses to describe a
 *   certificate it cannot look up.
 *
 * The fallback exists because this repository's documented zero-config path has
 * no Supabase project at all, and the alternative — a 503 on every exam route —
 * would have made the feature untestable and undemoable. It is NOT a supported
 * production configuration and the code says so where a candidate can read it.
 * If you are deploying this: set the service-role key.
 */

import { getServiceSupabase, isServiceRoleConfigured } from '@/lib/billing/entitlements'
import { reportError } from '@/lib/observability/report'
import type { AnswerState, CertificateRecord, ServerAttempt } from './types'

export const ATTEMPTS_TABLE = 'exam_attempts'
export const CERTIFICATES_TABLE = 'exam_certificates'

/**
 * Row shape — mirrors supabase/schema-exams.sql. snake_case on the wire,
 * camelCase in the app, converted in exactly these two functions so a column
 * rename is a two-line change and not a search-and-replace.
 */
interface AttemptRow {
  id: string
  exam_id: string
  subject_kind: string
  subject_id: string
  started_at: string
  expires_at: string
  submitted_at: string | null
  closed_by: string | null
  question_ids: string[]
  answers: Record<string, AnswerState>
  score: number | null
  passed: boolean | null
  certificate_id: string | null
}

interface CertificateRow {
  id: string
  user_id: string
  exam_id: string
  attempt_id: string
  display_name: string
  score: number
  issued_at: string
}

function rowToAttempt(row: AttemptRow): ServerAttempt {
  const attempt: ServerAttempt = {
    id: row.id,
    examId: row.exam_id,
    subjectKind: row.subject_kind === 'user' ? 'user' : 'guest',
    subjectId: row.subject_id,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    questionIds: Array.isArray(row.question_ids) ? row.question_ids : [],
    answers: (row.answers ?? {}) as Record<string, AnswerState>,
  }
  if (row.submitted_at) attempt.submittedAt = row.submitted_at
  if (row.closed_by === 'candidate' || row.closed_by === 'expiry') attempt.closedBy = row.closed_by
  if (typeof row.score === 'number') attempt.score = row.score
  if (typeof row.passed === 'boolean') attempt.passed = row.passed
  if (row.certificate_id) attempt.certificateId = row.certificate_id
  return attempt
}

function attemptToRow(a: ServerAttempt): AttemptRow {
  return {
    id: a.id,
    exam_id: a.examId,
    subject_kind: a.subjectKind,
    subject_id: a.subjectId,
    started_at: a.startedAt,
    expires_at: a.expiresAt,
    submitted_at: a.submittedAt ?? null,
    closed_by: a.closedBy ?? null,
    question_ids: a.questionIds,
    answers: a.answers,
    score: a.score ?? null,
    passed: a.passed ?? null,
    certificate_id: a.certificateId ?? null,
  }
}

/**
 * Thrown when the backing store is configured but unreachable.
 *
 * Route handlers turn this into a 503, NEVER into a fresh attempt: silently
 * starting a new sitting because we could not read the old one is how a
 * candidate loses twenty minutes of work, and silently grading against answers
 * we failed to save is how a pass becomes a fail.
 */
export class ExamStoreUnavailableError extends Error {
  constructor(message = 'The exam store is unreachable.') {
    super(message)
    this.name = 'ExamStoreUnavailableError'
  }
}

export interface ExamStore {
  /** 'supabase' when durable, 'memory' when this process is the only copy. */
  readonly kind: 'supabase' | 'memory'
  readonly durable: boolean
  getAttempt(id: string): Promise<ServerAttempt | null>
  /** The subject's most recent attempt at this exam, submitted or not. */
  latestAttempt(subjectId: string, examId: string): Promise<ServerAttempt | null>
  /** Every attempt by this subject, newest first. Bounded by `limit`. */
  listAttempts(subjectId: string, limit?: number): Promise<ServerAttempt[]>
  insertAttempt(attempt: ServerAttempt): Promise<ServerAttempt>
  updateAttempt(attempt: ServerAttempt): Promise<ServerAttempt>
  insertCertificate(record: CertificateRecord): Promise<CertificateRecord>
  getCertificate(id: string): Promise<CertificateRecord | null>
  certificateForAttempt(attemptId: string): Promise<CertificateRecord | null>
}

// ────────────────────────────────────────────────────────────
// Memory backend
// ────────────────────────────────────────────────────────────

const memAttempts = new Map<string, ServerAttempt>()
const memCertificates = new Map<string, CertificateRecord>()

/**
 * Newest first by `startedAt`, ties broken by id so the order is total and a
 * test that starts two attempts in the same millisecond is not flaky.
 */
function newestFirst(a: ServerAttempt, b: ServerAttempt): number {
  const delta = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  return delta !== 0 ? delta : b.id.localeCompare(a.id)
}

const memoryStore: ExamStore = {
  kind: 'memory',
  durable: false,
  async getAttempt(id) {
    return memAttempts.get(id) ?? null
  },
  async latestAttempt(subjectId, examId) {
    return (
      [...memAttempts.values()]
        .filter((a) => a.subjectId === subjectId && a.examId === examId)
        .sort(newestFirst)[0] ?? null
    )
  },
  async listAttempts(subjectId, limit = 50) {
    return [...memAttempts.values()]
      .filter((a) => a.subjectId === subjectId)
      .sort(newestFirst)
      .slice(0, limit)
  },
  async insertAttempt(attempt) {
    memAttempts.set(attempt.id, { ...attempt })
    return attempt
  },
  async updateAttempt(attempt) {
    memAttempts.set(attempt.id, { ...attempt })
    return attempt
  },
  async insertCertificate(record) {
    memCertificates.set(record.id, { ...record })
    return record
  },
  async getCertificate(id) {
    return memCertificates.get(id) ?? null
  },
  async certificateForAttempt(attemptId) {
    return [...memCertificates.values()].find((c) => c.attemptId === attemptId) ?? null
  },
}

// ────────────────────────────────────────────────────────────
// Supabase backend
// ────────────────────────────────────────────────────────────

function client() {
  const supabase = getServiceSupabase()
  if (!supabase) throw new ExamStoreUnavailableError('No service-role client.')
  return supabase
}

/**
 * Any Postgres error here is a 503, not an empty result.
 *
 * `getEntitlement` degrades to the free tier on a failed lookup because the
 * safe direction for billing is "less access". The safe direction for an exam
 * is the opposite: an unreadable attempt must not look like no attempt, because
 * "no attempt" means "start a fresh one" and the candidate's twenty minutes are
 * gone.
 */
function orThrow<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) {
    reportError(result.error, { scope: 'exams.store', what })
    throw new ExamStoreUnavailableError()
  }
  return result.data
}

const supabaseStore: ExamStore = {
  kind: 'supabase',
  durable: true,
  async getAttempt(id) {
    const data = orThrow(
      await client().from(ATTEMPTS_TABLE).select('*').eq('id', id).maybeSingle(),
      'getAttempt'
    )
    return data ? rowToAttempt(data as AttemptRow) : null
  },
  async latestAttempt(subjectId, examId) {
    const data = orThrow(
      await client()
        .from(ATTEMPTS_TABLE)
        .select('*')
        .eq('subject_id', subjectId)
        .eq('exam_id', examId)
        .order('started_at', { ascending: false })
        .limit(1),
      'latestAttempt'
    )
    const rows = (data ?? []) as AttemptRow[]
    return rows[0] ? rowToAttempt(rows[0]) : null
  },
  async listAttempts(subjectId, limit = 50) {
    const data = orThrow(
      await client()
        .from(ATTEMPTS_TABLE)
        .select('*')
        .eq('subject_id', subjectId)
        .order('started_at', { ascending: false })
        .limit(limit),
      'listAttempts'
    )
    return ((data ?? []) as AttemptRow[]).map(rowToAttempt)
  },
  async insertAttempt(attempt) {
    orThrow(await client().from(ATTEMPTS_TABLE).insert(attemptToRow(attempt)), 'insertAttempt')
    return attempt
  },
  async updateAttempt(attempt) {
    orThrow(
      await client().from(ATTEMPTS_TABLE).update(attemptToRow(attempt)).eq('id', attempt.id),
      'updateAttempt'
    )
    return attempt
  },
  async insertCertificate(record) {
    orThrow(
      await client().from(CERTIFICATES_TABLE).insert({
        id: record.id,
        user_id: record.userId,
        exam_id: record.examId,
        attempt_id: record.attemptId,
        display_name: record.displayName,
        score: record.score,
        issued_at: record.issuedAt,
      }),
      'insertCertificate'
    )
    return record
  },
  async getCertificate(id) {
    const data = orThrow(
      await client().from(CERTIFICATES_TABLE).select('*').eq('id', id).maybeSingle(),
      'getCertificate'
    )
    return data ? rowToCertificate(data as CertificateRow) : null
  },
  async certificateForAttempt(attemptId) {
    const data = orThrow(
      await client()
        .from(CERTIFICATES_TABLE)
        .select('*')
        .eq('attempt_id', attemptId)
        .maybeSingle(),
      'certificateForAttempt'
    )
    return data ? rowToCertificate(data as CertificateRow) : null
  },
}

function rowToCertificate(row: CertificateRow): CertificateRecord {
  return {
    id: row.id,
    userId: row.user_id,
    examId: row.exam_id,
    attemptId: row.attempt_id,
    displayName: row.display_name,
    score: row.score,
    issuedAt: row.issued_at,
  }
}

/**
 * The store this deployment is actually using.
 *
 * Resolved per call rather than memoised, because `isServiceRoleConfigured` is
 * read at module load in `lib/billing/entitlements.ts` and the tests set the
 * environment before importing. One boolean per call is not a cost worth
 * caching around.
 */
export function getExamStore(): ExamStore {
  return isServiceRoleConfigured ? supabaseStore : memoryStore
}

/** Empties the in-process store. For tests only; a no-op against Supabase. */
export function __resetExamStoreForTests(): void {
  memAttempts.clear()
  memCertificates.clear()
}
