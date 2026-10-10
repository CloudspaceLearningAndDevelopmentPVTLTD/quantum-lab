import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/lib/quantum'
import {
  evaluateCost,
  fitDecay,
  gradient,
  gradientVariance,
  randomCircuit,
  summariseGradients,
  type PlateauCost,
} from './barrenPlateau'

describe('gradient', () => {
  it('matches a central finite difference for every cost', () => {
    const rng = mulberry32(3)
    for (const cost of ['zz', 'global', 'local'] as PlateauCost[]) {
      for (let trial = 0; trial < 5; trial++) {
        const circuit = randomCircuit(4, 3, rng)
        const eps = 1e-5
        const numeric = (evaluateCost(circuit, cost, eps) - evaluateCost(circuit, cost, -eps)) / (2 * eps)
        expect(gradient(circuit, cost)).toBeCloseTo(numeric, 6)
      }
    }
  })

  it('costs stay in their ranges', () => {
    const rng = mulberry32(4)
    for (let trial = 0; trial < 20; trial++) {
      const circuit = randomCircuit(5, 4, rng)
      expect(Math.abs(evaluateCost(circuit, 'zz'))).toBeLessThanOrEqual(1 + 1e-12)
      for (const cost of ['global', 'local'] as PlateauCost[]) {
        const v = evaluateCost(circuit, cost)
        expect(v).toBeGreaterThanOrEqual(-1e-12)
        expect(v).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })

  it('rejects sizes the statevector cannot hold comfortably', () => {
    expect(() => randomCircuit(1, 3, Math.random)).toThrow()
    expect(() => randomCircuit(15, 3, Math.random)).toThrow()
    expect(() => randomCircuit(4, 0, Math.random)).toThrow()
  })
})

describe('the plateau', () => {
  it('a deep circuit loses gradient variance exponentially in n', () => {
    const rng = mulberry32(8)
    const points = [2, 4, 6, 8].map((n) => gradientVariance(n, 6 * n, 'zz', 80, rng))
    expect(points[0].variance / points[3].variance).toBeGreaterThan(8)
    const fit = fitDecay(points)!
    expect(fit.slopePerQubit).toBeLessThan(-0.5)
  })

  it('at shallow depth the global cost flattens much faster than the local one', () => {
    const rng = mulberry32(21)
    const globalFit = fitDecay([2, 4, 6, 8].map((n) => gradientVariance(n, 2, 'global', 150, rng)))!
    const localFit = fitDecay([2, 4, 6, 8].map((n) => gradientVariance(n, 2, 'local', 150, rng)))!
    expect(globalFit.slopePerQubit).toBeLessThan(localFit.slopePerQubit - 0.3)
  })

  it('is reproducible from its seed', () => {
    const a = gradientVariance(4, 5, 'zz', 20, mulberry32(1))
    const b = gradientVariance(4, 5, 'zz', 20, mulberry32(1))
    expect(a).toEqual(b)
  })
})

describe('summaries', () => {
  it('summariseGradients computes an unbiased sample variance', () => {
    const p = summariseGradients(2, 1, [1, -1, 1, -1])
    expect(p.variance).toBeCloseTo(4 / 3, 12)
    expect(p.stderr).toBe(0)
    expect(summariseGradients(2, 1, [0.3]).variance).toBe(0)
  })

  it('fitDecay recovers an exact exponential and refuses too little data', () => {
    const points = [2, 4, 6].map((n) => ({ n, layers: 1, samples: 10, variance: 2 ** (-1.5 * n), stderr: 0 }))
    const fit = fitDecay(points)!
    expect(fit.slopePerQubit).toBeCloseTo(-1.5, 9)
    expect(fit.intercept).toBeCloseTo(0, 9)
    expect(fitDecay(points.slice(0, 1))).toBeNull()
  })
})
