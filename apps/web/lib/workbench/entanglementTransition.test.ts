import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import { sampleHybridCircuit, summarise, transitionPoint } from './entanglementTransition'

describe('sampleHybridCircuit', () => {
  it('with no measurements reaches a near-maximal volume law', () => {
    const rng = mulberry32(1)
    for (const L of [8, 16, 24]) {
      const { halfChainEntropy, measurements } = sampleHybridCircuit(L, 0, rng)
      expect(measurements).toBe(0)
      // A random stabilizer state falls short of L/2 by O(1) bits.
      expect(halfChainEntropy).toBeGreaterThanOrEqual(L / 2 - 2)
      expect(halfChainEntropy).toBeLessThanOrEqual(L / 2)
    }
  })

  it('with every qubit measured every layer ends in a product state', () => {
    const { halfChainEntropy, measurements } = sampleHybridCircuit(12, 1, mulberry32(2))
    expect(halfChainEntropy).toBe(0)
    expect(measurements).toBe(12 * 24)
  })

  it('is reproducible from its seed', () => {
    const a = sampleHybridCircuit(16, 0.1, mulberry32(9))
    const b = sampleHybridCircuit(16, 0.1, mulberry32(9))
    expect(a).toEqual(b)
  })

  it('rejects nonsense inputs', () => {
    expect(() => sampleHybridCircuit(1, 0.1, Math.random)).toThrow()
    expect(() => sampleHybridCircuit(8, 1.2, Math.random)).toThrow()
  })
})

describe('the transition itself', () => {
  it('entropy grows with L well below p_c and does not well above it', () => {
    const rng = mulberry32(42)
    const low8 = transitionPoint(8, 0.04, 40, rng)
    const low24 = transitionPoint(24, 0.04, 40, rng)
    const high8 = transitionPoint(8, 0.4, 40, rng)
    const high24 = transitionPoint(24, 0.4, 40, rng)
    expect(low24.mean - low8.mean).toBeGreaterThan(2)
    expect(Math.abs(high24.mean - high8.mean)).toBeLessThan(0.5)
    expect(high24.mean).toBeLessThan(1.5)
  })
})

describe('summarise', () => {
  it('computes a mean and its standard error', () => {
    const point = summarise(8, 0.1, [1, 2, 3, 4])
    expect(point.mean).toBe(2.5)
    expect(point.stderr).toBeCloseTo(Math.sqrt(5 / 3 / 4), 12)
    expect(summarise(8, 0.1, [3]).stderr).toBe(0)
  })
})
