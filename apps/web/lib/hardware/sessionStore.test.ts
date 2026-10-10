/**
 * sessionStore.test.ts — the ownership record behind
 * `DELETE /api/hardware/session/{id}`.
 *
 * FAKED: the Supabase client (via `@/lib/billing/entitlements`' service-role
 * accessor and the config flags). REAL: every decision this module makes.
 *
 * The four failures these tests exist to catch, in order of how expensive they
 * would be to ship:
 *
 *  1. `ownsRuntimeSession` returning `false` on an outage. That is a "no" that
 *     means "we don't know", and anything that gates on it would refuse a
 *     legitimate owner — which, for a session, means leaving a QPU reserved and
 *     billing. It must throw.
 *
 *  2. `authorizeSessionClose` refusing on anything other than a POSITIVE
 *     identification of a different owner. A refused close is a device that
 *     keeps costing money, so "store is down" and "no row for this id" have to
 *     come back as allowed-and-logged, and an assertion that only pins the
 *     `allow` boolean would not notice the basis silently becoming wrong.
 *
 *  3. `authorizeSessionClose` ALLOWING a stranger. This is the whole point of
 *     the table; if it regresses, gap 3.4 is open again and nothing else in the
 *     suite would say so.
 *
 *  4. A second close overwriting the first `closed_at`. The first close is the
 *     one that stopped the meter, so a retry that moves the timestamp forward
 *     makes the held-time query in supabase/schema-sessions.sql report a window
 *     longer than the one actually held.
 *
 *  5. EITHER `session_id` filter going missing. These two lines are the whole
 *     module: drop the one in `findRuntimeSession` and it answers with whatever
 *     row comes back first, so anyone who owns ANY session is authorised to
 *     close EVERY session; drop the one in `markRuntimeSessionClosed` and one
 *     close stamps `closed_at` on every unclosed row in the table. A suite that
 *     only ever puts ONE row in the store cannot see either of those, because a
 *     filter on a single-row table is indistinguishable from no filter — so the
 *     tests below deliberately seed a SECOND session for both.
 *
 *  6. A vendor placeholder id ('None' — `str(None)`, which
 *     services/api/app/quantum/hardware.py can emit for a simulator session)
 *     being recorded as a primary key. Two accounts would then claim one row
 *     and the loser's own close would be refused as another account's.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SessionRow {
  session_id: string
  user_id: string
  backend: string
  max_time_seconds: number | null
  opened_at: string
  closed_at: string | null
}

const fake = vi.hoisted(() => {
  const state = {
    rows: [] as SessionRow[],
    /** Set to make every SELECT come back refused (the outage case). */
    readError: null as { message: string } | null,
    /** Set to make every INSERT/UPDATE come back refused. */
    writeError: null as { message: string } | null,
    /** Set to make `getServiceSupabase()` hand back null (no key configured). */
    clientNull: false,
    /** Every UPDATE that ran, with how many rows it actually matched. */
    updates: [] as Array<{ patch: Record<string, unknown>; matched: number }>,
  }

  function client() {
    return {
      from(_table: string) {
        const where: Array<[string, unknown]> = []
        let mode: 'select' | 'update' = 'select'
        let patch: Record<string, unknown> = {}

        const matches = (row: SessionRow) => {
          const cells = row as unknown as Record<string, unknown>
          return where.every(([col, value]) => cells[col] === value)
        }

        const run = () => {
          if (mode === 'update') {
            if (state.writeError) return { data: null, error: state.writeError }
            let matched = 0
            for (const row of state.rows) {
              if (matches(row)) {
                Object.assign(row, patch)
                matched += 1
              }
            }
            state.updates.push({ patch, matched })
            return { data: null, error: null }
          }
          if (state.readError) return { data: null, error: state.readError }
          return { data: state.rows.filter(matches).map((r) => ({ ...r })), error: null }
        }

        const api = {
          select: () => api,
          // `eq` and `is` are the same operation against this in-memory table;
          // they are separate methods only because PostgREST spells null
          // comparison differently.
          eq: (col: string, value: unknown) => {
            where.push([col, value])
            return api
          },
          is: (col: string, value: unknown) => {
            where.push([col, value])
            return api
          },
          order: () => api,
          update: (next: Record<string, unknown>) => {
            mode = 'update'
            patch = next
            return api
          },
          insert: (row: Record<string, unknown>) => {
            if (state.writeError) return Promise.resolve({ data: null, error: state.writeError })
            // Model the PRIMARY KEY. Without this the fake happily stores two
            // rows under one session id, which is the one thing the real table
            // cannot do and the exact collision the 'None' placeholder would
            // cause.
            if (state.rows.some((r) => r.session_id === row.session_id)) {
              return Promise.resolve({
                data: null,
                error: {
                  message:
                    'duplicate key value violates unique constraint "runtime_sessions_pkey"',
                },
              })
            }
            state.rows.push({
              opened_at: '2026-09-17T09:00:00.000Z',
              closed_at: null,
              ...row,
            } as unknown as SessionRow)
            return Promise.resolve({ data: null, error: null })
          },
          limit: () => Promise.resolve(run()),
          // Awaiting the builder directly — the update path has no `.limit()`.
          then: (resolve: (v: unknown) => void) => resolve(run()),
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
  getServiceSupabase: () => (fake.state.clientNull ? null : fake.client()),
}))

import {
  authorizeSessionClose,
  findRuntimeSession,
  listRuntimeSessions,
  markRuntimeSessionClosed,
  ownsRuntimeSession,
  recordRuntimeSession,
  SessionStoreError,
} from './sessionStore'

const OWNER = 'user-owner'
const STRANGER = 'user-stranger'
const SESSION = 'cxyz123session'

/** Put one already-open session in the store, owned by OWNER. */
function seedOpenSession(overrides: Partial<SessionRow> = {}) {
  fake.state.rows.push({
    session_id: SESSION,
    user_id: OWNER,
    backend: 'ibm_brisbane',
    max_time_seconds: 3600,
    opened_at: '2026-09-17T09:00:00.000Z',
    closed_at: null,
    ...overrides,
  })
}

beforeEach(() => {
  fake.state.rows = []
  fake.state.readError = null
  fake.state.writeError = null
  fake.state.clientNull = false
  fake.state.updates = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('recordRuntimeSession', () => {
  it('writes the owner, the device and the REQUESTED window', async () => {
    await expect(
      recordRuntimeSession(OWNER, SESSION, 'ibm_brisbane', 3600)
    ).resolves.toBe(true)
    expect(fake.state.rows).toHaveLength(1)
    expect(fake.state.rows[0]).toMatchObject({
      session_id: SESSION,
      user_id: OWNER,
      backend: 'ibm_brisbane',
      max_time_seconds: 3600,
      closed_at: null,
    })
  })

  it('reports failure instead of throwing — the session is already open and billing', async () => {
    // Throwing here would turn a successful open into a 500 and leave the user
    // holding a reserved device whose id we refused to hand back.
    fake.state.writeError = { message: 'relation "runtime_sessions" does not exist' }
    await expect(
      recordRuntimeSession(OWNER, SESSION, 'ibm_brisbane', 3600)
    ).resolves.toBe(false)
  })

  it('does not write an ownership claim with no owner', async () => {
    await expect(recordRuntimeSession('', SESSION, 'ibm_brisbane', 3600)).resolves.toBe(false)
    expect(fake.state.rows).toHaveLength(0)
  })

  it("refuses the placeholder id 'None', which is str(None) from a simulator session", async () => {
    // The failure this catches: recording 'None' makes it a primary key shared
    // by every account that opens a simulator session. The first writer wins,
    // and every other owner's close is then positively identified as somebody
    // else's and REFUSED — the one outcome the close policy exists to prevent.
    await expect(recordRuntimeSession(OWNER, 'None', 'ibm_sim', 3600)).resolves.toBe(false)
    await expect(recordRuntimeSession(STRANGER, 'none', 'ibm_sim', 3600)).resolves.toBe(false)
    expect(fake.state.rows).toHaveLength(0)

    // And the close of such a session stays allowed, on the unrecorded branch.
    const decision = await authorizeSessionClose(STRANGER, 'None')
    expect(decision.allow).toBe(true)
    expect(decision.basis).toBe('unrecorded')
  })

  it('keeps the OWNERSHIP row when the requested window is unstorable', async () => {
    // The failure this catches: `max_time_seconds integer not null check
    // (... between 60 and 28800)` would reject the INSERT outright for an
    // out-of-range window, and what we would lose is not the window — it is the
    // ownership row, which silently reopens gap 3.4 for that session. A
    // decorative column must not be able to veto the security record.
    await expect(recordRuntimeSession(OWNER, SESSION, 'ibm_brisbane', 999_999)).resolves.toBe(true)
    expect(fake.state.rows[0]).toMatchObject({ session_id: SESSION, user_id: OWNER })
    expect(fake.state.rows[0]!.max_time_seconds).toBeNull()
    // Null, never a clamped 28800: an operator reconciling an invoice must not
    // read an invented number as a request that was made.
    await expect(findRuntimeSession(SESSION)).resolves.toMatchObject({ maxTimeSeconds: null })
  })

  it('keeps the ownership row when the window is not a number at all', async () => {
    await expect(
      recordRuntimeSession(OWNER, SESSION, 'ibm_brisbane', Number.NaN)
    ).resolves.toBe(true)
    expect(fake.state.rows[0]!.max_time_seconds).toBeNull()
  })
})

describe('ownsRuntimeSession', () => {
  it('recognises the account that opened the session', async () => {
    seedOpenSession()
    await expect(ownsRuntimeSession(OWNER, SESSION)).resolves.toBe(true)
  })

  it('does not recognise another account holding the same id', async () => {
    seedOpenSession()
    await expect(ownsRuntimeSession(STRANGER, SESSION)).resolves.toBe(false)
  })

  it('does not recognise an id that was never recorded', async () => {
    await expect(ownsRuntimeSession(OWNER, 'never-seen')).resolves.toBe(false)
  })

  it('THROWS when the store cannot answer, rather than saying "not yours"', async () => {
    // The failure this catches: a `catch { return false }` here would look
    // harmless and would refuse the real owner during any database blip.
    seedOpenSession()
    fake.state.readError = { message: 'canceling statement due to statement timeout' }
    await expect(ownsRuntimeSession(OWNER, SESSION)).rejects.toBeInstanceOf(SessionStoreError)
  })

  it('THROWS when there is no service-role client at all', async () => {
    fake.state.clientNull = true
    await expect(ownsRuntimeSession(OWNER, SESSION)).rejects.toBeInstanceOf(SessionStoreError)
  })
})

describe('findRuntimeSession', () => {
  it('distinguishes "no such session" from "cannot answer"', async () => {
    await expect(findRuntimeSession('never-seen')).resolves.toBeNull()
    fake.state.readError = { message: 'connection refused' }
    await expect(findRuntimeSession('never-seen-either')).rejects.toBeInstanceOf(SessionStoreError)
  })

  it('looks the session up BY ID when the table holds more than one', async () => {
    // The failure this catches: dropping `.eq('session_id', sessionId)` from
    // the lookup. On a single-row store that mutation is invisible, and every
    // other test in this file used to seed exactly one row — so it survived the
    // whole suite. Live, it means `authorizeSessionClose` answers 'owner' for
    // whichever row PostgREST returns first, and anyone who owns ANY session is
    // authorised to close EVERY session. That is gap 3.4 wide open.
    seedOpenSession({ session_id: 'session-a', user_id: STRANGER, backend: 'ibm_kyiv' })
    seedOpenSession({ session_id: 'session-b', user_id: OWNER, backend: 'ibm_brisbane' })

    await expect(findRuntimeSession('session-b')).resolves.toMatchObject({
      sessionId: 'session-b',
      userId: OWNER,
      backend: 'ibm_brisbane',
    })
    await expect(ownsRuntimeSession(OWNER, 'session-a')).resolves.toBe(false)
    await expect(authorizeSessionClose(OWNER, 'session-a')).resolves.toMatchObject({
      allow: false,
      basis: 'other-owner',
    })
  })

  it('normalises the row, including PostgREST returning an integer as text', async () => {
    seedOpenSession({ max_time_seconds: '7200' as unknown as number })
    await expect(findRuntimeSession(SESSION)).resolves.toEqual({
      sessionId: SESSION,
      userId: OWNER,
      backend: 'ibm_brisbane',
      maxTimeSeconds: 7200,
      openedAt: '2026-09-17T09:00:00.000Z',
      closedAt: null,
    })
  })
})

describe('authorizeSessionClose', () => {
  it('allows the owner, on the basis of ownership', async () => {
    seedOpenSession()
    await expect(authorizeSessionClose(OWNER, SESSION)).resolves.toMatchObject({
      allow: true,
      basis: 'owner',
    })
  })

  it('REFUSES a positively identified stranger — this is the gap 3.4 fix', async () => {
    seedOpenSession()
    const decision = await authorizeSessionClose(STRANGER, SESSION)
    expect(decision.allow).toBe(false)
    expect(decision.basis).toBe('other-owner')
  })

  it('allows an UNRECORDED session rather than stranding a live meter', async () => {
    // Sessions opened before this table existed, and sessions whose
    // recordRuntimeSession failed, have no row. Refusing those would hold a
    // device open because of OUR missing write.
    const decision = await authorizeSessionClose(OWNER, 'opened-before-the-table-existed')
    expect(decision.allow).toBe(true)
    expect(decision.basis).toBe('unrecorded')
    expect(decision.why).not.toBe('')
  })

  it('allows on a store outage, and says so — refusing would keep the QPU billing', async () => {
    seedOpenSession()
    fake.state.readError = { message: 'connection refused' }
    const decision = await authorizeSessionClose(OWNER, SESSION)
    expect(decision.allow).toBe(true)
    // The basis is asserted separately from `allow` on purpose: an outage that
    // silently started reporting itself as `owner` would still close sessions
    // correctly and would quietly destroy the audit trail of when we could not
    // check.
    expect(decision.basis).toBe('unverified')
    expect(decision.why).toContain('connection refused')
  })

  it('never throws, whatever the store does', async () => {
    fake.state.clientNull = true
    await expect(authorizeSessionClose(OWNER, SESSION)).resolves.toMatchObject({
      allow: true,
      basis: 'unverified',
    })
  })

  it('refuses a missing caller id under its own basis, not as an ownership conflict', async () => {
    seedOpenSession()
    const decision = await authorizeSessionClose('', SESSION)
    expect(decision.allow).toBe(false)
    expect(decision.basis).toBe('malformed')
  })
})

describe('markRuntimeSessionClosed', () => {
  it('records the close', async () => {
    seedOpenSession()
    await markRuntimeSessionClosed(SESSION)
    expect(fake.state.rows[0]!.closed_at).toEqual(expect.any(String))
    expect(fake.state.updates[0]!.matched).toBe(1)
  })

  it('stamps ONLY the named session when several are open', async () => {
    // The failure this catches: dropping `.eq('session_id', sessionId)` from the
    // UPDATE. With one row in the store that mutation passes every assertion —
    // `.is('closed_at', null)` alone still produces matched 1 then 0 — so it
    // needs a second open session to be visible at all. Live, it means closing
    // one session stamps closed_at on every unclosed row in the table, which
    // destroys the audit trail for every other account at once and makes the
    // held-time query report windows that were never held.
    seedOpenSession()
    seedOpenSession({ session_id: 'someone-elses', user_id: STRANGER })

    await markRuntimeSessionClosed(SESSION)

    expect(fake.state.rows.find((r) => r.session_id === SESSION)!.closed_at).toEqual(
      expect.any(String)
    )
    expect(fake.state.rows.find((r) => r.session_id === 'someone-elses')!.closed_at).toBeNull()
    expect(fake.state.updates[0]!.matched).toBe(1)
  })

  it('closing twice is safe and KEEPS THE FIRST close time', async () => {
    // The first close is the one that stopped the meter. A retry that moved the
    // timestamp forward would make the held-time query report a longer window
    // than was actually held.
    //
    // The clock is FAKED and advanced between the two closes on purpose. With
    // the real clock both calls land in the same millisecond, so the two
    // timestamps are identical whatever the code does and the assertion below
    // passes even against an UPDATE with no `.is('closed_at', null)` filter —
    // it was proving nothing.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
      seedOpenSession()
      await markRuntimeSessionClosed(SESSION)
      const first = fake.state.rows[0]!.closed_at
      expect(first).toBe('2026-09-17T10:00:00.000Z')

      vi.setSystemTime(new Date('2026-09-17T10:05:00.000Z'))
      await markRuntimeSessionClosed(SESSION)
      expect(fake.state.rows[0]!.closed_at).toBe(first)
    } finally {
      vi.useRealTimers()
    }
    // The second UPDATE ran and matched nothing, because of the
    // `.is('closed_at', null)` filter — that is what makes it idempotent.
    expect(fake.state.updates).toHaveLength(2)
    expect(fake.state.updates[1]!.matched).toBe(0)
  })

  it('does not throw when the store refuses — the close already happened upstream', async () => {
    seedOpenSession()
    fake.state.writeError = { message: 'permission denied for table runtime_sessions' }
    await expect(markRuntimeSessionClosed(SESSION)).resolves.toBeUndefined()
  })

  it('does not throw when there is no store at all', async () => {
    fake.state.clientNull = true
    await expect(markRuntimeSessionClosed(SESSION)).resolves.toBeUndefined()
  })
})

describe('listRuntimeSessions', () => {
  it('throws rather than reporting an empty history it cannot vouch for', async () => {
    fake.state.readError = { message: 'connection refused' }
    await expect(listRuntimeSessions(OWNER)).rejects.toBeInstanceOf(SessionStoreError)
  })

  it('returns only the caller’s sessions', async () => {
    seedOpenSession()
    seedOpenSession({ session_id: 'other', user_id: STRANGER })
    const rows = await listRuntimeSessions(OWNER)
    expect(rows.map((r) => r.sessionId)).toEqual([SESSION])
  })
})
