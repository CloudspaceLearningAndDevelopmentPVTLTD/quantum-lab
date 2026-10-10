import { describe, expect, it } from 'vitest'
import { StateVector } from '@/lib/quantum'
import {
  MAX_COUNTING_QUBITS,
  MIN_COUNTING_QUBITS,
  analyticDistribution,
  analyticProbability,
  applyInverseQft,
  applyQft,
  binaryFraction,
  circleDistance,
  confidenceOverhead,
  countingProbabilities,
  kickbackAngle,
  probabilityWithin,
  qpeEstimate,
  qpeFinalState,
  qpeStages,
  qubitsForPrecision,
} from './phaseEstimation'

/**
 * The page claims the counting register ends up holding φ in binary, that the
 * number of qubits buys precision while a handful more buy confidence, and that
 * the peak is never perfectly sharp unless 2^t φ is an integer. The checks below
 * come from outside the simulator:
 *
 *  - the closed form P(y) = sin²(πε)/(4^t sin²(πε/2^t)), summed from the
 *    geometric series rather than read off the circuit;
 *  - the textbook 4/π² and 8/π² success bounds;
 *  - the t = n + ⌈log₂(2 + 1/2ε)⌉ rule, verified by summing the distribution
 *    over the outcomes that actually meet the precision target;
 *  - the kickback amplitudes e^{2πiφy}/√N, written down from the eigenvalue
 *    relation U|1⟩ = e^{2πiφ}|1⟩ and compared against the gates that ran.
 */

const TWO_PI = Math.PI * 2
/** The classic QPE bounds (Nielsen & Chuang §5.2.1). */
const NEAREST_BOUND = 4 / Math.PI ** 2 // ≈ 0.4053
const BRACKET_BOUND = 8 / Math.PI ** 2 // ≈ 0.8106

/** A spread of phases: exact binary fractions, thirds, and irrational-ish ones. */
const SAMPLE_PHASES = [
  0, 0.125, 0.25, 0.5, 0.75, 0.875, 1 / 3, 2 / 3, 0.1, 0.2, 0.61803398875, 0.9, 0.987654321,
  0.031415926, 0.4999999,
]

describe('the inverse QFT is the exact inverse of the forward one', () => {
  it('round-trips every basis state back to itself', () => {
    for (let t = 1; t <= 5; t++) {
      for (let x = 0; x < 1 << t; x++) {
        const sv = new StateVector(t)
        for (let q = 0; q < t; q++) if ((x >> q) & 1) sv.applySingle('X', q)
        applyQft(sv, t)
        applyInverseQft(sv, t)
        expect(sv.probability(x)).toBeCloseTo(1, 10)
      }
    }
  })

  it('turns the phase ramp e^{2πixy/N} straight back into |x⟩', () => {
    // Build the ramp by hand from the definition, not with applyQft, so this is a
    // statement about the inverse transform rather than about a round trip.
    for (let t = 2; t <= 5; t++) {
      const dim = 1 << t
      for (let x = 0; x < dim; x++) {
        const amps = Array.from({ length: dim }, (_, y) => ({
          re: Math.cos((TWO_PI * x * y) / dim) / Math.sqrt(dim),
          im: Math.sin((TWO_PI * x * y) / dim) / Math.sqrt(dim),
        }))
        const sv = StateVector.fromAmplitudes(amps)
        applyInverseQft(sv, t)
        expect(sv.probability(x)).toBeCloseTo(1, 10)
      }
    }
  })
})

describe('the controlled-U powers write the phase, and nothing else', () => {
  it('leaves the eigenstate register in |1⟩ throughout', () => {
    for (const phi of [0.3, 1 / 3, 0.75]) {
      for (const stage of qpeStages(4, phi)) {
        // Stage 'init' is measured after the X, so the eigenstate qubit is |1⟩
        // from the first stage onward.
        expect(stage.state.qubitProbability(4)).toBeCloseTo(1, 12)
      }
    }
  })

  it('produces exactly (1/√N)·e^{2πiφy}|y⟩|1⟩ before the inverse QFT', () => {
    for (const t of [2, 4, 6]) {
      const dim = 1 << t
      for (const phi of [0.125, 1 / 3, 0.61803398875]) {
        const stages = qpeStages(t, phi)
        const last = stages.filter((s) => s.id === 'kickback').pop()!
        for (let y = 0; y < dim; y++) {
          const a = last.state.amplitude(y + dim) // eigenstate qubit is |1⟩
          expect(a.re).toBeCloseTo(Math.cos(TWO_PI * phi * y) / Math.sqrt(dim), 10)
          expect(a.im).toBeCloseTo(Math.sin(TWO_PI * phi * y) / Math.sqrt(dim), 10)
          // Nothing leaks into the |0⟩ branch of the eigenstate register.
          expect(last.state.probability(y)).toBeLessThan(1e-20)
        }
      }
    }
  })

  it('never changes the magnitudes — all the information is in the phases', () => {
    const t = 4
    for (const stage of qpeStages(t, 0.4)) {
      // 'init' is before the Hadamard layer and 'iqft' is after the readout;
      // between them the magnitudes must not move at all.
      if (stage.id === 'init' || stage.id === 'iqft') continue
      for (const p of countingProbabilities(stage.state, t)) {
        expect(p).toBeCloseTo(1 / (1 << t), 12)
      }
    }
  })

  it('kickbackAngle is the phase the state actually carries on qubit j', () => {
    const t = 5
    const phi = 0.3
    const stages = qpeStages(t, phi).filter((s) => s.id === 'kickback')
    for (let j = 0; j < t; j++) {
      const dim = 1 << t
      const state = stages[j].state
      const a0 = state.amplitude(0 + dim)
      const a1 = state.amplitude((1 << j) + dim)
      const measured = Math.atan2(a1.im, a1.re) - Math.atan2(a0.im, a0.re)
      const wrapped = ((measured % TWO_PI) + TWO_PI) % TWO_PI
      expect(circleDistance(wrapped / TWO_PI, kickbackAngle(phi, j) / TWO_PI)).toBeLessThan(1e-9)
    }
  })
})

describe('the output distribution matches the closed form', () => {
  it('simulated probabilities equal sin²(πε)/(4^t·sin²(πε/2^t)) for every outcome', () => {
    for (const t of [2, 3, 5, 7]) {
      for (const phi of SAMPLE_PHASES) {
        const probs = countingProbabilities(qpeFinalState(t, phi), t)
        for (let y = 0; y < 1 << t; y++) {
          expect(probs[y]).toBeCloseTo(analyticProbability(t, phi, y), 9)
        }
      }
    }
  })

  it('the closed form is a probability distribution', () => {
    for (const t of [1, 3, 6]) {
      for (const phi of SAMPLE_PHASES) {
        const total = analyticDistribution(t, phi).reduce((a, b) => a + b, 0)
        expect(total).toBeCloseTo(1, 9)
      }
    }
  })

  it('is exact when 2^t·φ is an integer, and only then', () => {
    for (const t of [2, 3, 4, 6]) {
      const dim = 1 << t
      for (let k = 0; k < dim; k++) {
        const est = qpeEstimate(t, k / dim)
        expect(est.exact).toBe(true)
        expect(est.y).toBe(k)
        expect(est.probability).toBeCloseTo(1, 10)
        expect(est.error).toBeCloseTo(0, 12)
        // And the real circuit agrees.
        const probs = countingProbabilities(qpeFinalState(t, k / dim), t)
        expect(probs[k]).toBeCloseTo(1, 9)
      }
      // Half a bin off the grid is the worst case, and it is never certain.
      expect(qpeEstimate(t, 0.5 / dim).probability).toBeLessThan(0.5)
      expect(qpeEstimate(t, 0.5 / dim).exact).toBe(false)
    }
  })
})

describe('the textbook success bounds hold', () => {
  it('the nearest outcome is measured with probability at least 4/π²', () => {
    for (const t of [2, 3, 5, 8]) {
      const dim = 1 << t
      for (let i = 0; i <= 60; i++) {
        const phi = i / 61 // deliberately off the 2^t grid
        const nearest = Math.round(phi * dim) % dim
        expect(analyticProbability(t, phi, nearest)).toBeGreaterThanOrEqual(NEAREST_BOUND - 1e-12)
      }
    }
  })

  it('the two outcomes bracketing 2^t·φ collect at least 8/π² between them', () => {
    for (const t of [2, 3, 5, 8]) {
      const dim = 1 << t
      for (let i = 0; i <= 60; i++) {
        const phi = i / 61
        expect(qpeEstimate(t, phi).bracketProbability).toBeGreaterThanOrEqual(BRACKET_BOUND - 1e-12)
      }
    }
  })

  it('the bound is tight: the worst case sits just above 4/π² and approaches it', () => {
    // The worst case is exactly half a bin off the grid.
    const worst = (t: number) => analyticProbability(t, 0.5 / (1 << t), 0)
    expect(worst(2)).toBeGreaterThan(NEAREST_BOUND)
    expect(worst(10)).toBeGreaterThan(NEAREST_BOUND)
    expect(worst(10)).toBeLessThan(worst(2))
    expect(worst(10)).toBeCloseTo(NEAREST_BOUND, 5)
  })
})

describe('precision versus qubit count', () => {
  it('one more qubit halves the resolution of the readout', () => {
    for (let t = 2; t <= 9; t++) {
      const resolution = 1 / 2 ** t
      // The grid the answer is snapped to.
      expect(qpeEstimate(t, 0.5 * resolution).phi).toBeCloseTo(0, 12)
      expect(1 / 2 ** (t + 1)).toBeCloseTo(resolution / 2, 15)
    }
  })

  it('t = bits + ⌈log₂(2 + 1/2ε)⌉ really does deliver that accuracy at that confidence', () => {
    for (const bits of [2, 3, 4]) {
      for (const epsilon of [0.5, 0.25, 0.1, 0.05, 0.01]) {
        const t = qubitsForPrecision(bits, epsilon)
        expect(t).toBeLessThanOrEqual(20)
        for (let i = 0; i <= 40; i++) {
          const phi = i / 41
          const p = probabilityWithin(t, phi, 2 ** -bits)
          expect(p).toBeGreaterThanOrEqual(1 - epsilon)
        }
      }
    }
  })

  it('the confidence term is the same regardless of how many bits you want', () => {
    for (const epsilon of [0.5, 0.1, 0.01]) {
      const overhead = confidenceOverhead(epsilon)
      for (const bits of [1, 5, 12]) {
        expect(qubitsForPrecision(bits, epsilon) - bits).toBe(overhead)
      }
    }
    // Ten times the confidence is worth about 3.3 more qubits, not ten times as many.
    expect(confidenceOverhead(0.5)).toBe(2)
    expect(confidenceOverhead(0.01)).toBe(6)
    expect(confidenceOverhead(0.001)).toBe(9)
  })

  it('rejects nonsense precision requests instead of returning a plausible number', () => {
    expect(() => qubitsForPrecision(0, 0.1)).toThrow()
    expect(() => qubitsForPrecision(3, 0)).toThrow()
    expect(() => qubitsForPrecision(3, 1)).toThrow()
  })
})

describe('every configuration the page can be put into', () => {
  // The controls span t = 2..MAX crossed with four preset phases and a
  // hand-dragged φ. Each one builds t + 3 cloned statevectors; if the largest
  // combination were slow or threw, the page would stall on a slider drag.
  const PAGE_PHASES = [0.25, 11 / 16, 1 / 3, 0.6180339887498949, 0, 0.999]

  it('builds every stage and lands on a sane estimate', () => {
    for (let t = MIN_COUNTING_QUBITS; t <= MAX_COUNTING_QUBITS; t++) {
      for (const phi of PAGE_PHASES) {
        const stages = qpeStages(t, phi)
        expect(stages).toHaveLength(t + 3)
        const probs = countingProbabilities(stages[stages.length - 1].state, t)
        expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
        const est = qpeEstimate(t, phi)
        // The estimate is always within one bin of the truth, by construction.
        expect(est.error).toBeLessThanOrEqual(1 / 2 ** t + 1e-12)
        expect(est.probability).toBeGreaterThanOrEqual(NEAREST_BOUND - 1e-12)
      }
    }
  })
})

describe('helpers', () => {
  it('circleDistance wraps: 0.99 and 0.01 are 0.02 apart', () => {
    expect(circleDistance(0.99, 0.01)).toBeCloseTo(0.02, 12)
    expect(circleDistance(0.1, 0.6)).toBeCloseTo(0.5, 12)
    expect(circleDistance(0.4, 0.4)).toBe(0)
  })

  it('only the fractional part of φ is observable', () => {
    const a = countingProbabilities(qpeFinalState(4, 0.3), 4)
    const b = countingProbabilities(qpeFinalState(4, 7.3), 4)
    for (let y = 0; y < 16; y++) expect(a[y]).toBeCloseTo(b[y], 10)
  })

  it('binaryFraction prints the measured integer as a binary fraction', () => {
    expect(binaryFraction(5, 3)).toBe('0.101')
    expect(binaryFraction(1, 4)).toBe('0.0001')
    expect(parseInt('101', 2) / 8).toBe(0.625)
  })

  it('stage ids and count line up with the circuit', () => {
    const t = 3
    const stages = qpeStages(t, 0.2)
    expect(stages.map((s) => s.id)).toEqual([
      'init',
      'superpose',
      'kickback',
      'kickback',
      'kickback',
      'iqft',
    ])
    expect(stages.filter((s) => s.id === 'kickback').map((s) => s.power)).toEqual([0, 1, 2])
  })
})
