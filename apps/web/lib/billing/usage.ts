/**
 * usage.ts — metered usage for the one genuinely expensive capability:
 * submitting a circuit to real quantum hardware.
 *
 * SERVER ONLY. Never import this from a client component: it reads the
 * service-role key.
 *
 * ── This module FAILS CLOSED, unlike the rest of the billing layer ──────────
 *
 * `lib/billing/entitlements.ts` degrades to the free tier when a lookup fails,
 * because nobody should see an error page when the subscriptions table blinks.
 * That rule is exactly wrong here. The quota is the only thing standing between
 * an account and an unbounded IBM/Braket bill, so "the store did not answer" has
 * to mean REFUSE THE JOB, not "assume zero used". Every function below that can
 * be wrong in the expensive direction throws `QuotaUnavailableError` rather than
 * returning a reassuring default, and the submit route turns that into a 503.
 *
 * ── Where the count lives, and what that costs ──────────────────────────────
 *
 * `public.hardware_usage` (supabase/schema-billing.sql): one row per submitted
 * job, counted over the account's monthly usage window (see lib/billing/period.ts
 * — it is the subscription's monthly anchor, NOT the calendar month). Writes go
 * through the service-role client because RLS intentionally denies INSERT to
 * ordinary users — a user who could delete their own rows could reset their own
 * quota.
 *
 * COLD START: nothing is cached in this process, so a fresh instance counts
 * exactly the same rows as a warm one. There is no in-memory counter to lose.
 * SECOND INSTANCE: same, for the same reason — Postgres is the only counter, so
 * N instances share one allowance rather than getting N allowances (which is the
 * failure mode `lib/rateLimit.ts` documents for its in-memory fallback, and the
 * reason the quota is not built on that store).
 * NO SUPABASE / NO SERVICE-ROLE KEY: there is no counter at all, so submission
 * is refused outright. That is a deliberate, documented consequence: an operator
 * who has wired up real provider credentials but no database has no way to bound
 * spend, and the safe answer to "how many jobs has this account run?" when
 * nothing can answer it is "do not run another one".
 *
 * ── The reservation, and the race that used to be here ──────────────────────
 *
 * This module used to INSERT a reservation row and then COUNT, so that two
 * sequential submissions saw each other. Two genuinely simultaneous ones did
 * not: both inserted before either counted, both read a number under the limit,
 * both passed. STATUS.md carried that as a known open bug and named the fix.
 *
 * The fix is now `public.reserve_hardware_job`, a `security definer` function
 * that takes a per-user advisory lock, counts, and inserts only if the count is
 * under the limit — so the count cannot miss a concurrent insert, and a REFUSAL
 * writes nothing at all (the old code had to hand a row back, and silently cost
 * the user a job of allowance whenever that delete failed). Read the long
 * comment above the function in supabase/schema-billing.sql for why one SQL
 * statement is not by itself atomic under READ COMMITTED.
 *
 * The remaining steps are unchanged:
 *   reserveHardwareJob()    → count+insert atomically, or refuse
 *   upstream refused?       → releaseHardwareJob(), pass the error through
 *   upstream accepted?      → recordHardwareJob(), stamp the provider handle
 *   2xx with no handle?     → markHardwareJobUnmatched(), keep the row
 *
 * ── The engagement bonus ("use it, earn more") ──────────────────────────────
 *
 * A Pro account that consumes its 50th hardware job within a subscription year
 * earns a ONE-TIME +25-job bonus, granted inside `reserve_hardware_job` under
 * the same advisory lock as the reservation itself — the grant and the count
 * cannot race, and a double-clicked 50th submission cannot double-grant. The
 * grant raises the effective limit of the usage window it lands in (and only
 * that window) by 25, so the mechanic hands out at most 25 extra jobs per
 * subscription year. docs/BILLING.md §11 documents the product decision.
 *
 * Eligibility is decided HERE, not by the caller: the submit route passes the
 * plan's plain allowance and this module recognises the Pro allowance
 * (`bonusEligible`). Team/Edu allowances are already priced for heavy use and
 * Free has no allowance at all. The "subscription year" is the trailing 365
 * days — this module never sees the subscription's yearly anchor, and a
 * rolling year errs, if at all, in the direction of granting LATER, never
 * twice.
 *
 * If `releaseHardwareJob` fails, the user has silently spent one job of their
 * allowance on a request that did nothing. That is the safe direction and it is
 * logged.
 *
 * ── The one thing an operator must do ───────────────────────────────────────
 *
 * `reserve_hardware_job` ships in supabase/schema-billing.sql and has to be
 * applied to the project. Until it is, PostgREST answers "no such function" and
 * this module falls back to the old insert-then-count dance with a loud log —
 * see LEGACY_RESERVE_NOTE. That fallback exists because refusing every hardware
 * submission on an existing deployment the moment this code ships is a worse
 * outage than the race it closes; it is NOT a second supported mode, and the
 * log names the file to run.
 */

import { effectivePlan, PLAN_BY_ID } from '@/lib/plans'
import type { Entitlement } from '@/lib/plans'
import { getServiceSupabase, isServiceRoleConfigured } from './entitlements'
import { usagePeriodStart } from './period'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * The quota store could not answer. NEVER catch this and continue — the whole
 * point is that an unknown usage count must not authorise a billable job.
 */
export class QuotaUnavailableError extends Error {
  constructor(readonly why: string) {
    super('Hardware submission is unavailable: usage cannot be metered right now.')
    this.name = 'QuotaUnavailableError'
  }
}

/** A row in `hardware_usage` that has been claimed but not yet confirmed. */
export interface HardwareReservation {
  id: string
  userId: string
}

// ── Engagement bonus parameters (see the module header) ─────────────────────

/** The N-th hardware job of the subscription year that earns the bonus. */
export const HARDWARE_BONUS_THRESHOLD = 50

/** Extra jobs granted, once per subscription year, on the threshold job. */
export const HARDWARE_BONUS_JOBS = 25

/** The rolling window this module treats as "the subscription year". */
const BONUS_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Only the Pro allowance participates in the bonus. Matching on the allowance
 * rather than a plan id keeps this module's signature stable (the submit route
 * passes a number, not a plan) — and the Pro allowance is the only tier where
 * the number is 50, which `plans.test.ts` would catch changing.
 */
export function bonusEligible(limit: number): boolean {
  return limit === PLAN_BY_ID.pro.limits.hardwareJobsPerMonth
}

/** What the atomic reservation decided. */
export interface ReservationOutcome {
  /** False means the allowance is spent; nothing was written. */
  reserved: boolean
  /** Rows in the window INCLUDING this reservation when `reserved`. */
  used: number
  /** The claimed row, present only when `reserved`. */
  reservation?: HardwareReservation
  /** Bonus jobs active in this window (0 when none), and whether THIS
   *  reservation was the one that earned the grant. Absent on the legacy
   *  fallback path, which predates the mechanic. */
  bonus?: { jobs: number; grantedNow: boolean }
}

/** The privileged client, or a QuotaUnavailableError explaining why not. */
function usageClient() {
  if (!isSupabaseConfigured) {
    throw new QuotaUnavailableError('Supabase is not configured, so usage cannot be counted.')
  }
  if (!isServiceRoleConfigured) {
    throw new QuotaUnavailableError(
      'SUPABASE_SERVICE_ROLE_KEY is not set, so hardware_usage cannot be written (RLS denies it to users).'
    )
  }
  const supabase = getServiceSupabase()
  if (!supabase) {
    throw new QuotaUnavailableError('The service-role Supabase client could not be constructed.')
  }
  return supabase
}

/**
 * Rows in hardware_usage since the start of the caller's current usage window.
 *
 * Throws QuotaUnavailableError rather than returning 0 on failure. A zero that
 * means "the database is down" and a zero that means "this user has run nothing"
 * are the same number and opposite decisions.
 *
 * @param periodStart ISO instant from `usagePeriodStart`. Required rather than
 *        defaulted, so no caller can accidentally count a calendar month while
 *        the enforcement path counts a billing month.
 */
export async function hardwareJobsInPeriod(
  userId: string,
  periodStart: string
): Promise<number> {
  if (!userId) throw new QuotaUnavailableError('No caller id.')
  const supabase = usageClient()
  let count: number | null
  let error: unknown
  try {
    ;({ count, error } = await supabase
      .from('hardware_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', periodStart))
  } catch (err) {
    throw new QuotaUnavailableError(`hardware_usage count threw: ${String(err)}`)
  }
  if (error || typeof count !== 'number') {
    throw new QuotaUnavailableError('hardware_usage count was refused.')
  }
  return count
}

/**
 * PostgREST's code for "the function you called does not exist" (and the raw
 * Postgres SQLSTATE behind it). Distinguishing this from every other error is
 * what keeps an un-migrated project working instead of refusing every job.
 */
const RPC_MISSING_CODES = new Set(['PGRST202', '42883'])

const LEGACY_RESERVE_NOTE =
  '[billing/usage] public.reserve_hardware_job (with bonus arguments) is not present in this ' +
  'Supabase project — either it was never applied, or the project still has the pre-bonus ' +
  'five-argument version. Hardware quota is being enforced by the OLD insert-then-count path, ' +
  'which admits extra jobs under genuinely simultaneous submissions and never grants the ' +
  'engagement bonus. Apply supabase/schema-billing.sql.'

/** Logged once per process — a per-request log here would be pure noise. */
let legacyWarned = false

function looksLikeMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code && RPC_MISSING_CODES.has(error.code)) return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('could not find the function') || message.includes('does not exist')
}

/**
 * Claim one slot of the caller's allowance, atomically.
 *
 * Counts and inserts inside `public.reserve_hardware_job`, serialized per user,
 * so two simultaneous submissions cannot both pass a limit that only one of them
 * fits under. Returns `{ reserved: false }` when the allowance is spent — that
 * is an ordinary answer, not an error, and no row is written for it.
 *
 * Throws QuotaUnavailableError if the store cannot answer at all: an unrecorded
 * job is an unmetered job.
 */
export async function reserveHardwareJob(
  userId: string,
  backend: string,
  shots: number,
  limit: number,
  periodStart: string
): Promise<ReservationOutcome> {
  if (!userId) throw new QuotaUnavailableError('No caller id.')
  if (!Number.isFinite(limit) || limit <= 0) {
    // Not an outage: a plan with no hardware allowance never reaches the store.
    return { reserved: false, used: 0 }
  }
  const supabase = usageClient()
  const safeShots = Number.isFinite(shots) ? Math.max(0, Math.trunc(shots)) : 0

  // The bonus arguments are always passed (PostgREST matches functions by the
  // full named-argument set); ineligible allowances pass a null threshold,
  // which disables the mechanic inside the SQL function.
  const eligible = bonusEligible(limit)

  let data: unknown
  let error: { code?: string; message?: string } | null = null
  try {
    ;({ data, error } = await supabase.rpc('reserve_hardware_job', {
      p_user_id: userId,
      p_backend: backend,
      p_shots: safeShots,
      p_limit: Math.trunc(limit),
      p_period_start: periodStart,
      p_bonus_threshold: eligible ? HARDWARE_BONUS_THRESHOLD : null,
      p_bonus_jobs: eligible ? HARDWARE_BONUS_JOBS : 0,
      p_year_start: eligible ? new Date(Date.now() - BONUS_YEAR_MS).toISOString() : null,
    }))
  } catch (err) {
    throw new QuotaUnavailableError(`reserve_hardware_job threw: ${String(err)}`)
  }

  if (error) {
    if (looksLikeMissingRpc(error)) {
      if (!legacyWarned) {
        legacyWarned = true
        console.error(LEGACY_RESERVE_NOTE)
      }
      return legacyReserve(userId, backend, safeShots, limit, periodStart)
    }
    throw new QuotaUnavailableError(`reserve_hardware_job was refused: ${error.message ?? ''}`)
  }

  // `returns table (...)` arrives as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        reserved?: unknown
        used?: unknown
        reservation_id?: unknown
        bonus_jobs?: unknown
        bonus_granted?: unknown
      }
    | null
    | undefined
  if (!row || typeof row.reserved !== 'boolean') {
    throw new QuotaUnavailableError('reserve_hardware_job returned an unusable row.')
  }
  const used = typeof row.used === 'number' ? row.used : 0
  const bonus = {
    jobs: typeof row.bonus_jobs === 'number' ? row.bonus_jobs : 0,
    grantedNow: row.bonus_granted === true,
  }
  if (!row.reserved) return { reserved: false, used, bonus }
  if (typeof row.reservation_id !== 'string' || row.reservation_id.length === 0) {
    // Reserved but no id: the row exists and we cannot settle it. Refuse rather
    // than submit a job we could neither confirm nor release.
    throw new QuotaUnavailableError('reserve_hardware_job reserved without returning an id.')
  }
  return { reserved: true, used, reservation: { id: row.reservation_id, userId }, bonus }
}

/**
 * Record a BYOK job: one the caller is paying for at their own vendor account.
 *
 * ── Why this does not go through `reserve_hardware_job` ─────────────────────
 *
 * That function exists to do one thing atomically: count the window and refuse
 * if the count has reached a limit. A BYOK job has no limit to reach. The
 * monthly allowance meters the OPERATOR's IBM/AWS/Azure spend, and this job
 * spends none of it — it spends the submitter's own, which IBM meters, on
 * IBM's terms, in IBM's console. So there is nothing to count, nothing to
 * compare, and nothing to serialize: a plain insert is not a shortcut around
 * the advisory lock, it is the absence of anything for the lock to protect.
 *
 * The row is still WRITTEN, and that is the point. It carries the job history,
 * the ownership claim that makes the job pollable by its submitter and nobody
 * else (`ownsHardwareJob`), and the compilation record that makes a result
 * reproducible. Losing all of that to save a row would be a strange trade.
 * `credential_owner = 'user'` is what keeps it out of the two counts that
 * matter — see supabase/schema-byok.sql.
 *
 * ── Why a failure here REFUSES the submission ───────────────────────────────
 *
 * This throws `QuotaUnavailableError`, and the submit route turns that into a
 * 503 before anything is sent upstream. That looks odd for a job with no quota
 * attached, and it is still right: without this row the job cannot be polled
 * through this platform, cannot be listed in the caller's history, and cannot
 * be attributed to them at all. Submitting anyway would enqueue a real job on
 * somebody's real IBM account that we then could not show them. Refusing
 * before submission costs them a retry; the alternative costs them a job.
 *
 * ── The un-migrated fallback ────────────────────────────────────────────────
 *
 * On a deployment where supabase/schema-byok.sql has not been applied, the
 * column does not exist and the insert is refused. Rather than take BYOK down
 * entirely, the row is re-inserted WITHOUT the marker and a loud line is
 * logged. The consequence is stated exactly: the job runs on the user's own
 * credential as intended, but it also counts against their monthly allowance,
 * because nothing in the database can tell that it should not. That is the
 * safe direction — over-counting costs a user some allowance, under-counting
 * costs the operator real money — and it is temporary, one migration away.
 *
 * @param userId The Supabase-verified submitter.
 * @param backend The device id, for the history.
 * @param shots Requested repetitions, for the history.
 * @returns A reservation handle, settled by exactly the same calls an
 *          operator-funded one is (`recordHardwareJob`, `releaseHardwareJob`).
 * @throws QuotaUnavailableError When the row could not be written at all.
 */
export async function recordByokHardwareJob(
  userId: string,
  backend: string,
  shots: number
): Promise<HardwareReservation> {
  if (!userId) throw new QuotaUnavailableError('No caller id.')
  const supabase = usageClient()
  const row = {
    user_id: userId,
    backend: backend && backend.length > 0 ? backend : 'unknown',
    shots: Number.isFinite(shots) ? Math.max(0, Math.trunc(shots)) : 0,
  }

  const first = await supabase
    .from('hardware_usage')
    .insert({ ...row, credential_owner: 'user' })
    .select('id')
    .single()

  if (!first.error && first.data?.id) {
    return { id: String(first.data.id), userId }
  }

  if (!looksLikeMissingCredentialOwner(first.error)) {
    throw new QuotaUnavailableError(
      `a BYOK usage row could not be written: ${first.error?.message ?? 'no row returned'}`
    )
  }

  if (!byokColumnWarned) {
    byokColumnWarned = true
    console.error(BYOK_COLUMN_NOTE)
  }

  const retry = await supabase.from('hardware_usage').insert(row).select('id').single()
  if (retry.error || !retry.data?.id) {
    throw new QuotaUnavailableError(
      `a BYOK usage row could not be written: ${retry.error?.message ?? 'no row returned'}`
    )
  }
  return { id: String(retry.data.id), userId }
}

/** Logged once per process, not once per submission. */
let byokColumnWarned = false

const BYOK_COLUMN_NOTE =
  '[billing/usage] public.hardware_usage has no `credential_owner` column, so a job submitted ' +
  "on a USER'S OWN vendor credential is being recorded as if the platform paid for it and WILL " +
  'count against their monthly allowance. The job itself is unaffected — it ran on their ' +
  'credential. Apply supabase/schema-byok.sql to fix it.'

/**
 * Is this the specific failure "that column does not exist"?
 *
 * PostgREST reports an unknown column on insert as PGRST204 with a message
 * naming it. Both are checked — the code alone has been reused for other
 * schema-cache misses across versions, and the message alone is not stable
 * enough to key on — so this cannot quietly swallow an unrelated insert
 * failure and retry it as if the schema were merely old.
 */
function looksLikeMissingCredentialOwner(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false
  const message = (error.message ?? '').toLowerCase()
  return (
    (error.code === 'PGRST204' || error.code === '42703') && message.includes('credential_owner')
  )
}

/** A bonus grant currently visible in the caller's usage window. */
export interface HardwareBonus {
  jobs: number
  grantedAt: string
}

/**
 * The bonus active in the caller's current usage window, or null.
 *
 * DISPLAY ONLY, and the one deliberate exception to this module's fail-closed
 * rule: this function never authorises anything — the authoritative
 * bonus-aware limit check lives inside `reserve_hardware_job`, under the
 * lock — so a store failure here degrades to "show no bonus" instead of
 * breaking the account page. Do not gate a submission on it.
 */
export async function activeHardwareBonus(
  userId: string,
  periodStart: string
): Promise<HardwareBonus | null> {
  if (!userId || !periodStart) return null
  try {
    const supabase = usageClient()
    const { data, error } = await supabase
      .from('hardware_bonus')
      .select('jobs, granted_at')
      .eq('user_id', userId)
      .gte('granted_at', periodStart)
      .order('granted_at', { ascending: false })
      .limit(1)
    if (error || !Array.isArray(data) || data.length === 0) return null
    const row = data[0] as { jobs?: unknown; granted_at?: unknown }
    if (typeof row.jobs !== 'number' || row.jobs <= 0) return null
    return { jobs: row.jobs, grantedAt: String(row.granted_at ?? '') }
  } catch {
    return null
  }
}

/**
 * The pre-function path: INSERT, then COUNT, and hand the row back if the count
 * is over. Kept ONLY for projects that have not yet applied the SQL; it is the
 * behaviour STATUS.md recorded as racy. Do not call it from anywhere else.
 */
async function legacyReserve(
  userId: string,
  backend: string,
  shots: number,
  limit: number,
  periodStart: string
): Promise<ReservationOutcome> {
  const supabase = usageClient()
  let reservation: HardwareReservation
  try {
    const { data, error } = await supabase
      .from('hardware_usage')
      .insert({ user_id: userId, backend, shots })
      .select('id')
      .single()
    if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
      throw new QuotaUnavailableError('hardware_usage insert was refused.')
    }
    reservation = { id: (data as { id: string }).id, userId }
  } catch (err) {
    if (err instanceof QuotaUnavailableError) throw err
    throw new QuotaUnavailableError(`hardware_usage insert threw: ${String(err)}`)
  }

  let used: number
  try {
    used = await hardwareJobsInPeriod(userId, periodStart)
  } catch (err) {
    await releaseHardwareJob(reservation)
    throw err
  }
  // `used` INCLUDES the row just inserted, so the comparison is `>` and not the
  // `>=` that `canRunHardware` applies to a plain count. The old submit path got
  // this wrong — it fed the inclusive count straight into `canRunHardware`, so a
  // Pro account was refused its 50th job of an advertised 50. The atomic
  // function counts BEFORE inserting and does not have the ambiguity.
  if (used > limit) {
    await releaseHardwareJob(reservation)
    return { reserved: false, used: used - 1 }
  }
  return { reserved: true, used, reservation }
}

/**
 * Give a reservation back, because the job was never actually submitted.
 * Never throws: by the time this is called we are already returning an error to
 * the caller, and a failed rollback must not replace that error with a worse
 * one. It is logged, because it means a user quietly lost a job of allowance.
 */
export async function releaseHardwareJob(reservation: HardwareReservation): Promise<void> {
  try {
    const supabase = usageClient()
    const { error } = await supabase.from('hardware_usage').delete().eq('id', reservation.id)
    if (error) {
      console.error(
        `[billing/usage] could not release hardware reservation ${reservation.id}; ` +
          'the user has been charged a job of their monthly allowance for a job that was not submitted.'
      )
    }
  } catch {
    console.error(
      `[billing/usage] could not release hardware reservation ${reservation.id} (store unreachable).`
    )
  }
}

/**
 * Confirm a reservation by stamping the provider's job handle onto it.
 *
 * This is what makes a job OWNED: `ownsHardwareJob` answers "did this account
 * submit this job id?" from exactly these two columns, and the job-status proxy
 * refuses to poll anything the caller does not own.
 *
 * Never throws — the money is already spent and the row already counts against
 * the allowance, so the worst case here is a job the user cannot poll through
 * us. That is logged loudly rather than swallowed.
 */
export async function recordHardwareJob(
  reservation: HardwareReservation,
  provider: string,
  jobId: string
): Promise<void> {
  try {
    const supabase = usageClient()
    const { error } = await supabase
      .from('hardware_usage')
      .update({ provider, job_id: jobId, settlement: 'confirmed' })
      .eq('id', reservation.id)
    if (error) {
      console.error(
        `[billing/usage] hardware job ${provider}/${jobId} was submitted but its usage row ` +
          `${reservation.id} could not be stamped; the caller will not be able to poll it.`
      )
    }
  } catch {
    console.error(
      `[billing/usage] hardware job ${provider}/${jobId} was submitted but its usage row ` +
        `${reservation.id} could not be stamped (store unreachable).`
    )
  }
}

/**
 * Mark a reservation as spent-but-unpollable: the upstream answered 2xx and gave
 * us no usable job handle.
 *
 * THE ROW STAYS. We cannot rule out that the provider accepted and will charge
 * for the job, and quietly refunding allowance for spend we cannot rule out is
 * the expensive direction. What changes is that the row is now FINDABLE: query 5
 * in supabase/schema-billing.sql lists `settlement = 'unmatched'`, which is the
 * operator's only trace of a job that exists at a vendor and nowhere here.
 *
 * Never throws, for the same reason `recordHardwareJob` does not: the money is
 * already spent by the time we get here.
 */
export async function markHardwareJobUnmatched(
  reservation: HardwareReservation,
  provider: string | null
): Promise<void> {
  try {
    const supabase = usageClient()
    const { error } = await supabase
      .from('hardware_usage')
      .update({ settlement: 'unmatched', provider })
      .eq('id', reservation.id)
    if (error) {
      console.error(
        `[billing/usage] could not mark usage row ${reservation.id} unmatched; ` +
          'a job that may have been charged for has no trace in the database.'
      )
    }
  } catch {
    console.error(
      `[billing/usage] could not mark usage row ${reservation.id} unmatched (store unreachable).`
    )
  }
}

/**
 * The result record for one hardware job, as the history route serves it.
 *
 * Every field after `jobId` is nullable because a row can be in any of three
 * states: submitted and never polled (nothing but the reservation), polled
 * while still queued (a status and nothing else), or terminal (counts, or an
 * error). The type refuses to pretend otherwise — a caller that wants to
 * render a histogram has to handle its absence.
 */
export interface HardwareJobRecord {
  id: string
  provider: string | null
  jobId: string | null
  backend: string
  shots: number
  submittedAt: string
  status: string | null
  counts: Record<string, number> | null
  qasm: string | null
  error: string | null
  qpuSeconds: number | null
  optimizationLevel: number | null
  transpiledDepth: number | null
  transpiledTwoQubitGates: number | null
  completedAt: string | null
}

/** What `recordHardwareResult` is willing to write. All optional but `status`. */
export interface HardwareResultUpdate {
  status: string
  counts?: Record<string, number> | null
  error?: string | null
  qpuSeconds?: number | null
  backend?: string | null
}

/**
 * Persist what a poll observed about a job onto its usage row.
 *
 * WHY THIS EXISTS: before it, a hardware job's results were never written down
 * anywhere on this platform. They were fetched from the vendor on each poll,
 * rendered, and dropped. The job ids lived in `localStorage`, so the history
 * was per-browser and per-device, and a job that finished while no tab was
 * open was never collected at all.
 *
 * WHERE IT IS CALLED FROM: the job-status proxy, which is the only place the
 * server ever observes a hardware job's state — submission is asynchronous at
 * the vendor and nothing calls us back. It runs AFTER that route's ownership
 * check, so this function is never reached for a job the caller does not own.
 *
 * NEVER THROWS. The caller asked for a job's status and is about to be given
 * it; a failure to file that status away is not a reason to turn a successful
 * read into an error. It is logged.
 *
 * @param userId The Supabase-verified owner. Part of the WHERE clause, not
 *   merely an audit field — a bug elsewhere must not let one caller's poll
 *   write over another account's row.
 * @param provider The vendor id the job was submitted under.
 * @param jobId The vendor's job handle.
 * @param update What the poll saw.
 */
export async function recordHardwareResult(
  userId: string,
  provider: string,
  jobId: string,
  update: HardwareResultUpdate
): Promise<void> {
  if (!userId || !provider || !jobId) return
  try {
    const supabase = usageClient()
    const patch: Record<string, unknown> = { status: update.status }
    // Only write what was actually observed. A `counts: null` on a queued poll
    // would erase the counts of a job that has already finished, which is the
    // one way this function could destroy the data it exists to keep.
    if (update.counts !== undefined && update.counts !== null) patch.counts = update.counts
    if (update.error !== undefined && update.error !== null) patch.error = update.error
    if (update.qpuSeconds !== undefined && update.qpuSeconds !== null) {
      patch.qpu_seconds = update.qpuSeconds
    }
    if (update.backend) patch.backend = update.backend
    if (isTerminalHardwareStatus(update.status)) patch.completed_at = new Date().toISOString()

    const { error } = await supabase
      .from('hardware_usage')
      .update(patch)
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('job_id', jobId)
    if (error) {
      console.error(
        `[billing/usage] could not persist the result of ${provider}/${jobId}: ${error.message}`
      )
    }
  } catch (err) {
    console.error(
      `[billing/usage] could not persist the result of ${provider}/${jobId} ` +
        `(store unreachable): ${String(err)}`
    )
  }
}

/**
 * Stamp the compilation record onto a freshly reserved row.
 *
 * Separate from `recordHardwareJob` because these fields describe the circuit
 * that was sent, not the handle it came back with, and a deployment whose
 * schema predates these columns must still be able to stamp the handle — which
 * is the one write that makes a job pollable at all. A failure here costs a
 * field in the history; a failure there costs the job.
 *
 * Never throws.
 *
 * @param reservationId The `hardware_usage` row id.
 * @param record The circuit source and what compiling it produced.
 */
export async function recordHardwareCompilation(
  reservationId: string,
  record: {
    qasm?: string | null
    optimizationLevel?: number | null
    transpiledDepth?: number | null
    transpiledTwoQubitGates?: number | null
  }
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (record.qasm) patch.qasm = record.qasm
  if (record.optimizationLevel !== undefined && record.optimizationLevel !== null) {
    patch.optimization_level = record.optimizationLevel
  }
  if (record.transpiledDepth !== undefined && record.transpiledDepth !== null) {
    patch.transpiled_depth = record.transpiledDepth
  }
  if (record.transpiledTwoQubitGates !== undefined && record.transpiledTwoQubitGates !== null) {
    patch.transpiled_two_qubit_gates = record.transpiledTwoQubitGates
  }
  if (Object.keys(patch).length === 0) return

  try {
    const supabase = usageClient()
    const { error } = await supabase.from('hardware_usage').update(patch).eq('id', reservationId)
    if (error) {
      console.error(
        `[billing/usage] could not stamp the compilation record on ${reservationId}: ${error.message}`
      )
    }
  } catch (err) {
    console.error(
      `[billing/usage] could not stamp the compilation record on ${reservationId}: ${String(err)}`
    )
  }
}

/**
 * The states a job does not move out of.
 *
 * Mirrors `isTerminalStatus` in lib/hardware/types.ts, which this module
 * cannot import: that file is shared with client components and this one reads
 * the service-role key. Four words duplicated is cheaper than the import.
 */
function isTerminalHardwareStatus(status: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

/**
 * One account's hardware job history, newest first.
 *
 * THROWS `QuotaUnavailableError` when the store cannot answer, rather than
 * returning an empty list. An empty history and an unreachable database look
 * identical to a UI that is handed `[]`, and the difference matters a great
 * deal to somebody looking for a job they know they ran.
 *
 * @param userId The Supabase-verified caller.
 * @param limit How many rows at most. Bounded by the caller's route.
 * @param includeQasm Whether to select the circuit source. The list view does
 *   not need it and it is by far the largest column, so the default is no.
 * @returns The rows, newest first.
 */
export async function listHardwareJobs(
  userId: string,
  limit = 50,
  includeQasm = false
): Promise<HardwareJobRecord[]> {
  if (!userId) return []
  const columns = [
    'id',
    'provider',
    'job_id',
    'backend',
    'shots',
    'created_at',
    'status',
    'counts',
    'error',
    'qpu_seconds',
    'optimization_level',
    'transpiled_depth',
    'transpiled_two_qubit_gates',
    'completed_at',
  ]
  if (includeQasm) columns.push('qasm')

  const supabase = usageClient()
  try {
    const { data, error } = await supabase
      .from('hardware_usage')
      .select(columns.join(','))
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      throw new QuotaUnavailableError(`hardware_usage history read was refused: ${error.message}`)
    }
    return (Array.isArray(data) ? data : []).map(toHardwareJobRecord)
  } catch (err) {
    if (err instanceof QuotaUnavailableError) throw err
    throw new QuotaUnavailableError(`hardware_usage history read threw: ${String(err)}`)
  }
}

/**
 * One hardware run, WITH the owning account id and the circuit.
 *
 * Deliberately not part of `listHardwareJobs`. That function serves the
 * history panel, where `user_id` is already known from the session and the
 * circuit is the largest column — so it selects neither. Publishing needs
 * both: the circuit because it IS the artefact, and the account id because
 * `buildPublishedRun` refuses to publish without it (it is the needle the
 * vendor-text scrubber removes, and a scrub that silently lost its most
 * important needle is the failure nobody would notice).
 *
 * `user_id` is in the WHERE clause as well as the projection. A caller who
 * learns another account's row id must not be able to load it, let alone
 * publish it.
 *
 * @param userId The Supabase-verified owner.
 * @param rowId The `hardware_usage` row to load.
 * @returns The run, or null when it is not this caller's.
 * @throws QuotaUnavailableError When the store cannot answer.
 */
export async function readOwnedHardwareRun(
  userId: string,
  rowId: string
): Promise<(HardwareJobRecord & { userId: string }) | null> {
  if (!userId || !rowId) return null
  const supabase = usageClient()
  try {
    const { data, error } = await supabase
      .from('hardware_usage')
      .select(
        'id, user_id, provider, job_id, backend, shots, created_at, status, counts, qasm, ' +
          'error, qpu_seconds, optimization_level, transpiled_depth, ' +
          'transpiled_two_qubit_gates, completed_at'
      )
      .eq('user_id', userId)
      .eq('id', rowId)
      .limit(1)
    if (error) {
      throw new QuotaUnavailableError(`hardware_usage row read was refused: ${error.message}`)
    }
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return null
    return { ...toHardwareJobRecord(row), userId }
  } catch (err) {
    if (err instanceof QuotaUnavailableError) throw err
    throw new QuotaUnavailableError(`hardware_usage row read threw: ${String(err)}`)
  }
}

/**
 * Map one database row onto the wire shape.
 *
 * Defensive about types because this row may predate several of its own
 * columns: every field added by the result-record migration reads as
 * `undefined` on a row written before it, and `null` is the honest answer for
 * all of them. PostgREST also returns `numeric` as a STRING, which is why
 * `qpu_seconds` goes through the same coercion as the integers.
 *
 * @param row A `hardware_usage` row as PostgREST returned it.
 * @returns The normalised record.
 */
function toHardwareJobRecord(row: unknown): HardwareJobRecord {
  const r = (row ?? {}) as Record<string, unknown>
  const num = (value: unknown): number | null => {
    const parsed = typeof value === 'string' ? Number(value) : value
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
  }
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return {
    id: String(r.id ?? ''),
    provider: text(r.provider),
    jobId: text(r.job_id),
    backend: text(r.backend) ?? '',
    shots: num(r.shots) ?? 0,
    submittedAt: text(r.created_at) ?? '',
    status: text(r.status),
    // `counts` is jsonb; PostgREST hands it back already parsed.
    counts:
      r.counts && typeof r.counts === 'object' && !Array.isArray(r.counts)
        ? (r.counts as Record<string, number>)
        : null,
    qasm: text(r.qasm),
    error: text(r.error),
    qpuSeconds: num(r.qpu_seconds),
    optimizationLevel: num(r.optimization_level),
    transpiledDepth: num(r.transpiled_depth),
    transpiledTwoQubitGates: num(r.transpiled_two_qubit_gates),
    completedAt: text(r.completed_at),
  }
}

/**
 * Did `userId` submit this job through us?
 *
 * Throws QuotaUnavailableError when the store cannot answer. The caller must NOT
 * treat that as "yes" — a job's results are the submitter's data, and an
 * outage is not a reason to publish them to whoever holds the id.
 */
export async function ownsHardwareJob(
  userId: string,
  provider: string,
  jobId: string
): Promise<boolean> {
  if (!userId) return false
  const supabase = usageClient()
  try {
    const { data, error } = await supabase
      .from('hardware_usage')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('job_id', jobId)
      .limit(1)
    if (error) throw new QuotaUnavailableError('hardware_usage ownership lookup was refused.')
    return Array.isArray(data) && data.length > 0
  } catch (err) {
    if (err instanceof QuotaUnavailableError) throw err
    throw new QuotaUnavailableError(`hardware_usage ownership lookup threw: ${String(err)}`)
  }
}

/** Whose credential paid for a job, as recorded on its usage row. */
export type CredentialOwner = 'operator' | 'user'

/**
 * Ownership AND funding for one job, in one query: null when the caller does
 * not own it, otherwise whose credential paid for it.
 *
 * ── Why the poll path needs this and a boolean is not enough ────────────────
 *
 * A job submitted on a user's OWN IBM token can only be polled with that same
 * token. IBM does not show one account another account's job, so presenting
 * the operator's credential for it returns "not found" — not an error, just an
 * eternally-queued-looking job that never resolves.
 *
 * The obvious shortcut is for the poll route to ask "does this user have a
 * credential right now?" and use it if so. That is wrong in both directions
 * and the failures are silent:
 *
 *   · Submit on the platform's credential, THEN attach your own token. Every
 *     earlier job becomes unpollable.
 *   · Submit on your own token, then remove it. Same, in reverse.
 *
 * So the question the poll must ask is not "what credential does this user
 * have now" but "what credential was this job submitted with", and the usage
 * row is the only thing that remembers. This function is that question.
 *
 * ── The un-migrated fallback ────────────────────────────────────────────────
 *
 * Without supabase/schema-byok.sql the column does not exist, the select is
 * refused, and this retries reading ownership alone and answers 'operator' —
 * which on such a deployment is true of every job, because BYOK submissions
 * could not have been recorded as anything else.
 *
 * @param userId The Supabase-verified caller.
 * @param provider The provider as `submit` stamped it.
 * @param jobId The job handle as `submit` stamped it.
 * @returns The funding owner, or null when this caller does not own the job.
 * @throws QuotaUnavailableError When the store could not answer at all.
 */
export async function hardwareJobCredentialOwner(
  userId: string,
  provider: string,
  jobId: string
): Promise<CredentialOwner | null> {
  if (!userId) return null
  const supabase = usageClient()
  try {
    const { data, error } = await supabase
      .from('hardware_usage')
      .select('id, credential_owner')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('job_id', jobId)
      .limit(1)

    if (!error) {
      const row = Array.isArray(data) ? data[0] : null
      if (!row) return null
      return row.credential_owner === 'user' ? 'user' : 'operator'
    }

    if (!looksLikeMissingCredentialOwner(error)) {
      throw new QuotaUnavailableError('hardware_usage ownership lookup was refused.')
    }

    const owns = await ownsHardwareJob(userId, provider, jobId)
    return owns ? 'operator' : null
  } catch (err) {
    if (err instanceof QuotaUnavailableError) throw err
    throw new QuotaUnavailableError(`hardware_usage ownership lookup threw: ${String(err)}`)
  }
}

/*
 * `assertHardwareQuota` used to live here: it resolved the entitlement, took a
 * usage count and threw FeatureLockedError when the count was over the plan's
 * allowance. It is GONE, deliberately, and should not come back. With the
 * reservation atomic, the limit check happens inside `reserve_hardware_job`
 * under the same lock as the insert; a second helper that does the same
 * comparison a round trip earlier, outside the lock, is exactly the racy check
 * this change removed — and leaving it exported invites a future route to gate
 * on it and believe it is protected. The submit route now reads the allowance
 * with `hardwareAllowance` and passes it in as an argument.
 */

/** Hardware jobs this account may run per monthly window, per its plan. */
export function hardwareAllowance(entitlement: Entitlement): number {
  return effectivePlan(entitlement).limits.hardwareJobsPerMonth
}
