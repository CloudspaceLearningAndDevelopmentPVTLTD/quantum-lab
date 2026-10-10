/**
 * budget.test.ts — the decisions in lib/billing/budget.ts, and the failure each
 * one would catch.
 *
 * FAKED: the Supabase client (through `./entitlements`' getServiceSupabase and
 * the config flags), so every RPC answer is scripted. REAL: everything this
 * module decides — how a PostgREST row is read back, where the allow/warn/
 * refuse boundaries fall, that a store failure refuses instead of allowing,
 * that the threshold alert is claimed once, and that an un-applied project is
 * treated as "no budget" rather than as an outage.
 *
 * NOT COVERED HERE, and it is the important half: that the budget check and
 * the reservation are ATOMIC. That property lives in
 * public.reserve_hardware_job_within_budget's advisory lock and can only be
 * observed with two real Postgres sessions — supabase/schema-budgets.sql
 * verification query 3 is the test, and it is manual and, as of this commit,
 * unrun.
 *
 * ALSO NOT COVERED, and worth knowing before trusting a green run here: every
 * row in this file is a FAKE of what PostgREST would send. Where the fake and
 * the real serialisation differ, these tests agree with the fake. That has
 * already produced one false pass — `warned_for_period` was echoed back in the
 * JavaScript ISO spelling rather than Postgres's `+00:00` form, and a broken
 * string comparison passed for it; see PERIOD_AS_POSTGREST. Numerics are
 * therefore written as STRINGS throughout, timestamps in the offset form, and
 * anything added here should match what the database actually emits, not what
 * is convenient to type.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

const fake = vi.hoisted(() => {
  const state = {
    calls: [] as RpcCall[],
    /** One row of spend_budget_snapshot, or null to answer with `error`. */
    snapshotRow: null as Record<string, unknown> | null,
    snapshotError: null as { code?: string; message?: string } | null,
    reserveRow: null as Record<string, unknown> | null,
    reserveError: null as { code?: string; message?: string } | null,
    /** The compare-and-set latch, as public.claim_spend_warning implements it. */
    warnedForPeriod: null as string | null,
    /** Force claim_spend_warning to fail, to prove a failed claim is not fatal. */
    warnClaimError: null as { message: string } | null,
    /** Make the client itself blow up, rather than answering with an error. */
    rpcThrows: false,
  }

  function client() {
    return {
      rpc(name: string, args: Record<string, unknown>) {
        state.calls.push({ name, args })
        if (state.rpcThrows) throw new Error('socket hang up')
        if (name === 'spend_budget_snapshot') {
          if (state.snapshotError) return Promise.resolve({ data: null, error: state.snapshotError })
          return Promise.resolve({ data: state.snapshotRow ? [state.snapshotRow] : [], error: null })
        }
        if (name === 'claim_spend_warning') {
          if (state.warnClaimError) {
            return Promise.resolve({ data: null, error: state.warnClaimError })
          }
          const period = String(args.p_period_start)
          const free = state.warnedForPeriod === null || state.warnedForPeriod < period
          if (free) state.warnedForPeriod = period
          return Promise.resolve({ data: free, error: null })
        }
        if (name === 'reserve_hardware_job_within_budget') {
          if (state.reserveError) return Promise.resolve({ data: null, error: state.reserveError })
          return Promise.resolve({ data: state.reserveRow ? [state.reserveRow] : [], error: null })
        }
        // reserve_hardware_job — the unbudgeted fallback.
        return Promise.resolve({
          data: [{ reserved: true, used: 3, reservation_id: 'legacy-1', bonus_jobs: 0, bonus_granted: false }],
          error: null,
        })
      },
      from() {
        throw new Error('budget.ts must not query tables directly; it goes through the RPCs.')
      },
    }
  }

  return { state, client }
})

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/billing/entitlements', () => ({
  isServiceRoleConfigured: true,
  getServiceSupabase: () => fake.client(),
}))

import {
  BudgetUnavailableError,
  evaluateSpendBudget,
  readSpendSnapshot,
  reserveHardwareJobWithinBudget,
} from './budget'

const USER = 'user-1'
const PERIOD = '2026-09-01T00:00:00.000Z'

/**
 * The SAME INSTANT as PERIOD, spelled the way PostgREST actually serialises a
 * timestamptz column. Tests that compare a JS ISO string against itself cannot
 * catch a module that compares these two as text — `'+' < '.'`, so the offset
 * form sorts BEFORE the Z form and "the same window" reads as "an earlier one".
 */
const PERIOD_AS_POSTGREST = '2026-09-01T00:00:00+00:00'

const JOB = { backend: 'ionq_aria', shots: 1000 }

/**
 * A snapshot row shaped the way PostgREST actually delivers one: every
 * `numeric` column as a STRING. Tests that build these by hand with JS numbers
 * pass while production compares strings.
 */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    budget_id: 'budget-1',
    limit_usd: '100.00',
    warn_at_percent: 80,
    hard_stop: true,
    warned_for_period: null,
    estimated_spent_usd: '10.000000',
    estimated_pending_usd: '0.330000',
    priced_jobs: 4,
    unpriced_jobs: 0,
    jobs: 4,
    shots: 4000,
    measured_qpu_seconds: '12.5',
    ...overrides,
  }
}

beforeEach(() => {
  fake.state.calls = []
  fake.state.snapshotRow = snapshot()
  fake.state.snapshotError = null
  fake.state.reserveRow = null
  fake.state.reserveError = null
  fake.state.warnedForPeriod = null
  fake.state.warnClaimError = null
  fake.state.rpcThrows = false
  vi.restoreAllMocks()
})

/**
 * A fresh copy of the module under test.
 *
 * The "schema is not applied" log is deliberately once per PROCESS, so a second
 * test asserting on it would pass or fail depending on which test ran first.
 * Re-importing gives each of those tests its own module state and makes them
 * order-independent.
 */
async function freshBudgetModule() {
  vi.resetModules()
  return import('./budget')
}

describe('evaluateSpendBudget — under the limit', () => {
  it('allows a submission that stays under both the limit and the warn threshold', async () => {
    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
    expect(verdict.reason).toBe('under')
    expect(verdict.estimatedTotalUsd).toBeCloseTo(10.33, 6)
    // Nothing to announce, so the latch is never touched.
    expect(fake.state.calls.map((c) => c.name)).toEqual(['spend_budget_snapshot'])
  })

  it('compares dollars numerically, not lexically — PostgREST sends numeric as a string', async () => {
    // '90.00' > '100.00' is TRUE as strings and false as numbers. Reading the
    // column without coercion refuses every job over $99.99 on a $100 budget.
    fake.state.snapshotRow = snapshot({ estimated_spent_usd: '90.00', limit_usd: '100.00' })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).not.toBe('refuse')
    expect(verdict.snapshot.estimatedSpentUsd).toBe(90)
  })

  it('allows a submission that lands EXACTLY on the limit', async () => {
    // Someone who budgeted $100 may spend $100; only crossing it is refused.
    // A `>=` here would refuse the last job of every budget ever set.
    fake.state.snapshotRow = snapshot({
      estimated_spent_usd: '99.67',
      estimated_pending_usd: '0.33',
      warn_at_percent: null,
    })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
  })
})

describe('evaluateSpendBudget — over the limit', () => {
  it('refuses a submission that would cross the limit, and says both numbers', async () => {
    fake.state.snapshotRow = snapshot({
      estimated_spent_usd: '99.90',
      estimated_pending_usd: '0.63',
    })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('refuse')
    expect(verdict.reason).toBe('over')
    expect(verdict.message).toContain('$100.53')
    expect(verdict.message).toContain('$100.00')
    // A refusal is not an alert: nothing is claimed for it.
    expect(fake.state.calls.map((c) => c.name)).not.toContain('claim_spend_warning')
  })

  it('an alert-only budget reports going over instead of refusing it', async () => {
    // hard_stop=false is the PI who wants visibility but not an outage the
    // week before a deadline. Refusing here would be the feature failing at
    // the one thing it promised that account.
    fake.state.snapshotRow = snapshot({
      hard_stop: false,
      estimated_spent_usd: '150.00',
    })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('warn')
    expect(verdict.reason).toBe('over-soft')
  })

  it('refuses a device it cannot price rather than treating "no price" as free', async () => {
    // Quantinuum bills in H-System Credits and has no dollar rate here, so the
    // SQL returns NULL. Reading NULL as 0 would let a budgeted account run
    // unlimited jobs on exactly the devices nobody has priced.
    fake.state.snapshotRow = snapshot({ estimated_pending_usd: null })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('refuse')
    expect(verdict.reason).toBe('unpriced')
    expect(verdict.estimatedTotalUsd).toBeNull()
  })

  it('treats an absent hard_stop flag as a HARD STOP, not as alert-only', async () => {
    // A row written before the column existed, or a PostgREST projection that
    // drops it, reads as undefined. `row.hard_stop === true` would then turn
    // every such budget into an alert-only one and the ceiling would stop
    // refusing anything — the cheap direction on a spending path. Only an
    // explicit false may disable the stop.
    fake.state.snapshotRow = snapshot({ hard_stop: undefined, estimated_spent_usd: '150.00' })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('refuse')
    expect(verdict.reason).toBe('over')
  })

  it('says the total is understated when some jobs in the window had no price', async () => {
    fake.state.snapshotRow = snapshot({ unpriced_jobs: 3 })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.message).toContain('3 job(s)')
    expect(verdict.snapshot.unpricedJobs).toBe(3)
  })
})

describe('evaluateSpendBudget — the store cannot answer', () => {
  it('REFUSES when the snapshot RPC errors, instead of allowing an unmetered spend', async () => {
    // The whole point of the module: an unknown total must not authorise a
    // billable job. Returning a zero spend here would make a database outage
    // the cheapest way to blow a grant.
    fake.state.snapshotError = { code: '57014', message: 'statement timeout' }

    await expect(evaluateSpendBudget(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })

  it('REFUSES when the client throws outright rather than answering', async () => {
    // A thrown transport error is not an error object on the result, so a
    // handler that only inspects `error` would let this one escape as a raw
    // Error and be caught somewhere that treats it as a bug, not a refusal.
    fake.state.rpcThrows = true

    await expect(readSpendSnapshot(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })

  it('REFUSES when the row comes back with an unreadable spend total', async () => {
    // A column that is not a number is an unknown total, not a zero one.
    fake.state.snapshotRow = snapshot({ estimated_spent_usd: 'not-a-number' })

    await expect(evaluateSpendBudget(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })

  it('REFUSES a missing TABLE instead of reading it as "budgets were never set up"', async () => {
    // The fail-open path is keyed on "the FUNCTION does not exist". Postgres
    // says "does not exist" for a missing relation or column too, so a dropped
    // spend_budgets table, a rename, or a half-applied migration used to match
    // the same test and silently turn spend enforcement off with one log line
    // as the only trace. A missing table is an outage, and an outage refuses.
    fake.state.snapshotError = {
      code: '42P01',
      message: 'relation "public.spend_budgets" does not exist',
    }

    await expect(evaluateSpendBudget(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })

  it('REFUSES an uncoded "does not exist" that names something other than the RPC', async () => {
    // PostgREST does not always set `code`, so the message fallback has to
    // carry the same distinction on its own.
    fake.state.snapshotError = { message: 'column u.qpu_seconds does not exist' }

    await expect(evaluateSpendBudget(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })

  it('REFUSES when the snapshot returns no row at all', async () => {
    // spend_budget_snapshot always returns exactly one row, even for an account
    // with no budget. Zero rows means something is wrong with the function, and
    // "I could not tell" is a refusal.
    fake.state.snapshotRow = null

    await expect(evaluateSpendBudget(USER, PERIOD, JOB)).rejects.toBeInstanceOf(
      BudgetUnavailableError
    )
  })
})

describe('evaluateSpendBudget — the warning threshold', () => {
  it('fires ONCE per usage window, not on every submission past the threshold', async () => {
    // $85 of a $100 budget with a warn at 80%. Without the latch, a researcher
    // running a sweep gets one alert per job and stops reading them.
    fake.state.snapshotRow = snapshot({ estimated_spent_usd: '85.00' })

    const first = await evaluateSpendBudget(USER, PERIOD, JOB)
    expect(first.decision).toBe('warn')
    expect(first.reason).toBe('threshold')
    expect(first.notify).toBe(true)

    // The claim stamped the window; the next snapshot carries it back — IN
    // POSTGRES'S SPELLING, which is the whole point of this assertion. An
    // earlier version compared `warned_for_period` to `periodStart` as raw
    // strings and echoed the JS spelling back here, so the test observed a
    // short-circuit that never happened in production: PostgREST renders
    // timestamptz as `...+00:00` and `'+' < '.'`, so the same instant in the
    // two spellings compared as "earlier" and the module re-asked the database
    // on every single submission for the rest of the month.
    fake.state.snapshotRow = snapshot({
      estimated_spent_usd: '86.00',
      warned_for_period: PERIOD_AS_POSTGREST,
    })

    const second = await evaluateSpendBudget(USER, PERIOD, JOB)
    expect(second.decision).toBe('warn')
    expect(second.notify).toBe(false)
    // And it did not even ask: the row already said the window was announced.
    expect(fake.state.calls.filter((c) => c.name === 'claim_spend_warning')).toHaveLength(1)
  })

  it('still asks the database when the recorded window is an EARLIER one', async () => {
    // The short-circuit must not swallow the alert for a new usage window. If
    // parsing ever collapses the two windows to the same value, a budget warns
    // once and then never again for the life of the account.
    fake.state.snapshotRow = snapshot({
      estimated_spent_usd: '85.00',
      warned_for_period: '2026-08-01T00:00:00+00:00',
    })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.notify).toBe(true)
    expect(fake.state.calls.map((c) => c.name)).toContain('claim_spend_warning')
  })

  it('does not let an unpriceable device consume the window’s threshold alert', async () => {
    // An alert-only budget, one Quantinuum job on day one, then a genuine
    // crossing of the 80% threshold later in the same month. When the unpriced
    // path claimed the latch, that second alert was silently dropped — the
    // account never heard about its budget, which is the one thing this
    // feature promised.
    fake.state.snapshotRow = snapshot({
      hard_stop: false,
      estimated_pending_usd: null,
      estimated_spent_usd: '5.00',
    })

    const unpriced = await evaluateSpendBudget(USER, PERIOD, JOB)
    expect(unpriced.reason).toBe('unpriced')
    expect(unpriced.notify).toBe(false)
    // Nothing was claimed, so the latch is still free.
    expect(fake.state.warnedForPeriod).toBeNull()

    fake.state.snapshotRow = snapshot({ hard_stop: false, estimated_spent_usd: '85.00' })
    const threshold = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(threshold.reason).toBe('threshold')
    expect(threshold.notify).toBe(true)
  })

  it('lets only one of two simultaneous crossings claim the alert', async () => {
    // Both reads see warned_for_period null (they raced), so the TypeScript
    // short-circuit cannot help. The compare-and-set in claim_spend_warning is
    // what makes exactly one of them the announcer.
    fake.state.snapshotRow = snapshot({ estimated_spent_usd: '85.00', warned_for_period: null })

    const [a, b] = await Promise.all([
      evaluateSpendBudget(USER, PERIOD, JOB),
      evaluateSpendBudget(USER, PERIOD, JOB),
    ])

    expect([a.notify, b.notify].filter(Boolean)).toHaveLength(1)
  })

  it('still ALLOWS the job when the alert bookkeeping fails', async () => {
    // A failed notification write is not a reason to refuse a submission that
    // is inside its budget. Failing closed on this axis would turn an email
    // problem into a spending outage.
    fake.state.snapshotRow = snapshot({ estimated_spent_usd: '85.00' })
    fake.state.warnClaimError = { message: 'connection reset' }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('warn')
    expect(verdict.notify).toBe(false)
    expect(logged).toHaveBeenCalled()
  })

  it('does not warn at all when the budget sets no threshold', async () => {
    fake.state.snapshotRow = snapshot({ warn_at_percent: null, estimated_spent_usd: '99.00' })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
    expect(fake.state.calls.map((c) => c.name)).not.toContain('claim_spend_warning')
  })
})

describe('evaluateSpendBudget — no budget configured', () => {
  it('imposes NO limit when the account has no budget row', async () => {
    // This is the deliberate default, and it is not a hole in the fail-closed
    // rule: "no budget row" is a definite answer from a healthy store, unlike
    // "the store did not answer". Inventing a ceiling nobody chose would start
    // refusing real work on every existing account the day this ships, and the
    // plan's job allowance is still standing behind it.
    fake.state.snapshotRow = snapshot({
      budget_id: null,
      limit_usd: null,
      warn_at_percent: null,
      estimated_spent_usd: '4210.00',
    })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
    expect(verdict.reason).toBe('no-budget')
    expect(verdict.snapshot.budget).toBeNull()
  })

  it('imposes no limit when a budget row exists but sets no dollar ceiling', async () => {
    fake.state.snapshotRow = snapshot({ limit_usd: null, estimated_spent_usd: '4210.00' })

    const verdict = await evaluateSpendBudget(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
    expect(verdict.reason).toBe('no-budget')
  })

  it('treats an un-applied schema as "no budget" and logs which file to run', async () => {
    // Refusing every hardware submission on a deployment that never opted into
    // budgets, the moment this code ships, is a worse outage than the control
    // being absent — the same call usage.ts made for its legacy path.
    fake.state.snapshotError = {
      code: 'PGRST202',
      message: 'Could not find the function public.spend_budget_snapshot',
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { evaluateSpendBudget: evaluate } = await freshBudgetModule()

    const verdict = await evaluate(USER, PERIOD, JOB)

    expect(verdict.decision).toBe('allow')
    expect(verdict.reason).toBe('no-budget')
    expect(logged.mock.calls.flat().join(' ')).toContain('supabase/schema-budgets.sql')
    // And it reports NO TOTAL rather than $0.00. Nothing was aggregated on this
    // path; a zero would render as "$0.00 estimated this period" on an account
    // that may have spent a great deal, which is the projection-as-measurement
    // this codebase does not do.
    expect(verdict.snapshot.estimatedSpentUsd).toBeNull()
    expect(verdict.estimatedTotalUsd).toBeNull()
  })
})

describe('reserveHardwareJobWithinBudget', () => {
  it('returns the reservation and the budget numbers behind it', async () => {
    fake.state.reserveRow = {
      reserved: true,
      used: 7,
      reservation_id: 'row-9',
      bonus_jobs: 0,
      bonus_granted: false,
      refused_reason: null,
      budget_limit_usd: '100.00',
      estimated_spent_usd: '10.33',
      estimated_pending_usd: '0.63',
      unpriced_jobs: 0,
    }

    const outcome = await reserveHardwareJobWithinBudget(USER, 'ionq_aria', 1000, 50, PERIOD)

    expect(outcome.reserved).toBe(true)
    expect(outcome.reservation).toEqual({ id: 'row-9', userId: USER })
    expect(outcome.refusedBy).toBeNull()
    expect(outcome.budgetLimitUsd).toBe(100)
  })

  it('distinguishes a budget refusal from a quota refusal', async () => {
    // The caller renders a different message for each — "you are out of jobs"
    // and "you are out of money" are not the same problem, and telling a PI the
    // wrong one wastes a support round trip.
    fake.state.reserveRow = {
      reserved: false,
      used: 0,
      reservation_id: null,
      bonus_jobs: 0,
      bonus_granted: false,
      refused_reason: 'budget',
      budget_limit_usd: '100.00',
      estimated_spent_usd: '99.90',
      estimated_pending_usd: '0.63',
      unpriced_jobs: 0,
    }

    const outcome = await reserveHardwareJobWithinBudget(USER, 'ionq_aria', 1000, 50, PERIOD)

    expect(outcome.reserved).toBe(false)
    expect(outcome.refusedBy).toBe('budget')
    expect(outcome.reservation).toBeUndefined()
  })

  it('refuses a plan with no hardware allowance WITHOUT touching the store', async () => {
    // reserveHardwareJob short-circuits this; the budget wrapper did not, so a
    // Free account's submission took a per-user advisory lock to reach the same
    // answer — and, because the wrapper checks the budget before the quota, a
    // Free account aiming at Quantinuum came back refusedBy 'unpriced' when the
    // real reason is that the plan has no hardware at all.
    const outcome = await reserveHardwareJobWithinBudget(USER, 'azure_quantinuum_h1', 1000, 0, PERIOD)

    expect(outcome.reserved).toBe(false)
    expect(outcome.refusedBy).toBe('quota')
    expect(fake.state.calls).toHaveLength(0)
  })

  it('REFUSES a reservation that comes back without an id, rather than submitting it', async () => {
    // The row was written and we can neither confirm nor release it. Submitting
    // anyway spends real money on a job that can never be settled or polled.
    fake.state.reserveRow = {
      reserved: true,
      used: 7,
      reservation_id: null,
      bonus_jobs: 0,
      bonus_granted: false,
      refused_reason: null,
      budget_limit_usd: '100.00',
      estimated_spent_usd: '10.33',
      estimated_pending_usd: '0.63',
      unpriced_jobs: 0,
    }

    await expect(
      reserveHardwareJobWithinBudget(USER, 'ionq_aria', 1000, 50, PERIOD)
    ).rejects.toBeInstanceOf(BudgetUnavailableError)
  })

  it('reports a NULL spend as "not totalled" rather than as zero', async () => {
    // reserve_hardware_job_within_budget skips the spend aggregate entirely
    // when no ceiling is configured, so these columns come back NULL. Coercing
    // them to 0 published "spent $0.00, nothing unpriced" for a window nobody
    // added up.
    fake.state.reserveRow = {
      reserved: true,
      used: 7,
      reservation_id: 'row-9',
      bonus_jobs: 0,
      bonus_granted: false,
      refused_reason: null,
      budget_limit_usd: null,
      estimated_spent_usd: null,
      estimated_pending_usd: '0.33',
      unpriced_jobs: null,
    }

    const outcome = await reserveHardwareJobWithinBudget(USER, 'ionq_aria', 1000, 50, PERIOD)

    expect(outcome.estimatedSpentUsd).toBeNull()
    expect(outcome.unpricedJobs).toBeNull()
    // The submission's own price is NOT null: it is priceable, and an account
    // with no budget must still be told what its job is estimated to cost.
    expect(outcome.estimatedPendingUsd).toBe(0.33)
  })

  it('REFUSES rather than reserving when the RPC errors', async () => {
    fake.state.reserveError = { code: '57014', message: 'statement timeout' }

    await expect(
      reserveHardwareJobWithinBudget(USER, 'ionq_aria', 1000, 50, PERIOD)
    ).rejects.toBeInstanceOf(BudgetUnavailableError)
  })

  it('falls back to the unbudgeted reservation when the schema is not applied', async () => {
    // No wrapper function means no spend_budgets table means no budgets to
    // enforce, so the plain reservation is the correct behaviour — but it is
    // logged, because a half-applied project would land here with real budgets
    // silently inert.
    fake.state.reserveError = {
      code: 'PGRST202',
      message: 'Could not find the function public.reserve_hardware_job_within_budget',
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reserveHardwareJobWithinBudget: reserve } = await freshBudgetModule()

    const outcome = await reserve(USER, 'ionq_aria', 1000, 50, PERIOD)

    expect(outcome.reserved).toBe(true)
    expect(outcome.budgetLimitUsd).toBeNull()
    expect(fake.state.calls.map((c) => c.name)).toContain('reserve_hardware_job')
    expect(logged).toHaveBeenCalled()
  })
})
