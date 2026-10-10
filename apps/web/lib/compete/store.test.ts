/**
 * store.test.ts — the Map fallback, which is the zero-config deployment's
 * whole leaderboard, so its ordering and best-only semantics are load-bearing:
 * a wrong sort here is a wrong podium, not a cosmetic bug.
 *
 * These tests run against the memory backend (no SUPABASE_SERVICE_ROLE_KEY in
 * the test environment). The Supabase backend shares the `beats` comparison
 * and the row mapping lives beside it; the SQL itself is unverified and says
 * so in supabase/schema-competitions.sql.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetCompeteStoreForTests,
  getCompeteStore,
  type CompetitionEntry,
} from './store'

function entry(overrides: Partial<CompetitionEntry>): CompetitionEntry {
  return {
    competitionId: 'weekly-2026-W35',
    accountId: 'acct-a',
    displayName: 'Ada',
    gates: 5,
    qasm: 'OPENQASM 3.0;',
    submittedAt: '2026-08-26T10:00:00.000Z',
    ...overrides,
  }
}

describe('compete memory store', () => {
  beforeEach(() => __resetCompeteStoreForTests())

  it('is the memory backend in a bare test environment, and says so', () => {
    const store = getCompeteStore()
    expect(store.kind).toBe('memory')
    expect(store.durable).toBe(false)
  })

  it('round-trips an entry', async () => {
    const store = getCompeteStore()
    const e = entry({})
    await store.upsertBest(e)
    expect(await store.getEntry(e.competitionId, e.accountId)).toEqual(e)
  })

  it('keeps only the best entry per account: fewer gates replaces', async () => {
    const store = getCompeteStore()
    await store.upsertBest(entry({ gates: 7 }))
    const better = await store.upsertBest(entry({ gates: 4, submittedAt: '2026-08-26T11:00:00.000Z' }))
    expect(better.improved).toBe(true)
    expect((await store.getEntry('weekly-2026-W35', 'acct-a'))?.gates).toBe(4)
  })

  it('a tie or worse changes nothing — submitted_at stays the first achievement', async () => {
    const store = getCompeteStore()
    await store.upsertBest(entry({ gates: 4, submittedAt: '2026-08-26T10:00:00.000Z' }))
    const tie = await store.upsertBest(entry({ gates: 4, submittedAt: '2026-08-26T12:00:00.000Z' }))
    const worse = await store.upsertBest(entry({ gates: 9, submittedAt: '2026-08-26T13:00:00.000Z' }))
    expect(tie.improved).toBe(false)
    expect(worse.improved).toBe(false)
    const standing = await store.getEntry('weekly-2026-W35', 'acct-a')
    expect(standing?.gates).toBe(4)
    expect(standing?.submittedAt).toBe('2026-08-26T10:00:00.000Z')
  })

  it('ranks by gate count, ties by earlier submission', async () => {
    const store = getCompeteStore()
    await store.upsertBest(entry({ accountId: 'slow', displayName: 'Slow', gates: 3, submittedAt: '2026-08-26T12:00:00.000Z' }))
    await store.upsertBest(entry({ accountId: 'fast', displayName: 'Fast', gates: 3, submittedAt: '2026-08-26T09:00:00.000Z' }))
    await store.upsertBest(entry({ accountId: 'long', displayName: 'Long', gates: 8, submittedAt: '2026-08-25T09:00:00.000Z' }))

    const top = await store.topEntries('weekly-2026-W35', 20)
    expect(top.map((r) => r.displayName)).toEqual(['Fast', 'Slow', 'Long'])
    expect(await store.rankOf('weekly-2026-W35', 'fast')).toBe(1)
    expect(await store.rankOf('weekly-2026-W35', 'slow')).toBe(2)
    expect(await store.rankOf('weekly-2026-W35', 'long')).toBe(3)
    expect(await store.rankOf('weekly-2026-W35', 'nobody')).toBeNull()
  })

  it('truncates the board at the requested size', async () => {
    const store = getCompeteStore()
    for (let i = 0; i < 25; i++) {
      await store.upsertBest(
        entry({ accountId: `acct-${i}`, displayName: `P${i}`, gates: 10 + i })
      )
    }
    expect((await store.topEntries('weekly-2026-W35', 20)).length).toBe(20)
  })

  it('keeps competitions apart', async () => {
    const store = getCompeteStore()
    await store.upsertBest(entry({}))
    await store.upsertBest(entry({ competitionId: 'weekly-2026-W36', gates: 2 }))
    expect((await store.topEntries('weekly-2026-W35', 20)).length).toBe(1)
    expect((await store.topEntries('weekly-2026-W36', 20))[0]?.gates).toBe(2)
  })

  it('leaderboard rows never carry the account id or the circuit', async () => {
    const store = getCompeteStore()
    await store.upsertBest(entry({}))
    const [row] = await store.topEntries('weekly-2026-W35', 20)
    expect(Object.keys(row).sort()).toEqual(['displayName', 'gates', 'submittedAt'])
  })
})
