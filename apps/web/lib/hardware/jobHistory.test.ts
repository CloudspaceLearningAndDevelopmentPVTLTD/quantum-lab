/**
 * Tests for the durable hardware job history.
 *
 * Two things are worth pinning down here, and they are the two that would be
 * silently wrong rather than loudly broken:
 *
 *  1. The CSV export. It is the artefact somebody loads into pandas six months
 *     after the run, so its shape, its quoting and — above all — its row count
 *     have to be right. An export that silently drops the jobs with no counts
 *     would make the file disagree with the panel about how many runs happened,
 *     and nobody would notice until they were counting.
 *
 *  2. `recordHardwareResult`'s patch construction. It is called on EVERY poll,
 *     including polls of jobs that are still queued, and the one way it could
 *     destroy the data it exists to preserve is by writing a null `counts` over
 *     a finished job's histogram.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { historyToCsv } from '@/components/hardware/JobHistory'
import type { HardwareJobHistoryEntry } from '@/lib/hardware/types'

function entry(overrides: Partial<HardwareJobHistoryEntry> = {}): HardwareJobHistoryEntry {
  return {
    id: 'row-1',
    provider: 'ibm',
    jobId: 'job-1',
    backend: 'ibm_brisbane',
    shots: 1024,
    submittedAt: '2026-09-01T10:00:00.000Z',
    status: 'done',
    counts: { '00': 500, '11': 524 },
    qasm: null,
    error: null,
    qpuSeconds: 1.25,
    optimizationLevel: 3,
    transpiledDepth: 12,
    transpiledTwoQubitGates: 4,
    completedAt: '2026-09-01T10:45:00.000Z',
    ...overrides,
  }
}

describe('historyToCsv', () => {
  it('emits one row per measured bitstring, not one per job', () => {
    const csv = historyToCsv([entry()])
    const lines = csv.split('\n')

    // Header plus two outcomes.
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('"00"')
    expect(lines[1]).toContain('"500"')
    expect(lines[2]).toContain('"11"')
  })

  it('still emits a row for a job that produced no counts', () => {
    // Otherwise the file disagrees with the panel about how many runs happened,
    // which is the kind of discrepancy that is only found while counting.
    const csv = historyToCsv([entry({ status: 'error', counts: null, error: 'device offline' })])
    const lines = csv.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"error"')
  })

  it('renders a never-polled job without inventing a status', () => {
    const csv = historyToCsv([entry({ status: null, counts: null, completedAt: null })])

    // An empty cell, not "queued". We genuinely do not know.
    expect(csv.split('\n')[1]).toContain('"",')
    expect(csv).not.toContain('queued')
  })

  it('quotes every field and escapes embedded quotes', () => {
    // Vendor error text is not ours to assume is comma-free or quote-free.
    const csv = historyToCsv([
      entry({ counts: null, error: 'device said "no", loudly' }),
    ])

    expect(csv).toContain('"device said ""no"", loudly"')
  })

  it('names every column the analysis needs to compare two runs', () => {
    const header = historyToCsv([]).split('\n')[0]

    for (const column of [
      'submitted_at',
      'backend',
      'status',
      'shots_requested',
      'optimization_level',
      'transpiled_two_qubit_gates',
      'qpu_seconds',
      'bitstring',
      'count',
    ]) {
      expect(header).toContain(column)
    }
  })

  it('emits only a header for an empty history', () => {
    expect(historyToCsv([]).split('\n')).toHaveLength(1)
  })
})

// ── recordHardwareResult ────────────────────────────────────────────────────

const update = vi.fn()
const eq = vi.fn()

/**
 * A chainable PostgREST double.
 *
 * `update(...).eq(...).eq(...).eq(...)` has to resolve, so every `eq` returns
 * an object that is both chainable and thenable.
 */
function supabaseDouble() {
  const chain: Record<string, unknown> = {}
  chain.eq = (...args: unknown[]) => {
    eq(...args)
    return chain
  }
  chain.then = (resolve: (value: { error: null }) => unknown) => resolve({ error: null })
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        update(patch)
        return chain
      },
    }),
  }
}

vi.mock('@/lib/billing/entitlements', () => ({
  getServiceSupabase: () => supabaseDouble(),
  isServiceRoleConfigured: () => true,
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => null,
}))

describe('recordHardwareResult', () => {
  beforeEach(() => {
    update.mockClear()
    eq.mockClear()
  })

  it('never writes a null counts over a finished job', async () => {
    // The poll of a queued job carries no counts. If that were written as
    // `counts: null`, one late poll of an already-finished job would erase the
    // histogram this whole feature exists to keep.
    const { recordHardwareResult } = await import('@/lib/billing/usage')
    await recordHardwareResult('user-1', 'ibm', 'job-1', { status: 'queued', counts: null })

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).not.toHaveProperty('counts')
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'queued' })
  })

  it('stamps a completion time only on a terminal status', async () => {
    const { recordHardwareResult } = await import('@/lib/billing/usage')

    await recordHardwareResult('user-1', 'ibm', 'job-1', { status: 'running' })
    expect(update.mock.calls[0][0]).not.toHaveProperty('completed_at')

    await recordHardwareResult('user-1', 'ibm', 'job-1', {
      status: 'done',
      counts: { '00': 1 },
    })
    expect(update.mock.calls[1][0]).toHaveProperty('completed_at')
    expect(update.mock.calls[1][0]).toMatchObject({ counts: { '00': 1 } })
  })

  it('scopes the write by user as well as by job', async () => {
    // The user id is part of the WHERE clause, not an audit column: a bug
    // elsewhere must not let one caller's poll write over another's row.
    const { recordHardwareResult } = await import('@/lib/billing/usage')
    await recordHardwareResult('user-1', 'ibm', 'job-1', { status: 'done' })

    expect(eq.mock.calls).toEqual([
      ['user_id', 'user-1'],
      ['provider', 'ibm'],
      ['job_id', 'job-1'],
    ])
  })

  it('writes nothing when any part of the job identity is missing', async () => {
    const { recordHardwareResult } = await import('@/lib/billing/usage')
    await recordHardwareResult('', 'ibm', 'job-1', { status: 'done' })
    await recordHardwareResult('user-1', '', 'job-1', { status: 'done' })
    await recordHardwareResult('user-1', 'ibm', '', { status: 'done' })

    expect(update).not.toHaveBeenCalled()
  })
})
