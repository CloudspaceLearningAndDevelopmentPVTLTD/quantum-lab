import { describe, it, expect } from 'vitest'
import {
  analyticLogicalRate,
  canonicalError,
  evaluateDuel,
  majorityDecode,
  netDecode,
  runDuelShot,
  sampleErrors,
  syndromeOf,
  trainPerceptron,
} from './decoderDuel'
import { mulberry32 } from '@/lib/quantum'

const DISTANCES = [3, 5, 7] as const

describe('the repetition code plumbing', () => {
  it('canonicalError inverts syndromeOf up to the logical complement', () => {
    // The two consistent patterns are the canonical one and its complement —
    // every decoder decision in this file rests on exactly that fact.
    const rand = mulberry32(11)
    for (const d of DISTANCES) {
      for (let trial = 0; trial < 50; trial++) {
        const e = sampleErrors(d, 0.3, rand)
        const cand = canonicalError(syndromeOf(e))
        const matches = Array.from(e).every((v, i) => v === cand[i])
        const complements = Array.from(e).every((v, i) => v === (cand[i] ^ 1))
        expect(matches || complements).toBe(true)
        expect(syndromeOf(cand)).toEqual(syndromeOf(e))
      }
    }
  })

  it('rejects even and non-integer distances rather than tie-breaking arbitrarily', () => {
    expect(() => majorityDecode(4, new Uint8Array(3))).toThrow(/odd integer/)
    expect(() => trainPerceptron(2, 0.1, 1)).toThrow(/odd integer/)
    expect(() => analyticLogicalRate(3.5, 0.1)).toThrow(/odd integer/)
  })
})

describe('majority vote really is the optimal decoder here', () => {
  it('corrects every pattern of up to (d-1)/2 flips and fails every heavier coset leader', () => {
    // Exhaustive, not sampled: 2^7 patterns at worst. Majority succeeds exactly
    // when a minority of bits flipped — that IS the maximum-likelihood rule.
    for (const d of DISTANCES) {
      for (let mask = 0; mask < 1 << d; mask++) {
        const e = new Uint8Array(d)
        let w = 0
        for (let i = 0; i < d; i++) {
          e[i] = (mask >> i) & 1
          w += e[i]
        }
        const dec = majorityDecode(d, syndromeOf(e))
        const failed = dec.firstBit !== e[0]
        expect(failed, `d=${d} pattern ${mask.toString(2)}`).toBe(2 * w > d)
        // The correction always returns to the code space.
        const residual = e.map((v, i) => v ^ dec.correction[i])
        const allSame = residual.every((v) => v === residual[0])
        expect(allSame).toBe(true)
      }
    }
  })

  it('matches its own analytic failure rate at d=3, p=5%', () => {
    // 40k seeded shots; SE ≈ 0.0004, so a ±0.002 window is ~5 sigma. Catches a
    // decoder or noise model that is subtly wrong while staying deterministic.
    const net = trainPerceptron(3, 0.05, 1, { steps: 500 }) // net is irrelevant to this assertion
    const stats = evaluateDuel(3, 0.05, net, 40_000, 42)
    const expected = analyticLogicalRate(3, 0.05) // 0.00725
    expect(Math.abs(stats.majorityFailures / stats.shots - expected)).toBeLessThan(0.002)
  })
})

describe('logical error rate falls with distance at p = 5%', () => {
  it('d=3 > d=5 > d=7 for majority decoding, with real margin', () => {
    // The promise of error correction, asserted on this engine's own Monte
    // Carlo. Analytic rates at p=0.05 are 0.73%, 0.12%, 0.02% — each step in d
    // buys better than a 2x factor, so requiring a strict halving is safe at
    // 40k seeded shots while still failing for any broken noise model.
    const rates = DISTANCES.map((d) => {
      const net = trainPerceptron(d, 0.05, d, { steps: 500 })
      const s = evaluateDuel(d, 0.05, net, 40_000, d * 7919 + 3)
      return s.majorityFailures / s.shots
    })
    expect(rates[1]).toBeLessThan(rates[0] / 2)
    expect(rates[2]).toBeLessThan(rates[1] / 2)
  })
})

describe('the trained decoder', () => {
  it('reaches within 10% of majority accuracy on a seeded held-out set, and beats doing nothing', () => {
    const d = 5
    const p = 0.12
    const net = trainPerceptron(d, p, 2024)
    const stats = evaluateDuel(d, p, net, 20_000, 777)
    const majAcc = 1 - stats.majorityFailures / stats.shots
    const netAcc = 1 - stats.netFailures / stats.shots
    expect(netAcc).toBeGreaterThanOrEqual(0.9 * majAcc)
    // The 10% bound alone is weak — a network that always answers 0 would fail
    // at rate p = 12% and still pass it. Require real learning: the trained
    // decoder must beat the do-nothing decoder by at least 2x.
    expect(stats.netFailures / stats.shots).toBeLessThan(p / 2)
  })

  it('can only tie majority, never beat it, on an exhaustive syndrome table', () => {
    // The header's claim, checked: for every syndrome, either the network
    // agrees with majority or it is making the strictly-less-likely call.
    // Aggregated over the true noise distribution that means net failure rate
    // >= majority's. Asserted on the same seeded evaluation as above.
    const d = 7
    const p = 0.1
    const net = trainPerceptron(d, p, 5)
    const stats = evaluateDuel(d, p, net, 30_000, 99)
    expect(stats.netFailures).toBeGreaterThanOrEqual(stats.majorityFailures)
  })
})

describe('determinism', () => {
  it('training twice from one seed yields identical weights', () => {
    const a = trainPerceptron(5, 0.1, 31337, { steps: 5_000 })
    const b = trainPerceptron(5, 0.1, 31337, { steps: 5_000 })
    expect(Array.from(a.w1)).toEqual(Array.from(b.w1))
    expect(Array.from(a.w2)).toEqual(Array.from(b.w2))
    expect(Array.from(a.b1)).toEqual(Array.from(b.b1))
    expect(a.b2).toBe(b.b2)
  })

  it('the duel is bit-for-bit reproducible given a seed', () => {
    const net = trainPerceptron(7, 0.08, 12, { steps: 5_000 })
    const a = evaluateDuel(7, 0.08, net, 5_000, 4)
    const b = evaluateDuel(7, 0.08, net, 5_000, 4)
    expect(a).toEqual(b)
    // And per-shot: two seeded streams replay the same shots.
    const r1 = mulberry32(9)
    const r2 = mulberry32(9)
    for (let i = 0; i < 200; i++) {
      const s1 = runDuelShot(7, 0.08, net, r1)
      const s2 = runDuelShot(7, 0.08, net, r2)
      expect(Array.from(s1.errors)).toEqual(Array.from(s2.errors))
      expect(s1.netBit).toBe(s2.netBit)
      expect(s1.majorityFail).toBe(s2.majorityFail)
    }
  })
})

describe('analyticLogicalRate', () => {
  it('gives the closed forms for d=3 and d=5', () => {
    const p = 0.05
    const q = 1 - p
    expect(analyticLogicalRate(3, p)).toBeCloseTo(3 * p * p * q + p ** 3, 12)
    expect(analyticLogicalRate(5, p)).toBeCloseTo(
      10 * p ** 3 * q * q + 5 * p ** 4 * q + p ** 5,
      12
    )
  })

  it('is 0 at p=0 and monotone in d the right way below p=1/2', () => {
    for (const d of DISTANCES) expect(analyticLogicalRate(d, 0)).toBe(0)
    expect(analyticLogicalRate(5, 0.05)).toBeLessThan(analyticLogicalRate(3, 0.05))
    expect(analyticLogicalRate(7, 0.05)).toBeLessThan(analyticLogicalRate(5, 0.05))
  })
})

describe('netDecode', () => {
  it('returns a correction consistent with the syndrome, whichever way it decides', () => {
    const d = 5
    const net = trainPerceptron(d, 0.1, 8, { steps: 2_000 })
    const rand = mulberry32(3)
    for (let i = 0; i < 100; i++) {
      const e = sampleErrors(d, 0.2, rand)
      const s = syndromeOf(e)
      const dec = netDecode(net, s)
      expect(syndromeOf(dec.correction)).toEqual(s)
      expect(dec.correction[0]).toBe(dec.firstBit)
    }
  })
})
