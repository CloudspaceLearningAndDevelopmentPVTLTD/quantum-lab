/**
 * usage.test.ts — the TS half of the atomic quota reservation, and the
 * engagement-bonus plumbing added around it.
 *
 * FAKED: the Supabase client (via `./entitlements`' getServiceSupabase and the
 * config flags). REAL: everything this module decides — which arguments reach
 * `reserve_hardware_job` (the bonus is armed for the Pro allowance and for
 * nothing else), how the function's row is read back, when the legacy fallback
 * fires, and that the display-only bonus lookup degrades to null instead of
 * failing the page. The SQL function itself is exercised against a live
 * Postgres in supabase/schema-billing.sql's verification section (query 9).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

const fake = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as RpcCall[],
    rpcResult: { data: null as unknown, error: null as { code?: string; message?: string } | null },
    bonusRows: [] as Array<{ jobs: number; granted_at: string }>,
    bonusError: null as { message: string } | null,
    usageRows: [] as Array<{ id: string }>,
    inserted: [] as Array<Record<string, unknown>>,
    deleted: [] as string[],
  }

  function client() {
    return {
      rpc(name: string, args: Record<string, unknown>) {
        state.rpcCalls.push({ name, args })
        return Promise.resolve(state.rpcResult)
      },
      from(table: string) {
        const q = { table, eqs: [] as Array<[string, unknown]>, head: false }
        const api = {
          select(_cols?: string, opts?: { head?: boolean; count?: string }) {
            if (opts?.head) q.head = true
            return api
          },
          insert(row: Record<string, unknown>) {
            state.inserted.push(row)
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: `res-${state.inserted.length}` }, error: null }),
              }),
            }
          },
          delete: () => ({
            eq(_col: string, id: string) {
              state.deleted.push(id)
              return Promise.resolve({ error: null })
            },
          }),
          eq() {
            return api
          },
          gte() {
            return api
          },
          order() {
            return api
          },
          limit() {
            if (q.table === 'hardware_bonus') {
              return Promise.resolve({ data: state.bonusRows, error: state.bonusError })
            }
            return Promise.resolve({ data: [], error: null })
          },
          then(resolve: (v: unknown) => void) {
            // Awaiting the builder directly (the head-count path).
            resolve({ data: null, error: null, count: state.usageRows.length })
          },
        }
        return api
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
  activeHardwareBonus,
  bonusEligible,
  HARDWARE_BONUS_JOBS,
  HARDWARE_BONUS_THRESHOLD,
  QuotaUnavailableError,
  reserveHardwareJob,
} from './usage'
import { PLAN_BY_ID } from '@/lib/plans'

const USER = 'user-1'
const PERIOD = '2026-08-01T00:00:00.000Z'

function reservedRow(overrides: Record<string, unknown> = {}) {
  return [
    {
      reserved: true,
      used: 12,
      reservation_id: 'row-1',
      bonus_jobs: 0,
      bonus_granted: false,
      ...overrides,
    },
  ]
}

beforeEach(() => {
  fake.state.rpcCalls = []
  fake.state.rpcResult = { data: reservedRow(), error: null }
  fake.state.bonusRows = []
  fake.state.bonusError = null
  fake.state.usageRows = []
  fake.state.inserted = []
  fake.state.deleted = []
})

describe('bonusEligible', () => {
  it('is true exactly for the Pro allowance', () => {
    expect(bonusEligible(PLAN_BY_ID.pro.limits.hardwareJobsPerMonth)).toBe(true)
    expect(bonusEligible(PLAN_BY_ID.team.limits.hardwareJobsPerMonth)).toBe(false)
    expect(bonusEligible(PLAN_BY_ID.edu.limits.hardwareJobsPerMonth)).toBe(false)
    expect(bonusEligible(0)).toBe(false)
  })
})

describe('reserveHardwareJob — bonus arguments', () => {
  it('arms the bonus for the Pro allowance: threshold, jobs and a year window', async () => {
    await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 50, PERIOD)

    expect(fake.state.rpcCalls).toHaveLength(1)
    const args = fake.state.rpcCalls[0]!.args
    expect(fake.state.rpcCalls[0]!.name).toBe('reserve_hardware_job')
    expect(args.p_bonus_threshold).toBe(HARDWARE_BONUS_THRESHOLD)
    expect(args.p_bonus_jobs).toBe(HARDWARE_BONUS_JOBS)
    // The "subscription year" is the trailing 365 days from now.
    const yearStart = new Date(String(args.p_year_start)).getTime()
    const expected = Date.now() - 365 * 24 * 60 * 60 * 1000
    expect(Math.abs(yearStart - expected)).toBeLessThan(60_000)
  })

  it('disarms the bonus for every non-Pro allowance', async () => {
    await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 500, PERIOD)
    const args = fake.state.rpcCalls[0]!.args
    expect(args.p_bonus_threshold).toBeNull()
    expect(args.p_bonus_jobs).toBe(0)
    expect(args.p_year_start).toBeNull()
  })

  it('still passes the plain quota arguments unchanged', async () => {
    await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 50, PERIOD)
    const args = fake.state.rpcCalls[0]!.args
    expect(args.p_user_id).toBe(USER)
    expect(args.p_backend).toBe('ibm_brisbane')
    expect(args.p_shots).toBe(1024)
    expect(args.p_limit).toBe(50)
    expect(args.p_period_start).toBe(PERIOD)
  })
})

describe('reserveHardwareJob — reading the row back', () => {
  it('surfaces a grant made by this very reservation', async () => {
    fake.state.rpcResult = {
      data: reservedRow({ used: 50, bonus_jobs: 25, bonus_granted: true }),
      error: null,
    }
    const outcome = await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 50, PERIOD)
    expect(outcome.reserved).toBe(true)
    expect(outcome.used).toBe(50)
    expect(outcome.bonus).toEqual({ jobs: 25, grantedNow: true })
    expect(outcome.reservation).toEqual({ id: 'row-1', userId: USER })
  })

  it('a refusal carries the active bonus so the error copy can be honest', async () => {
    fake.state.rpcResult = {
      data: [
        { reserved: false, used: 75, reservation_id: null, bonus_jobs: 25, bonus_granted: false },
      ],
      error: null,
    }
    const outcome = await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 50, PERIOD)
    expect(outcome.reserved).toBe(false)
    expect(outcome.used).toBe(75)
    expect(outcome.bonus).toEqual({ jobs: 25, grantedNow: false })
    expect(outcome.reservation).toBeUndefined()
  })

  it('a reservation without an id is refused, not trusted', async () => {
    fake.state.rpcResult = { data: reservedRow({ reservation_id: null }), error: null }
    await expect(reserveHardwareJob(USER, 'x', 1, 50, PERIOD)).rejects.toBeInstanceOf(
      QuotaUnavailableError
    )
  })

  it('a store refusal is QuotaUnavailableError — an unknown count must not authorise', async () => {
    fake.state.rpcResult = { data: null, error: { code: '57014', message: 'canceled' } }
    await expect(reserveHardwareJob(USER, 'x', 1, 50, PERIOD)).rejects.toBeInstanceOf(
      QuotaUnavailableError
    )
  })

  it('a zero-or-negative limit refuses locally without touching the store', async () => {
    const outcome = await reserveHardwareJob(USER, 'x', 1, 0, PERIOD)
    expect(outcome.reserved).toBe(false)
    expect(fake.state.rpcCalls).toHaveLength(0)
  })
})

describe('reserveHardwareJob — legacy fallback', () => {
  it('a missing RPC falls back to insert-then-count (no bonus) instead of refusing', async () => {
    fake.state.rpcResult = {
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    }
    fake.state.usageRows = [{ id: 'a' }] // count AFTER the insert, well under 50
    const outcome = await reserveHardwareJob(USER, 'ibm_brisbane', 1024, 50, PERIOD)
    expect(outcome.reserved).toBe(true)
    expect(outcome.reservation?.id).toMatch(/^res-/)
    // The legacy path predates the mechanic and must not invent a bonus.
    expect(outcome.bonus).toBeUndefined()
    expect(fake.state.inserted).toHaveLength(1)
  })
})

describe('activeHardwareBonus', () => {
  it('returns the newest grant in the window', async () => {
    fake.state.bonusRows = [{ jobs: 25, granted_at: '2026-08-10T12:00:00.000Z' }]
    await expect(activeHardwareBonus(USER, PERIOD)).resolves.toEqual({
      jobs: 25,
      grantedAt: '2026-08-10T12:00:00.000Z',
    })
  })

  it('is display-only: a store error degrades to null, never a throw', async () => {
    fake.state.bonusError = { message: 'relation "hardware_bonus" does not exist' }
    await expect(activeHardwareBonus(USER, PERIOD)).resolves.toBeNull()
  })

  it('no grant in the window is null', async () => {
    await expect(activeHardwareBonus(USER, PERIOD)).resolves.toBeNull()
  })

  it('rejects nonsense rows rather than displaying them', async () => {
    fake.state.bonusRows = [{ jobs: -3, granted_at: '2026-08-10T12:00:00.000Z' }]
    await expect(activeHardwareBonus(USER, PERIOD)).resolves.toBeNull()
  })
})
