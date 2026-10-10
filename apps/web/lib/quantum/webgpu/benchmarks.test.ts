import { describe, it, expect } from 'vitest'
import { StateVector, cExp, simulate } from '@/lib/quantum'
import {
  DEFAULT_BUDGET,
  RANDOM_DEPTH,
  TIME_GROWTH_PER_QUBIT,
  benchmarkCircuit,
  cphase,
  fmtBytes,
  fmtMs,
  ghzCircuit,
  nextProbeStep,
  qftCircuit,
  randomCircuit,
} from './benchmarks'

describe('cphase decomposition', () => {
  it('is diag(1, 1, 1, e^{iθ}) on every basis state', () => {
    const theta = 1.234
    for (let basis = 0; basis < 4; basis++) {
      const sv = new StateVector(2)
      sv.data[0] = 0
      sv.data[2 * basis] = 1
      for (const op of cphase(0, 1, theta)) sv.apply(op)
      const expected = basis === 3 ? cExp(theta) : { re: 1, im: 0 }
      for (let i = 0; i < 4; i++) {
        const want = i === basis ? expected : { re: 0, im: 0 }
        expect(sv.data[2 * i]).toBeCloseTo(want.re, 12)
        expect(sv.data[2 * i + 1]).toBeCloseTo(want.im, 12)
      }
    }
  })
})

describe('qftCircuit', () => {
  it('QFT on |0⟩ is the uniform superposition with zero phase', () => {
    for (let n = 1; n <= 6; n++) {
      const sv = simulate(qftCircuit(n))
      const dim = 1 << n
      for (let k = 0; k < dim; k++) {
        expect(sv.data[2 * k]).toBeCloseTo(1 / Math.sqrt(dim), 12)
        expect(sv.data[2 * k + 1]).toBeCloseTo(0, 12)
      }
    }
  })

  it('QFT-5 on |x⟩ has amplitude e^{2πi xk/32}/√32 on |k⟩ (the DFT matrix)', () => {
    const n = 5
    for (const x of [1, 2, 7, 19, 31]) {
      const circuit = qftCircuit(n)
      const prep = []
      for (let q = 0; q < n; q++) if ((x >> q) & 1) prep.push({ name: 'X' as const, qubits: [q] })
      const sv = simulate({ numQubits: n, ops: [...prep, ...circuit.ops] })
      for (let k = 0; k < 32; k++) {
        const e = cExp((2 * Math.PI * x * k) / 32)
        expect(sv.data[2 * k]).toBeCloseTo(e.re / Math.sqrt(32), 10)
        expect(sv.data[2 * k + 1]).toBeCloseTo(e.im / Math.sqrt(32), 10)
      }
    }
  })

  it('gate count grows as O(N²): N Hadamards, 5·N(N−1)/2 for the phases, ⌊N/2⌋ swaps', () => {
    for (const n of [1, 2, 5, 8]) {
      expect(qftCircuit(n).ops).toHaveLength(n + (5 * n * (n - 1)) / 2 + Math.floor(n / 2))
    }
  })
})

describe('ghzCircuit', () => {
  it('produces (|0…0⟩ + |1…1⟩)/√2 with N gates', () => {
    for (const n of [1, 2, 4, 8]) {
      const circuit = ghzCircuit(n)
      expect(circuit.ops).toHaveLength(n)
      const probs = simulate(circuit).probabilities()
      expect(probs[0]).toBeCloseTo(0.5, 12)
      expect(probs[(1 << n) - 1]).toBeCloseTo(0.5, 12)
      expect(probs.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
    }
  })
})

describe('randomCircuit', () => {
  it('has depth × (N + 1) gates, one CX per layer with distinct qubits, and finite angles', () => {
    const circuit = randomCircuit(6, RANDOM_DEPTH, 5)
    expect(circuit.ops).toHaveLength(RANDOM_DEPTH * 7)
    const cxs = circuit.ops.filter((op) => op.name === 'CX')
    expect(cxs).toHaveLength(RANDOM_DEPTH)
    for (const cx of cxs) expect(cx.qubits[0]).not.toBe(cx.qubits[1])
    for (const op of circuit.ops) if (op.theta !== undefined) expect(Number.isFinite(op.theta)).toBe(true)
  })

  it('a single qubit circuit has no CX', () => {
    expect(randomCircuit(1, 3, 1).ops.every((op) => op.name !== 'CX')).toBe(true)
  })

  it('benchmarkCircuit dispatches by kind and normalises', () => {
    for (const kind of ['random', 'qft', 'ghz'] as const) {
      const sv = simulate(benchmarkCircuit(kind, 4))
      expect(sv.probabilities().reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12)
    }
  })

  it('rejects an out-of-range count', () => {
    expect(() => randomCircuit(0)).toThrow()
    expect(() => qftCircuit(31)).toThrow()
  })
})

describe('nextProbeStep', () => {
  const budget = { memoryBytes: 2 ** 20 * 16, timeMs: 1000, maxQubits: 25 } // 20 qubits of float64

  it('runs the next qubit when the last run was cheap', () => {
    expect(nextProbeStep('float64', 4, undefined, budget)).toEqual({ action: 'run', numQubits: 5 })
    expect(nextProbeStep('float64', 4, 10, budget)).toEqual({ action: 'run', numQubits: 5 })
  })

  it('stops at the memory budget, counting float32 as half the bytes', () => {
    const f64 = nextProbeStep('float64', 20, 5, budget)
    expect(f64.action).toBe('stop')
    if (f64.action === 'stop') expect(f64.largest).toBe(20)
    expect(nextProbeStep('float32', 20, 5, budget)).toEqual({ action: 'run', numQubits: 21 })
    const f32 = nextProbeStep('float32', 21, 5, budget)
    expect(f32.action).toBe('stop')
  })

  it('stops when the last run broke the time budget, reporting the previous size as the largest', () => {
    const step = nextProbeStep('float64', 12, 1500, budget)
    expect(step).toMatchObject({ action: 'stop', largest: 11 })
  })

  it('stops when the next run is predicted to break the time budget', () => {
    const lastMs = budget.timeMs / TIME_GROWTH_PER_QUBIT + 1
    expect(nextProbeStep('float64', 12, lastMs, budget)).toMatchObject({ action: 'stop', largest: 12 })
    expect(nextProbeStep('float64', 12, lastMs - 2, budget)).toEqual({ action: 'run', numQubits: 13 })
  })

  it('never passes the probe ceiling', () => {
    expect(nextProbeStep('float32', 25, 1, budget)).toMatchObject({ action: 'stop', largest: 25 })
    expect(DEFAULT_BUDGET.maxQubits).toBeLessThanOrEqual(30)
  })
})

describe('formatters', () => {
  it('fmtMs and fmtBytes pick sensible units', () => {
    expect(fmtMs(0.5)).toBe('500 µs')
    expect(fmtMs(3.14159)).toBe('3.14 ms')
    expect(fmtMs(250)).toBe('250 ms')
    expect(fmtMs(2500)).toBe('2.50 s')
    expect(fmtMs(NaN)).toBe('—')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(8 * 1024 * 1024)).toBe('8.0 MB')
    expect(fmtBytes(2 ** 30)).toBe('1.00 GB')
  })
})
