/**
 * budget.ts — spending limits for real quantum hardware, in the only currency
 * this platform can honestly enforce in.
 *
 * SERVER ONLY. Never import this from a client component: it reads the
 * service-role key.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `lib/billing/usage.ts` meters JOBS. A principal investigator with a grant
 * does not have a job allowance, they have money, and "50 hardware jobs a
 * month" bounds nothing their finance office recognises: at IonQ's published
 * rate, 50 jobs of 100 shots is about $15 and 50 jobs of 20,000 shots is about
 * $45. That gap is the main reason a lab will not hand a student an API key.
 *
 * ── WHICH CURRENCY IS ACTUALLY ENFORCEABLE, AND WHY IT IS NOT YOUR INVOICE ──
 *
 * Read this before using any number this module returns in a sentence.
 *
 *  * There is NO invoice feed anywhere in this system. Nothing reads what AWS,
 *    IBM or Azure actually charged. A vendor price change, a free-tier credit
 *    or reservation pricing are all invisible here.
 *  * `hardware_usage` does NOT store a dollar cost. It stores backend, shots,
 *    and — after a poll observes a finished job — qpu_seconds.
 *  * `qpu_seconds` IS a measurement, and it is the only one we have. But it is
 *    a lagging one: null until a poll sees the job finish, and only the IBM
 *    path reports it at all. A budget denominated in it cannot stop a burst —
 *    twenty jobs submitted in ten seconds would all see zero seconds spent. It
 *    is reported below (`measuredQpuSeconds`) for monitoring and deliberately
 *    drives no decision.
 *  * So the enforced unit is ESTIMATED USD: backend and shots re-priced with
 *    the same published-price model that /api/hardware/estimate shows the user
 *    before they submit. The arithmetic lives in SQL
 *    (`public.estimated_job_cost_usd`, supabase/schema-budgets.sql) because it
 *    has to run inside the advisory lock — see the atomicity note below.
 *
 * Every field on every type here says `estimated`. Do not rename one to
 * `spentUsd` or `cost` when wiring this into a UI, and do not put one next to a
 * currency symbol without the word "estimated" beside it. A projection
 * presented as a measurement is the one thing this codebase does not do, and a
 * budget screen is exactly where a reader would believe it.
 *
 * THREE KNOWN WAYS THE ESTIMATE IS WRONG:
 *
 *   1. THIS BUDGET DOES NOT BOUND IBM SPEND AT ALL, AND NOTHING IN THE RETURN
 *      VALUE SAYS SO. Read this one before you sell the feature. Every IBM
 *      backend — ibm_brisbane, ibm_kyiv, ibm_sherbrooke, ibm_quantum — prices
 *      at exactly $0.00, because transpile.py prices IBM's OPEN plan, which is
 *      free and metered in QPU-seconds rather than dollars. That assumption is
 *      wrong for precisely the customer this feature is aimed at: a PI on
 *      Pay-As-You-Go or a Premium contract pays per second, and a $100 ceiling
 *      will never refuse an IBM job however many they run. Worse than
 *      Quantinuum, which at least surfaces as `unpricedJobs` — IBM is counted
 *      as PRICED, at zero, so `unpricedJobs` stays 0 and the total reads
 *      "$0.00 estimated" with nothing beside it. Until an IBM rate exists here,
 *      a spend budget protects the Braket and Azure-IonQ paths and NOTHING on
 *      the platform's flagship vendor. Do not let a budget screen imply
 *      otherwise.
 *   2. `unpricedJobs` — jobs on a vendor we cannot price in dollars at all
 *      (Quantinuum bills in H-System Credits at a contract-specific rate) or on
 *      a backend id missing from the SQL price mirror. They contribute $0, so
 *      `estimatedSpentUsd` UNDERSTATES spend whenever this is non-zero. Show it.
 *   3. Mirror drift — the SQL price table is transcribed by hand from
 *      services/api/app/quantum/transpile.py and nothing fails if the two
 *      diverge. supabase/schema-budgets.sql verification query 2 is the only
 *      check that exists, and it is manual.
 *
 * ── This module FAILS CLOSED, for the reason usage.ts does ──────────────────
 *
 * Read the header of `lib/billing/usage.ts` first. Its rule — an unknown usage
 * count must never authorise a billable job, so the store failing to answer
 * means REFUSE — applies here with more force, not less: this is the path a lab
 * is trusting with a grant. Every function below that can be wrong in the
 * expensive direction throws `BudgetUnavailableError` instead of returning a
 * reassuring default.
 *
 * There is exactly ONE fail-open path — "supabase/schema-budgets.sql has never
 * been applied", which is treated as "no budget configured" so that shipping
 * this code does not refuse every hardware submission on every deployment that
 * never opted in. It is recognised NARROWLY: SQLSTATE 42883 / PGRST202, or a
 * message that names the RPC we called. A missing TABLE or COLUMN also says
 * "does not exist" and must NOT land here — see `looksLikeMissingRpc`, which is
 * deliberately stricter than its counterpart in usage.ts, because there the
 * misread still leaves the quota enforced and here it switches the control off.
 *
 * "No budget configured" is NOT a store failure and NOT a refusal. It is a
 * definite answer from a healthy database and it means NO LIMIT, for two
 * reasons: a budget is an opt-in control somebody chose and can defend, and any
 * default number we invented would start refusing real work on accounts whose
 * owner never asked for a ceiling — while the plan's job quota still stands
 * behind them as the existing backstop. The distinction this module is built
 * around is "a definite absence" versus "an unknown", and only the second one
 * refuses.
 *
 * ── The race, and how it is closed ──────────────────────────────────────────
 *
 * A check-then-act budget has exactly the race a check-then-act quota had, and
 * STATUS.md carried that one as a known bug for a reason: two simultaneous
 * submissions both read a total only one of them fits under, both pass, and a
 * $100 budget buys $190 of QPU time. Two functions here, and only one of them
 * closes it:
 *
 *   `evaluateSpendBudget()`           — PRE-FLIGHT. Honest, useful for the
 *                                       message the user sees and for the
 *                                       threshold alert, and RACY on its own:
 *                                       it reads, then something else acts.
 *   `reserveHardwareJobWithinBudget()`— AUTHORITATIVE. One RPC to
 *                                       `public.reserve_hardware_job_within_budget`,
 *                                       which prices the window and inserts the
 *                                       reservation in ONE transaction under
 *                                       the SAME per-user advisory lock
 *                                       `reserve_hardware_job` already uses.
 *
 * If you gate a submission on the first one alone, the budget is advisory and
 * you should say so in the UI. The submit route must use the second.
 */

import { getServiceSupabase, isServiceRoleConfigured } from './entitlements'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  bonusEligible,
  HARDWARE_BONUS_JOBS,
  HARDWARE_BONUS_THRESHOLD,
  reserveHardwareJob,
} from './usage'
import type { HardwareReservation, ReservationOutcome } from './usage'

/**
 * The budget store could not answer. NEVER catch this and continue: an unknown
 * spend total must not authorise a billable job. The submit route turns it into
 * a 503, exactly like `QuotaUnavailableError`.
 */
export class BudgetUnavailableError extends Error {
  constructor(readonly why: string) {
    super('Hardware submission is unavailable: spend cannot be checked right now.')
    this.name = 'BudgetUnavailableError'
  }
}

/**
 * The trailing window this module calls "the subscription year" when arming the
 * engagement bonus.
 *
 * DUPLICATED from a private constant in `usage.ts` (BONUS_YEAR_MS), which does
 * not export it. Four lines of duplication was preferred to widening that
 * module's surface, but the drift is real: if the bonus year changes there and
 * not here, the two reservation paths arm the bonus over different windows.
 * The fix, when someone touches either, is to export it from `usage.ts` and
 * import it here.
 */
export const HARDWARE_BONUS_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** A configured spending limit, as `public.spend_budgets` holds it. */
export interface SpendBudget {
  id: string
  /** The ceiling in ESTIMATED USD per usage window. Null = no dollar ceiling. */
  limitUsd: number | null
  /** Warn at this percentage of the limit. Null = no warning. */
  warnAtPercent: number | null
  /** False makes the budget alert-only: over the limit is reported, not refused. */
  hardStop: boolean
  /**
   * The usage window whose threshold alert has already been announced, as
   * Postgres rendered it.
   *
   * DO NOT COMPARE THIS TO `periodStart` WITH `<`/`>=`. It is a timestamptz
   * serialised by PostgREST (`2026-09-01T00:00:00+00:00`) while `periodStart`
   * is a JavaScript ISO string (`2026-09-01T00:00:00.000Z`); the same instant
   * in two spellings, and lexically the offset form sorts BEFORE the Z form.
   * `sameOrLaterWindow` parses both.
   */
  warnedForPeriod: string | null
}

/**
 * What the account has spent in the current usage window, and what the
 * submission under consideration would add.
 *
 * `estimated*` fields are projections from a static published-price table (see
 * the module header). `measuredQpuSeconds` is the one real measurement and is
 * not enforced on.
 */
export interface SpendSnapshot {
  /** Null when this account has no budget configured — that means no limit. */
  budget: SpendBudget | null
  /**
   * ESTIMATED USD already spent in the window. Understated by `unpricedJobs`.
   *
   * NULL MEANS "NOT TOTALLED", NEVER "$0.00 SPENT". The only path that produces
   * it is the un-applied-schema fallback, where no aggregate was ever run. A
   * fabricated zero there would render as "$0.00 of $100 estimated" on an
   * account page that has in fact spent an unknown amount, which is precisely
   * the projection-as-measurement this module refuses to do anywhere else.
   */
  estimatedSpentUsd: number | null
  /**
   * ESTIMATED USD the submission under consideration would add, or null when
   * its vendor cannot be priced in dollars at all. Null is NOT zero.
   */
  estimatedPendingUsd: number | null
  /** Jobs in the window we could price. */
  pricedJobs: number
  /** Jobs in the window we could NOT price; each contributes $0 to the total. */
  unpricedJobs: number
  /** All hardware jobs in the window, priced or not. */
  jobs: number
  /** Shots across those jobs. */
  shots: number
  /** Measured QPU seconds, where a poll has observed them. Never enforced on. */
  measuredQpuSeconds: number
}

/** allow = proceed silently, warn = proceed and tell them, refuse = stop. */
export type BudgetDecision = 'allow' | 'warn' | 'refuse'

/** Why `evaluateSpendBudget` decided what it decided. */
export type BudgetReason =
  /** No budget row, or a row with no dollar ceiling. No limit applies. */
  | 'no-budget'
  /** Under the warning threshold. */
  | 'under'
  /** At or over the warning threshold, still under the limit. */
  | 'threshold'
  /** Over the limit, and the budget is a hard stop. */
  | 'over'
  /** Over the limit, but the budget is alert-only. */
  | 'over-soft'
  /** The submission's vendor cannot be priced, so the budget cannot be honoured. */
  | 'unpriced'

/** The pre-flight verdict. See the module header on what it does NOT guarantee. */
export interface BudgetVerdict {
  decision: BudgetDecision
  reason: BudgetReason
  snapshot: SpendSnapshot
  /**
   * ESTIMATED USD after this submission; null when it cannot be priced OR when
   * the spend was never totalled (`snapshot.estimatedSpentUsd` null). Null is
   * "no number", never zero.
   */
  estimatedTotalUsd: number | null
  /**
   * True exactly once per budget per usage window: this call claimed the right
   * to announce the BUDGET-STATE alert — crossing `warn_at_percent`, or (when
   * no threshold is set) crossing the limit on an alert-only budget. Not an
   * authorisation — a false here never means "refuse".
   *
   * `reason: 'unpriced'` deliberately NEVER sets this, and that is a fix rather
   * than an omission: an unpriceable device is a property of THIS submission,
   * not of the account's budget state, and it recurs on every such submission.
   * Letting it claim the once-per-window latch meant one Quantinuum job on day
   * one silently ate the 80%-of-budget alert for the rest of the month. The
   * condition is still returned, on every call, in `decision`/`reason`/
   * `message`; render it inline.
   */
  notify: boolean
  /** A sentence fit to show the user. Always says "estimated" where it means it. */
  message: string
}

/** The privileged client, or a BudgetUnavailableError explaining why not. */
function budgetClient() {
  // Mirrors `usageClient()` in usage.ts rather than importing it: that helper is
  // private, and the two modules must be able to fail with their own error type
  // — the submit route distinguishes "usage cannot be metered" from "spend
  // cannot be checked" in what it tells the caller.
  if (!isSupabaseConfigured) {
    throw new BudgetUnavailableError('Supabase is not configured, so spend cannot be totalled.')
  }
  if (!isServiceRoleConfigured) {
    throw new BudgetUnavailableError(
      'SUPABASE_SERVICE_ROLE_KEY is not set; spend_budget_snapshot is granted to service_role only.'
    )
  }
  const supabase = getServiceSupabase()
  if (!supabase) {
    throw new BudgetUnavailableError('The service-role Supabase client could not be constructed.')
  }
  return supabase
}

/**
 * PostgREST's code for "the function you called does not exist", and the raw
 * SQLSTATE behind it. Same set as usage.ts, for the same reason.
 *
 * 42883 is specifically "function does not exist". A MISSING TABLE is 42P01 and
 * is deliberately NOT here — see `looksLikeMissingRpc`.
 */
const RPC_MISSING_CODES = new Set(['PGRST202', '42883'])

/**
 * Is this error "the function has not been created yet", as opposed to any
 * other failure?
 *
 * NARROWER THAN usage.ts's version, on purpose, and the difference matters.
 * That one accepts any message containing "does not exist". Postgres says
 * exactly that for a missing TABLE or COLUMN too (SQLSTATE 42P01 / 42703), and
 * a `security definer` function raising `relation "spend_budgets" does not
 * exist` — a dropped table, a renamed one, a half-applied migration — would
 * then be read as "this project never opted into budgets" and spend would stop
 * being enforced with nothing but one log line to say so. In usage.ts that
 * misread still leaves the quota enforced by the legacy path; here it disables
 * the control outright, which is a fail-OPEN on a spending path.
 *
 * So the message fallback (needed because PostgREST does not always set a code)
 * must also NAME THE FUNCTION WE CALLED. A missing table's message names the
 * table, not the function, and no longer matches.
 *
 * @param error The PostgREST error, or null.
 * @param fn The RPC name that was invoked.
 * @returns True only when the evidence points at that function being absent.
 */
function looksLikeMissingRpc(
  error: { code?: string; message?: string } | null,
  fn: string
): boolean {
  if (!error) return false
  if (error.code && RPC_MISSING_CODES.has(error.code)) return true
  const message = (error.message ?? '').toLowerCase()
  if (!message.includes(fn.toLowerCase())) return false
  return message.includes('could not find the function') || message.includes('does not exist')
}

const NOT_APPLIED_NOTE =
  '[billing/budget] supabase/schema-budgets.sql is not applied to this Supabase project, so ' +
  'spend budgets are NOT being enforced. This is treated as "no budget configured" because the ' +
  'table and the functions ship in the same file: no function means no spend_budgets table means ' +
  'no budget rows to exceed. If the table WAS applied and the functions were not, budgets are ' +
  'silently inert — apply supabase/schema-budgets.sql.'

/** Logged once per process; a per-request log here would be pure noise. */
let notAppliedWarned = false

function warnNotApplied(): void {
  if (notAppliedWarned) return
  notAppliedWarned = true
  console.error(NOT_APPLIED_NOTE)
}

/**
 * Coerce one PostgREST scalar to a finite number.
 *
 * PostgREST returns `numeric` as a STRING, so every dollar figure arrives as
 * text and a naive read would compare `'41.20' > 100` as a string. Returns null
 * for anything that is not a finite number — and callers must NOT read that
 * null as zero; on this path they either refuse or report "cannot price".
 */
function num(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

/** A row of `public.spend_budget_snapshot`, before coercion. */
interface SnapshotRow {
  budget_id?: unknown
  limit_usd?: unknown
  warn_at_percent?: unknown
  hard_stop?: unknown
  warned_for_period?: unknown
  estimated_spent_usd?: unknown
  estimated_pending_usd?: unknown
  priced_jobs?: unknown
  unpriced_jobs?: unknown
  jobs?: unknown
  shots?: unknown
  measured_qpu_seconds?: unknown
}

/**
 * The snapshot an un-applied project gets: no budget, and NOTHING COUNTED.
 *
 * `estimatedSpentUsd` is null rather than 0 on purpose. Nothing was totalled
 * here; a zero would be a number this module invented, and an account page
 * rendering "$0.00 estimated" for an account that has spent real money is the
 * exact failure the rest of this file is written to avoid.
 */
function emptySnapshot(): SpendSnapshot {
  return {
    budget: null,
    estimatedSpentUsd: null,
    estimatedPendingUsd: null,
    pricedJobs: 0,
    unpricedJobs: 0,
    jobs: 0,
    shots: 0,
    measuredQpuSeconds: 0,
  }
}

/**
 * Read the account's budget and its estimated spend in one round trip.
 *
 * One RPC rather than three queries, and the pricing happens in SQL rather than
 * here: pulling every `hardware_usage` row in the window over the wire to price
 * it in TypeScript would need a THIRD copy of the vendor price table (Python,
 * SQL, TypeScript) and still could not run inside the advisory lock that makes
 * the authoritative check atomic.
 *
 * @param userId The Supabase-verified caller.
 * @param periodStart ISO instant from `usagePeriodStart`. Required rather than
 *   defaulted, so no caller totals a calendar month while enforcement totals a
 *   billing month.
 * @param job The submission being considered, so its estimated cost comes back
 *   in the same round trip. Omit it to read spend alone (an account page).
 * @returns The budget (null when none is set) and the spend beside it.
 * @throws BudgetUnavailableError if the store cannot answer. An unknown total
 *   on a spending path is a refusal, never a zero.
 */
export async function readSpendSnapshot(
  userId: string,
  periodStart: string,
  job?: { backend: string; shots: number }
): Promise<SpendSnapshot> {
  if (!userId) throw new BudgetUnavailableError('No caller id.')
  if (!periodStart) throw new BudgetUnavailableError('No usage window start.')
  const supabase = budgetClient()

  let data: unknown
  let error: { code?: string; message?: string } | null = null
  try {
    ;({ data, error } = await supabase.rpc('spend_budget_snapshot', {
      p_user_id: userId,
      p_period_start: periodStart,
      p_backend: job?.backend ?? null,
      p_shots: job && Number.isFinite(job.shots) ? Math.max(0, Math.trunc(job.shots)) : 0,
    }))
  } catch (err) {
    throw new BudgetUnavailableError(`spend_budget_snapshot threw: ${String(err)}`)
  }

  if (error) {
    // The one deliberate fail-OPEN in this module, and it is the same call
    // usage.ts made for its legacy path: refusing every hardware submission on
    // a deployment that never opted into budgets, the moment this code ships,
    // is a worse outage than the control being absent. See NOT_APPLIED_NOTE for
    // the inference it rests on and the single case where that inference is
    // wrong.
    if (looksLikeMissingRpc(error, 'spend_budget_snapshot')) {
      warnNotApplied()
      return emptySnapshot()
    }
    throw new BudgetUnavailableError(
      `spend_budget_snapshot was refused: ${error.message ?? 'no message'}`
    )
  }

  // `returns table (...)` arrives as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as SnapshotRow | null | undefined
  if (!row || typeof row !== 'object') {
    throw new BudgetUnavailableError('spend_budget_snapshot returned no row.')
  }

  const spent = num(row.estimated_spent_usd)
  if (spent === null) {
    // The store answered with something that is not a number. That is an
    // unknown total, which on this path means refuse.
    throw new BudgetUnavailableError('spend_budget_snapshot returned an unreadable spend total.')
  }

  const budgetId = typeof row.budget_id === 'string' && row.budget_id.length > 0 ? row.budget_id : null

  return {
    budget: budgetId
      ? {
          id: budgetId,
          limitUsd: num(row.limit_usd),
          warnAtPercent: num(row.warn_at_percent),
          // Only an explicit false disables the hard stop. An absent or
          // unreadable flag defaults to stopping, because the cheap direction
          // on a spending path is the wrong direction.
          hardStop: row.hard_stop !== false,
          warnedForPeriod:
            typeof row.warned_for_period === 'string' ? row.warned_for_period : null,
        }
      : null,
    estimatedSpentUsd: spent,
    // Null here means "this vendor has no dollar price", which the decision
    // below treats as unknown — never as free.
    estimatedPendingUsd: num(row.estimated_pending_usd),
    pricedJobs: num(row.priced_jobs) ?? 0,
    unpricedJobs: num(row.unpriced_jobs) ?? 0,
    jobs: num(row.jobs) ?? 0,
    shots: num(row.shots) ?? 0,
    measuredQpuSeconds: num(row.measured_qpu_seconds) ?? 0,
  }
}

/** Format a dollar figure the way every message in this module does. */
function usd(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * Claim the right to announce this window's threshold alert.
 *
 * NOT AN AUTHORISATION, and therefore NOT fail-closed: by the time this runs
 * the decision is already "allowed", and turning a legitimate submission into a
 * refusal because a notification bookkeeping write failed would be failing
 * closed on the wrong axis. A failure costs at most a missing alert, and is
 * logged.
 *
 * @returns True if this call is the one that should send the alert.
 */
async function claimWarning(budgetId: string, periodStart: string): Promise<boolean> {
  try {
    const supabase = budgetClient()
    const { data, error } = await supabase.rpc('claim_spend_warning', {
      p_budget_id: budgetId,
      p_period_start: periodStart,
    })
    if (error) {
      if (!looksLikeMissingRpc(error, 'claim_spend_warning')) {
        console.error(`[billing/budget] could not claim the spend warning: ${error.message ?? ''}`)
      }
      return false
    }
    return data === true
  } catch (err) {
    console.error(`[billing/budget] could not claim the spend warning: ${String(err)}`)
    return false
  }
}

/**
 * Decide whether this submission is inside the account's budget.
 *
 * PRE-FLIGHT ONLY. It reads and then returns; something else acts on the
 * answer, so two simultaneous submissions can both be told "allow" against the
 * same remaining headroom. `reserveHardwareJobWithinBudget` is the one that
 * cannot. Use this for the message, the alert and any display; use that one to
 * authorise.
 *
 * Boundary: a job that lands EXACTLY on the limit is allowed. Somebody who
 * budgeted $100 may spend $100; only crossing it is refused.
 *
 * AND THE BOUNDARY IS COMPUTED IN A DIFFERENT ARITHMETIC THAN THE ONE THAT
 * ENFORCES IT. This sum is IEEE-754; the authoritative one in
 * `reserve_hardware_job_within_budget` is Postgres `numeric`. Within roughly
 * 1e-13 of the limit the two can disagree, so a verdict of `allow` here is not
 * a promise that the reservation will succeed. Do not build a UI that treats it
 * as one.
 *
 * ONE PRODUCT CONSEQUENCE WORTH SAYING OUT LOUD: setting ANY hard-stop budget,
 * however large, makes every unpriceable device (Quantinuum, and any backend id
 * missing from the SQL price mirror) permanently unsubmittable for that
 * account — headroom is irrelevant, because there is no number to subtract. An
 * account with a $1,000,000 ceiling can run less hardware than one with none.
 * That is deliberate (the alternative is a budget that silently exempts exactly
 * the devices nobody priced) but it will surprise a PI, so tell them.
 *
 * @param userId The Supabase-verified caller.
 * @param periodStart ISO instant from `usagePeriodStart`.
 * @param job The backend and shots of the submission being considered.
 * @returns The verdict, including whether this call should raise the alert.
 * @throws BudgetUnavailableError when the store cannot answer.
 */
export async function evaluateSpendBudget(
  userId: string,
  periodStart: string,
  job: { backend: string; shots: number }
): Promise<BudgetVerdict> {
  const snapshot = await readSpendSnapshot(userId, periodStart, job)
  const budget = snapshot.budget

  // A definite absence, not an unknown: no limit applies. See the module header
  // for why that is the right default and why it does not contradict the
  // fail-closed rule.
  if (!budget || budget.limitUsd === null) {
    return {
      decision: 'allow',
      reason: 'no-budget',
      snapshot,
      estimatedTotalUsd:
        snapshot.estimatedPendingUsd === null || snapshot.estimatedSpentUsd === null
          ? null
          : snapshot.estimatedSpentUsd + snapshot.estimatedPendingUsd,
      notify: false,
      message: 'No spending limit is configured for this account.',
    }
  }

  const limit = budget.limitUsd
  const spent = snapshot.estimatedSpentUsd
  const pending = snapshot.estimatedPendingUsd

  // A budget exists but the window was never totalled. Unreachable today — only
  // the un-applied-schema fallback produces a null total and it also produces a
  // null budget — but if a future path ever pairs the two, an unknown spend must
  // refuse rather than be read as $0.00 of the ceiling.
  if (spent === null) {
    throw new BudgetUnavailableError(
      'A spend budget is configured but the window was never totalled.'
    )
  }

  // The submission's vendor has no dollar price (Quantinuum bills in credits;
  // an unknown backend id has no entry in the mirror). Treating that as $0 is
  // how a budget silently stops applying to exactly the devices nobody priced.
  if (pending === null) {
    const message =
      `This device cannot be priced in dollars, so a spending limit of ${usd(limit)} ` +
      'cannot be honoured for it. Check the vendor’s own console for its cost.'
    if (budget.hardStop) {
      return {
        decision: 'refuse',
        reason: 'unpriced',
        snapshot,
        estimatedTotalUsd: null,
        notify: false,
        message,
      }
    }
    return {
      decision: 'warn',
      reason: 'unpriced',
      snapshot,
      estimatedTotalUsd: null,
      // NOT the once-per-window latch. "This device has no dollar price" is a
      // fact about this submission, not about the account's budget state, and it
      // will be true again on the next one. Claiming the latch here consumed the
      // 80%-of-budget alert for the whole window, so a single Quantinuum job on
      // day one silenced the alert this feature exists to send. The condition is
      // in `reason` and `message` on every call instead.
      notify: false,
      message,
    }
  }

  const total = spent + pending
  const understated =
    snapshot.unpricedJobs > 0
      ? ` ${snapshot.unpricedJobs} job(s) this period could not be priced, so the real spend is higher.`
      : ''

  if (total > limit) {
    const message =
      `This submission would put estimated spend at ${usd(total)}, over the ${usd(limit)} ` +
      `limit for this period (${usd(spent)} estimated so far).${understated}`
    if (budget.hardStop) {
      return {
        decision: 'refuse',
        reason: 'over',
        snapshot,
        estimatedTotalUsd: total,
        notify: false,
        message,
      }
    }
    return {
      decision: 'warn',
      reason: 'over-soft',
      snapshot,
      estimatedTotalUsd: total,
      notify: await maybeNotify(budget, periodStart),
      message,
    }
  }

  const warnAt =
    budget.warnAtPercent !== null ? (limit * budget.warnAtPercent) / 100 : null
  if (warnAt !== null && total >= warnAt) {
    return {
      decision: 'warn',
      reason: 'threshold',
      snapshot,
      estimatedTotalUsd: total,
      notify: await maybeNotify(budget, periodStart),
      message:
        `Estimated spend is ${usd(total)} of the ${usd(limit)} limit for this period.` +
        understated,
    }
  }

  return {
    decision: 'allow',
    reason: 'under',
    snapshot,
    estimatedTotalUsd: total,
    notify: false,
    message: `Estimated spend is ${usd(total)} of ${usd(limit)} for this period.${understated}`,
  }
}

/**
 * Is `stamp` the same usage window as `periodStart`, or a later one?
 *
 * PARSED, NEVER COMPARED AS TEXT, and that is a bug fix rather than a style
 * choice. `warned_for_period` reaches us as PostgREST renders a timestamptz —
 * `2026-09-01T00:00:00+00:00` — while `periodStart` is a JavaScript ISO string
 * — `2026-09-01T00:00:00.000Z`. The same instant, and `'+' < '.'`, so `>=` on
 * the raw strings answered FALSE for two spellings of the same moment. The
 * short-circuit below therefore never fired against a real database while the
 * unit test, which fed back the JS spelling it had been given, said it did.
 *
 * @param stamp The window recorded on the budget row, in any parseable format.
 * @param periodStart The window under consideration, ISO.
 * @returns True when `stamp` is at or after `periodStart`. An unparseable
 *   `stamp` returns false, which costs one round trip and never suppresses an
 *   alert — the safe direction for a notification latch.
 */
function sameOrLaterWindow(stamp: string, periodStart: string): boolean {
  const recorded = Date.parse(stamp)
  const window = Date.parse(periodStart)
  if (!Number.isFinite(recorded) || !Number.isFinite(window)) return false
  return recorded >= window
}

/**
 * Raise the alert at most once per budget per usage window.
 *
 * Two latches, deliberately: this one short-circuits on the window already
 * recorded on the row (so a repeat submission costs no round trip), and
 * `public.claim_spend_warning` is the compare-and-set that decides it when two
 * submissions cross the threshold at the same instant. Neither alone is enough
 * — the first races, the second costs a call on every submission after the
 * first. Only the second is authoritative; the first is an optimisation and is
 * allowed to be wrong in the direction of asking again.
 */
async function maybeNotify(budget: SpendBudget, periodStart: string): Promise<boolean> {
  if (budget.warnedForPeriod && sameOrLaterWindow(budget.warnedForPeriod, periodStart)) {
    return false
  }
  return claimWarning(budget.id, periodStart)
}

/** A reservation that also passed the budget check, or the refusal that stopped it. */
export interface BudgetedReservationOutcome extends ReservationOutcome {
  /** null when reserved; otherwise what refused it. */
  refusedBy: 'quota' | 'budget' | 'unpriced' | null
  /** The ceiling that applied, or null when no budget is configured. */
  budgetLimitUsd: number | null
  /**
   * ESTIMATED USD spent in the window before this submission, or NULL when it
   * was never totalled — which is the normal case for an account with no
   * budget, because the SQL skips the aggregate when there is no ceiling to
   * compare against. Null is "we did not look", not "$0.00".
   */
  estimatedSpentUsd: number | null
  /** ESTIMATED USD this submission adds, or null when it cannot be priced. */
  estimatedPendingUsd: number | null
  /**
   * Jobs in the window that could not be priced (they count as $0 above), or
   * null when the window was not totalled at all. Same distinction as
   * `estimatedSpentUsd`: a zero here asserts "everything was priceable".
   */
  unpricedJobs: number | null
}

/**
 * Claim one slot of the allowance AND one slice of the budget, atomically.
 *
 * THE AUTHORITATIVE PATH. One RPC to
 * `public.reserve_hardware_job_within_budget`, which takes the same per-user
 * advisory lock `reserve_hardware_job` uses, prices the window, and inserts the
 * reservation only if the submission fits under both the job allowance and the
 * spending limit — all inside one transaction. Advisory locks are re-entrant
 * within a transaction, which is what lets the wrapper hold the lock across the
 * budget arithmetic and the nested reservation both. So two simultaneous
 * submissions cannot both pass a limit only one of them fits under, which is
 * the same race, and the same fix, as the job quota's.
 *
 * A refusal writes nothing at all: no usage row, no spend.
 *
 * DEGRADATION, stated plainly. If supabase/schema-budgets.sql has not been
 * applied, this falls back to `reserveHardwareJob` — the plain, unbudgeted
 * reservation — and logs once naming the file. That is correct whenever the
 * whole file is missing (no functions means no `spend_budgets` table means no
 * budgets to enforce) and WRONG in one case: a project where the table was
 * applied and the functions were not, where budgets then exist and are silently
 * inert. The log is the only warning of that.
 *
 * THIS AND `evaluateSpendBudget` CAN DISAGREE AT THE EXACT BOUNDARY. The
 * comparison here happens in Postgres `numeric` (exact decimal); the one in
 * `evaluateSpendBudget` happens in IEEE-754 doubles, because that is what
 * JavaScript has. On a total that lands within ~1e-13 of the limit the two can
 * fall on opposite sides. THIS FUNCTION IS THE ONE THAT DECIDES; the other's
 * answer is a message. If a user is ever shown "allowed" and then refused, that
 * is the boundary, not a bug in the store.
 *
 * @param userId The Supabase-verified caller.
 * @param backend The target backend id, which is also what prices the job.
 * @param shots Repetitions requested; the other half of the price.
 * @param limit The plan's hardware job allowance, from `hardwareAllowance`.
 * @param periodStart ISO instant from `usagePeriodStart`.
 * @returns Whether the reservation was made, and the budget numbers behind it.
 * @throws BudgetUnavailableError when the store cannot answer.
 */
export async function reserveHardwareJobWithinBudget(
  userId: string,
  backend: string,
  shots: number,
  limit: number,
  periodStart: string
): Promise<BudgetedReservationOutcome> {
  if (!userId) throw new BudgetUnavailableError('No caller id.')

  // Parity with `reserveHardwareJob`, which returns this WITHOUT touching the
  // store. A plan with no hardware allowance (Free) can never reserve, so
  // sending it to the RPC only takes a per-user advisory lock to reach the same
  // answer — and, worse, the wrapper evaluates the budget FIRST, so a Free
  // account submitting to Quantinuum came back `refusedBy: 'unpriced'` when the
  // true reason is that the plan has no hardware at all. Getting that wrong
  // sends the user to the wrong page.
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      reserved: false,
      used: 0,
      refusedBy: 'quota',
      budgetLimitUsd: null,
      estimatedSpentUsd: null,
      estimatedPendingUsd: null,
      unpricedJobs: null,
    }
  }

  const supabase = budgetClient()
  const safeShots = Number.isFinite(shots) ? Math.max(0, Math.trunc(shots)) : 0

  // The bonus arguments are pass-through: the wrapper hands them straight to
  // reserve_hardware_job, so eligibility is decided by the same rule as the
  // unbudgeted path rather than a second one that could disagree.
  const eligible = bonusEligible(limit)

  let data: unknown
  let error: { code?: string; message?: string } | null = null
  try {
    ;({ data, error } = await supabase.rpc('reserve_hardware_job_within_budget', {
      p_user_id: userId,
      p_backend: backend,
      p_shots: safeShots,
      p_limit: Math.trunc(limit),
      p_period_start: periodStart,
      p_bonus_threshold: eligible ? HARDWARE_BONUS_THRESHOLD : null,
      p_bonus_jobs: eligible ? HARDWARE_BONUS_JOBS : 0,
      p_year_start: eligible
        ? new Date(Date.now() - HARDWARE_BONUS_YEAR_MS).toISOString()
        : null,
    }))
  } catch (err) {
    throw new BudgetUnavailableError(`reserve_hardware_job_within_budget threw: ${String(err)}`)
  }

  if (error) {
    if (looksLikeMissingRpc(error, 'reserve_hardware_job_within_budget')) {
      warnNotApplied()
      const outcome = await reserveHardwareJob(userId, backend, safeShots, limit, periodStart)
      return {
        ...outcome,
        refusedBy: outcome.reserved ? null : 'quota',
        // Nothing was priced on this path, so every budget figure is "we did
        // not look". A zero would claim this account has spent nothing.
        budgetLimitUsd: null,
        estimatedSpentUsd: null,
        estimatedPendingUsd: null,
        unpricedJobs: null,
      }
    }
    throw new BudgetUnavailableError(
      `reserve_hardware_job_within_budget was refused: ${error.message ?? 'no message'}`
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        reserved?: unknown
        used?: unknown
        reservation_id?: unknown
        bonus_jobs?: unknown
        bonus_granted?: unknown
        refused_reason?: unknown
        budget_limit_usd?: unknown
        estimated_spent_usd?: unknown
        estimated_pending_usd?: unknown
        unpriced_jobs?: unknown
      }
    | null
    | undefined
  if (!row || typeof row.reserved !== 'boolean') {
    throw new BudgetUnavailableError('reserve_hardware_job_within_budget returned an unusable row.')
  }

  const reason = typeof row.refused_reason === 'string' ? row.refused_reason : null
  const base = {
    // A refusal by budget or by unpriced vendor never reached the counting
    // function, so `used` is 0 there and means "not counted", not "none used".
    used: num(row.used) ?? 0,
    bonus: {
      jobs: num(row.bonus_jobs) ?? 0,
      grantedNow: row.bonus_granted === true,
    },
    budgetLimitUsd: num(row.budget_limit_usd),
    // No `?? 0`. The SQL returns NULL for these when no budget is configured,
    // because it skips the spend aggregate entirely in that case — coercing
    // that to 0 published "this account has spent $0.00, none of it unpriced"
    // for an account nobody totalled.
    estimatedSpentUsd: num(row.estimated_spent_usd),
    estimatedPendingUsd: num(row.estimated_pending_usd),
    unpricedJobs: num(row.unpriced_jobs),
  }

  if (!row.reserved) {
    return {
      reserved: false,
      refusedBy:
        reason === 'budget' || reason === 'unpriced' || reason === 'quota' ? reason : 'quota',
      ...base,
    }
  }
  if (typeof row.reservation_id !== 'string' || row.reservation_id.length === 0) {
    // Reserved but no id: the row exists and we could neither confirm nor
    // release it. Refuse rather than submit a job we cannot settle.
    throw new BudgetUnavailableError(
      'reserve_hardware_job_within_budget reserved without returning an id.'
    )
  }
  const reservation: HardwareReservation = { id: row.reservation_id, userId }
  return { reserved: true, reservation, refusedBy: null, ...base }
}
