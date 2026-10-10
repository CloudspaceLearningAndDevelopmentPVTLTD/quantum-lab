import { describe, it, expect } from 'vitest'
import { simulate } from '@/lib/quantum'
import { CpuBackend } from '../backend'
import { ghzCircuit, randomCircuit } from './benchmarks'
import { maxAmplitudeDeviation } from './reference'
import { probeCapacity, timeCircuit } from './runner'

/** A clock that advances by a scripted amount per call, so wall times are deterministic. */
function fakeClock(stepMs: number) {
  let t = 0
  return () => (t += stepMs)
}

describe('timeCircuit', () => {
  it('reports gates, fused dispatch count, bytes, top states and the elapsed time', async () => {
    const backend = new CpuBackend()
    const circuit = ghzCircuit(5)
    const report = await timeCircuit(backend, circuit, { now: fakeClock(7), topK: 2 })
    expect(report.kind).toBe('cpu')
    expect(report.precision).toBe('float64')
    expect(report.gates).toBe(5)
    expect(report.dispatches).toBe(5)
    expect(report.bytes).toBe(32 * 16)
    expect(report.wallMs).toBe(7) // start → end is one clock tick
    expect(report.top.map((s) => s.index)).toEqual([0, 31])
    expect(report.amplitudes).toBeUndefined()
    backend.dispose()
  })

  it('reads amplitudes back when asked and they match the engine', async () => {
    const backend = new CpuBackend()
    const circuit = randomCircuit(6, 20, 77)
    const report = await timeCircuit(backend, circuit, { readAmplitudes: true })
    expect(report.amplitudes).toBeDefined()
    expect(maxAmplitudeDeviation(report.amplitudes!, simulate(circuit).data)).toBeLessThan(1e-9)
    expect(report.dispatches).toBeLessThan(report.gates)
    backend.dispose()
  })
})

describe('probeCapacity', () => {
  it('climbs from the start size and stops at the memory budget', async () => {
    const backend = new CpuBackend()
    const rungs: number[] = []
    const report = await probeCapacity(backend, 'ghz', {
      now: fakeClock(1),
      startQubits: 3,
      budget: { memoryBytes: 2 ** 8 * 16, timeMs: 1e9, maxQubits: 30 }, // 8 qubits of float64
      onRung: (r) => rungs.push(r.numQubits),
    })
    expect(rungs).toEqual([3, 4, 5, 6, 7, 8])
    expect(report.largest).toBe(8)
    expect(report.reason).toMatch(/9 qubits needs/)
    expect(report.rungs.every((r) => r.wallMs === 1)).toBe(true)
    backend.dispose()
  })

  it('stops when a rung breaks the time budget and does not count that rung', async () => {
    const backend = new CpuBackend()
    // Each timeCircuit() call takes two clock ticks (start, end), so the
    // measured wall time is the step size: 10 ms, 10 ms, ... — make the
    // budget 5 ms so the very first rung breaks it.
    const report = await probeCapacity(backend, 'ghz', {
      now: fakeClock(10),
      startQubits: 4,
      budget: { memoryBytes: 1e12, timeMs: 5, maxQubits: 30 },
    })
    expect(report.rungs.map((r) => r.numQubits)).toEqual([4])
    expect(report.largest).toBe(3)
    expect(report.reason).toMatch(/over the 5.00 ms budget/)
    backend.dispose()
  })

  it('stops when the next rung is predicted to break the budget', async () => {
    const backend = new CpuBackend()
    const report = await probeCapacity(backend, 'random', {
      now: fakeClock(10), // 10 ms per rung, predicted 22 ms for the next
      startQubits: 4,
      budget: { memoryBytes: 1e12, timeMs: 20, maxQubits: 30 },
    })
    expect(report.rungs.map((r) => r.numQubits)).toEqual([4])
    expect(report.largest).toBe(4)
    expect(report.reason).toMatch(/would take about/)
    backend.dispose()
  })

  it('folds the backend ceiling into the budget and honours shouldStop', async () => {
    const backend = new CpuBackend()
    const capped = await probeCapacity(backend, 'ghz', {
      now: fakeClock(1),
      startQubits: 26,
      budget: { memoryBytes: 1e15, timeMs: 1e9, maxQubits: 30 },
      shouldStop: () => true,
    })
    expect(capped.reason).toBe('stopped')
    expect(capped.largest).toBe(0)
    expect(capped.budget.maxQubits).toBe(backend.maxQubits)

    let calls = 0
    const stopped = await probeCapacity(backend, 'ghz', {
      now: fakeClock(1),
      startQubits: 2,
      budget: { memoryBytes: 1e12, timeMs: 1e9, maxQubits: 30 },
      shouldStop: () => calls++ >= 2,
      yieldBetween: async () => {},
    })
    expect(stopped.rungs.map((r) => r.numQubits)).toEqual([2, 3])
    expect(stopped.largest).toBe(3)
    backend.dispose()
  })
})
