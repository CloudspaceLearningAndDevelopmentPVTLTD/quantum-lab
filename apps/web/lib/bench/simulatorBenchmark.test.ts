import { describe, it, expect } from 'vitest'
import { correctnessSuite, performanceSuite } from './simulatorBenchmark'

describe('correctnessSuite', () => {
  const results = correctnessSuite()

  it('runs every known-answer circuit', () => {
    expect(results.length).toBeGreaterThanOrEqual(5)
  })

  it('passes every case', () => {
    for (const r of results) {
      // A failure here is a real bug — either in the simulator engine or in
      // this suite's own hand-derived target amplitudes — not something to
      // paper over by loosening the threshold.
      expect(r.passed, `${r.name}: maxDeviation=${r.maxDeviation}`).toBe(true)
    }
  })

  it('reports genuinely tiny deviations (floating-point noise, not approximation)', () => {
    for (const r of results) {
      expect(r.maxDeviation, r.name).toBeLessThan(1e-9)
      expect(r.maxDeviation, r.name).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('performanceSuite', () => {
  // Kept small so the test suite stays fast; the page invokes the full range.
  const results = performanceSuite(10)

  it('returns one entry per qubit count from 4 to maxQubits', () => {
    expect(results).toHaveLength(7) // 4,5,6,7,8,9,10
    expect(results.map((r) => r.qubits)).toEqual([4, 5, 6, 7, 8, 9, 10])
  })

  it('reports plausible, non-fabricated timing for every entry', () => {
    for (const r of results) {
      expect(r.ms).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(r.ms)).toBe(true)
      expect(r.gatesPerSecond).toBeGreaterThan(0)
      expect(Number.isFinite(r.gatesPerSecond)).toBe(true)
      expect(r.gates).toBeGreaterThan(0)
    }
  })

  it('gate count grows with qubit count, as the stated fixed density implies', () => {
    for (let i = 1; i < results.length; i++) {
      expect(results[i].gates).toBeGreaterThan(results[i - 1].gates)
    }
  })
})
