/**
 * fitEstimate.test.ts — pins the two properties the picker's ranking relies on
 * (monotonic in depth, monotonic in error rate) and the label thresholds, so
 * neither can drift silently and re-order or re-label every device card.
 */

import { describe, expect, it } from 'vitest'
import {
  FIT_THRESHOLDS,
  circuitStats,
  estimateFit,
  fitLabel,
  type CalibrationSummary,
} from './fitEstimate'

function cal(median2q: number | null, source = 'static'): CalibrationSummary {
  return {
    source,
    qubits: 25,
    median_1q_error: 1e-4,
    median_2q_error: median2q,
    median_t1_us: 100,
    median_t2_us: 80,
    queue_depth: null,
    note: '',
  }
}

function successAt(depth: number, error: number): number {
  const fit = estimateFit(depth, cal(error))
  if (fit.kind !== 'estimate') throw new Error(`expected an estimate, got ${fit.kind}`)
  return fit.success
}

describe('estimateFit monotonicity', () => {
  it('is strictly decreasing in depth at a fixed error rate', () => {
    const error = 7.5e-3
    let previous = successAt(0, error)
    expect(previous).toBe(1) // depth 0 spends no error budget
    for (const depth of [1, 2, 5, 10, 50, 200, 1000]) {
      const current = successAt(depth, error)
      expect(current).toBeLessThan(previous)
      previous = current
    }
  })

  it('is strictly decreasing in error rate at a fixed depth', () => {
    const depth = 20
    let previous = successAt(depth, 1e-5)
    for (const error of [1e-4, 1e-3, 7.5e-3, 3e-2, 0.2]) {
      const current = successAt(depth, error)
      expect(current).toBeLessThan(previous)
      previous = current
    }
  })

  it('stays inside [0, 1] however hostile the inputs', () => {
    // exp(−5000) underflows IEEE 754 to exactly 0, so the floor is inclusive.
    for (const [depth, error] of [
      [0, 0],
      [1, 0],
      [10_000, 0.5],
      [3, 1],
    ] as const) {
      const success = successAt(depth, error)
      expect(success).toBeGreaterThanOrEqual(0)
      expect(success).toBeLessThanOrEqual(1)
    }
  })
})

describe('fit labels', () => {
  it('pins the threshold constants the UI copy documents', () => {
    expect(FIT_THRESHOLDS.good).toBe(0.75)
    expect(FIT_THRESHOLDS.marginal).toBe(0.35)
  })

  it('labels exactly at and just below each boundary', () => {
    expect(fitLabel(1)).toBe('good')
    expect(fitLabel(0.75)).toBe('good') // boundary is inclusive
    expect(fitLabel(0.7499)).toBe('marginal')
    expect(fitLabel(0.35)).toBe('marginal') // boundary is inclusive
    expect(fitLabel(0.3499)).toBe('poor')
    expect(fitLabel(0)).toBe('poor')
  })

  it('carries the calibration source through so the UI can say typical vs live', () => {
    const fit = estimateFit(4, cal(7.5e-3, 'live'))
    expect(fit).toMatchObject({ kind: 'estimate', source: 'live' })
  })
})

describe('honest refusals', () => {
  it('is unknown without a calibration summary', () => {
    expect(estimateFit(4, null).kind).toBe('unknown')
    expect(estimateFit(4, undefined).kind).toBe('unknown')
  })

  it('is unknown when calibration is marked unavailable', () => {
    expect(estimateFit(4, cal(7.5e-3, 'unavailable')).kind).toBe('unknown')
  })

  it('is unknown without a 2Q error rate or with a garbage one', () => {
    expect(estimateFit(4, cal(null)).kind).toBe('unknown')
    expect(estimateFit(4, cal(Number.NaN)).kind).toBe('unknown')
    expect(estimateFit(4, cal(-0.1)).kind).toBe('unknown')
  })

  it('is unknown for a nonsensical depth', () => {
    expect(estimateFit(Number.NaN, cal(7.5e-3)).kind).toBe('unknown')
    expect(estimateFit(-1, cal(7.5e-3)).kind).toBe('unknown')
  })
})

describe('circuitStats', () => {
  it('layers a Bell circuit to depth 2 with one 2Q gate', () => {
    const stats = circuitStats({
      numQubits: 2,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'CX', qubits: [0, 1] },
        { name: 'MEASURE', qubits: [0] },
        { name: 'MEASURE', qubits: [1] },
      ],
    })
    expect(stats).toEqual({ depth: 2, twoQubitGates: 1 })
  })

  it('packs independent single-qubit gates into one layer', () => {
    const stats = circuitStats({
      numQubits: 3,
      ops: [
        { name: 'H', qubits: [0] },
        { name: 'H', qubits: [1] },
        { name: 'H', qubits: [2] },
        { name: 'BARRIER', qubits: [0, 1, 2] },
      ],
    })
    expect(stats).toEqual({ depth: 1, twoQubitGates: 0 })
  })

  it('reports an empty circuit as depth 0', () => {
    expect(circuitStats({ numQubits: 2, ops: [] })).toEqual({ depth: 0, twoQubitGates: 0 })
  })
})
