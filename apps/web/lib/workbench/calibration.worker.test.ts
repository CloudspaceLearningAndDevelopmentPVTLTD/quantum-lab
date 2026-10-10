import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from './calibration'
import { FAST_CHUNK, startPacedRun, type WorkerOutbound } from './calibration.worker'

/**
 * A hand-cranked scheduler: nothing runs until `flush()` is called, so the
 * loop's chunking, budget and stop behaviour can be checked step by step
 * without a real timer or a real worker.
 */
function fakeScheduler() {
  const queue: { id: number; fn: () => void; ms: number }[] = []
  let next = 1
  return {
    schedule: (fn: () => void, ms: number) => {
      const id = next++
      queue.push({ id, fn, ms })
      return id
    },
    cancel: (h: unknown) => {
      const i = queue.findIndex((q) => q.id === h)
      if (i >= 0) queue.splice(i, 1)
    },
    /** Run one pending callback. Returns false when nothing is pending. */
    flush: () => {
      const item = queue.shift()
      if (!item) return false
      item.fn()
      return true
    },
    pending: () => queue.length,
    lastDelay: () => (queue.length ? queue[queue.length - 1].ms : null),
  }
}

describe('paced run loop', () => {
  it('unpaced: delivers the budget in FAST_CHUNK-sized chunks and reports done exactly once', () => {
    const s = fakeScheduler()
    const out: WorkerOutbound[] = []
    startPacedRun({ ...DEFAULT_CONFIG, steps: 100 }, 0, (m) => out.push(m), s.schedule, s.cancel)
    let guard = 0
    while (s.flush() && guard++ < 50) {}
    const sizes = out.map((m) => m.records.length)
    expect(sizes).toEqual([FAST_CHUNK, FAST_CHUNK, 100 - 2 * FAST_CHUNK])
    expect(out.map((m) => m.done)).toEqual([false, false, true])
    expect(s.pending()).toBe(0)
    // Records are contiguous and numbered from zero.
    const steps = out.flatMap((m) => m.records.map((r) => r.step))
    expect(steps).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  it('paced: 60 steps/s at a 33 ms tick is two steps per tick, with the remainder carried', () => {
    const s = fakeScheduler()
    const out: WorkerOutbound[] = []
    startPacedRun({ ...DEFAULT_CONFIG, steps: 50 }, 60, (m) => out.push(m), s.schedule, s.cancel)
    for (let i = 0; i < 6; i++) s.flush()
    // 60 · 0.033 = 1.98 steps per tick: mostly 2, occasionally 1 as the carry catches up.
    const total = out.reduce((n, m) => n + m.records.length, 0)
    expect(total).toBeGreaterThanOrEqual(9)
    expect(total).toBeLessThanOrEqual(12)
    expect(s.lastDelay()).toBe(33)
  })

  it('stop cancels the pending tick and nothing more is emitted', () => {
    const s = fakeScheduler()
    const out: WorkerOutbound[] = []
    const h = startPacedRun({ ...DEFAULT_CONFIG, steps: 1000 }, 0, (m) => out.push(m), s.schedule, s.cancel)
    s.flush()
    expect(out).toHaveLength(1)
    h.stop()
    expect(s.pending()).toBe(0)
    expect(s.flush()).toBe(false)
    expect(out).toHaveLength(1)
    expect(h.run.done).toBe(false)
  })

  it('severity changes reach the live run', () => {
    const s = fakeScheduler()
    const out: WorkerOutbound[] = []
    const h = startPacedRun({ ...DEFAULT_CONFIG, steps: 80, severity: 0 }, 0, (m) => out.push(m), s.schedule, s.cancel)
    s.flush()
    h.run.setSeverity(1)
    s.flush()
    const first = out[0].records
    const second = out[1].records
    expect(first.every((r) => r.truth.frequency === 0)).toBe(true)
    expect(second.some((r) => r.truth.frequency !== 0)).toBe(true)
  })
})
