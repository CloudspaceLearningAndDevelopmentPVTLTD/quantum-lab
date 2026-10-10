import { describe, expect, it } from 'vitest'
import {
  CLASSICAL_BOUND,
  OPTIMAL_SETTINGS,
  SETTING_PAIRS,
  TSIRELSON_BOUND,
  advanceRun,
  analyzerCorrelation,
  anglesFor,
  chshFromCorrelators,
  chshWitness,
  createRun,
  lhvCorrelation,
  lhvOutcome,
  lhvS,
  quantumS,
  runChsh,
  sampleLambda,
  sampleQuantumPair,
  singletCorrelation,
  summarize,
  type ChshSettings,
  type LhvStrategy,
} from './chsh'
import { mulberry32 } from '@/lib/quantum'

/**
 * The claim this page makes is that a number classical physics cannot reach is
 * reached anyway. That claim is only worth making if these hold, so each test
 * below checks the code against something derived OUTSIDE it — a closed-form
 * cosine, Tsirelson's 2√2, Bell's ±2 — never against another call of the same
 * function.
 */

const STRATEGIES: LhvStrategy[] = ['naive', 'conspiracy']

const settingsFrom = (rand: () => number): ChshSettings => ({
  a: rand() * 360 - 180,
  aPrime: rand() * 360 - 180,
  b: rand() * 360 - 180,
  bPrime: rand() * 360 - 180,
})

describe('the singlet correlation', () => {
  it('is exactly −cos(a − b) at the textbook angles', () => {
    // Aligned detectors on a singlet always disagree; opposed always agree.
    expect(singletCorrelation(0, 0)).toBeCloseTo(-1, 12)
    expect(singletCorrelation(0, Math.PI)).toBeCloseTo(1, 12)
    // Orthogonal directions carry no correlation at all.
    expect(singletCorrelation(0, Math.PI / 2)).toBeCloseTo(0, 12)
    expect(singletCorrelation(Math.PI / 3, Math.PI / 3 + Math.PI / 4)).toBeCloseTo(
      -Math.SQRT1_2,
      12
    )
  })

  it('depends only on the difference of the two angles', () => {
    const rand = mulberry32(11)
    for (let i = 0; i < 200; i++) {
      const a = rand() * 20 - 10
      const b = rand() * 20 - 10
      const shift = rand() * 20 - 10
      expect(singletCorrelation(a + shift, b + shift)).toBeCloseTo(singletCorrelation(a, b), 12)
    }
  })

  it('analyzer angles act at double angle, so 45° of polarizer is orthogonality', () => {
    // A polarizer turned 45° away gives no correlation — the Poincaré vector has
    // moved 90°. Turned 90° it flips the sign. This factor of two is why the
    // optimal settings are 22.5° apart.
    expect(analyzerCorrelation(0, 0)).toBeCloseTo(-1, 12)
    expect(analyzerCorrelation(0, 45)).toBeCloseTo(0, 12)
    expect(analyzerCorrelation(0, 90)).toBeCloseTo(1, 12)
    expect(analyzerCorrelation(0, 22.5)).toBeCloseTo(-Math.SQRT1_2, 12)
  })
})

describe('the quantum CHSH value', () => {
  it('is exactly 2√2 at the optimal 0 / 45 / 22.5 / 67.5 settings', () => {
    expect(Math.abs(quantumS(OPTIMAL_SETTINGS))).toBeCloseTo(TSIRELSON_BOUND, 12)
    expect(TSIRELSON_BOUND).toBeCloseTo(2.8284271247461903, 12)
  })

  it('never exceeds Tsirelson’s bound, for any settings whatsoever', () => {
    const rand = mulberry32(7)
    let best = 0
    for (let i = 0; i < 20000; i++) {
      const s = Math.abs(quantumS(settingsFrom(rand)))
      expect(s).toBeLessThanOrEqual(TSIRELSON_BOUND + 1e-12)
      best = Math.max(best, s)
    }
    // 20k random draws should get close to the maximum; if this ever fails the
    // search space, not the bound, is what changed.
    expect(best).toBeGreaterThan(2.7)
  })

  it('collapses to zero when Alice’s two settings coincide with Bob’s', () => {
    // S = E(a,b) − E(a,b′) + E(a,b) + E(a,b′) → 2E(a,b) when a′ = a, which is
    // bounded by 2: identical settings buy Alice nothing.
    const flat = { a: 30, aPrime: 30, b: 12, bPrime: 77 }
    expect(Math.abs(quantumS(flat))).toBeLessThanOrEqual(CLASSICAL_BOUND + 1e-12)
  })
})

describe('local hidden variables cannot pass 2', () => {
  it('the per-pair CHSH witness is exactly ±2 for every λ', () => {
    // This is Bell's argument, checked directly: one of the two brackets in
    // A(b − b′) + A′(b + b′) is always zero. Nothing in the code clamps S — the
    // bound falls out of ±1 outcomes and arithmetic.
    const rand = mulberry32(2024)
    for (const strategy of STRATEGIES) {
      for (let i = 0; i < 5000; i++) {
        const w = chshWitness(strategy, settingsFrom(rand), sampleLambda(rand))
        expect(Math.abs(w)).toBe(2)
      }
    }
  })

  it('the exact expected S stays inside ±2 over a dense sweep of settings', () => {
    for (const strategy of STRATEGIES) {
      let best = 0
      // Alice's grid is coarser than Bob's only to keep the sweep quick; both
      // include the optimal settings exactly (0, 45 on Alice; 22.5, 67.5 on Bob),
      // so `best` below is the true maximum and not a near miss.
      for (let a = 0; a < 180; a += 15) {
        for (let aP = 0; aP < 180; aP += 15) {
          for (let b = 0; b < 180; b += 7.5) {
            for (let bP = 0; bP < 180; bP += 7.5) {
              const s = Math.abs(lhvS(strategy, { a, aPrime: aP, b, bPrime: bP }))
              expect(s).toBeLessThanOrEqual(CLASSICAL_BOUND + 1e-9)
              best = Math.max(best, s)
            }
          }
        }
      }
      // The naive model is not merely bounded, it is far from the bound: half the
      // quantum correlation means half of 2√2. The conspiracy model saturates.
      if (strategy === 'naive') expect(best).toBeCloseTo(Math.SQRT2, 9)
      else expect(best).toBeCloseTo(CLASSICAL_BOUND, 9)
    }
  })

  it('a seeded simulated run never has its counterfactual audit exceed 2', () => {
    const rand = mulberry32(99)
    for (const strategy of STRATEGIES) {
      for (let seed = 0; seed < 40; seed++) {
        const settings = settingsFrom(rand)
        const run = createRun(strategy, settings, 500)
        advanceRun(run, mulberry32(seed * 7919 + 13), 3000)
        expect(Math.abs(run.witnessSum / run.trials)).toBeLessThanOrEqual(CLASSICAL_BOUND)
        expect(run.witnessMaxAbs).toBe(CLASSICAL_BOUND)
      }
    }
  })

  it('the quantum run beats every classical run at the optimal settings', () => {
    for (const strategy of STRATEGIES) {
      const { quantum, classical } = runChsh(strategy, OPTIMAL_SETTINGS, 200_000, 4242)
      // Quantum lands on 2√2 within a few standard errors and is clearly past 2.
      expect(quantum.sAbs).toBeGreaterThan(CLASSICAL_BOUND + 0.5)
      expect(Math.abs(quantum.sAbs - TSIRELSON_BOUND)).toBeLessThan(5 * quantum.se)
      // Classical lands on its own analytic ceiling, and never meaningfully past 2.
      const expected = Math.abs(lhvS(strategy, OPTIMAL_SETTINGS))
      expect(Math.abs(classical.sAbs - expected)).toBeLessThan(5 * classical.se)
      expect(classical.sAbs).toBeLessThan(CLASSICAL_BOUND + 5 * classical.se)
      if (strategy === 'naive') expect(classical.sAbs).toBeLessThan(1.6)
    }
  })
})

describe('the samplers reproduce their own analytic correlators', () => {
  it('quantum pairs converge on −cos(2Δ)', () => {
    const rand = mulberry32(31337)
    for (const [alpha, beta] of [
      [0, 0],
      [0, 22.5],
      [0, 45],
      [0, 90],
      [13, 71],
    ] as const) {
      const n = 200_000
      let sum = 0
      for (let i = 0; i < n; i++) {
        const [a, b] = sampleQuantumPair(alpha, beta, rand)
        sum += a * b
      }
      // Compared against the closed form, not against another sampler call.
      expect(sum / n).toBeCloseTo(-Math.cos(2 * (alpha - beta) * (Math.PI / 180)), 2)
    }
  })

  it('quantum marginals are fair on both sides — no signalling', () => {
    const rand = mulberry32(808)
    const n = 200_000
    let aSum = 0
    let bSum = 0
    for (let i = 0; i < n; i++) {
      // Bob's marginal must not shift when Alice changes her analyzer, or the
      // pair would be a telephone.
      const [a, b] = sampleQuantumPair(i % 2 === 0 ? 0 : 73, 22.5, rand)
      aSum += a
      bSum += b
    }
    expect(Math.abs(aSum / n)).toBeLessThan(0.01)
    expect(Math.abs(bSum / n)).toBeLessThan(0.01)
  })

  it('each hidden-variable sampler converges on its own closed form', () => {
    const rand = mulberry32(5150)
    for (const strategy of STRATEGIES) {
      for (const [alpha, beta] of [
        [0, 0],
        [0, 22.5],
        [0, 45],
        [10, 80],
        [-30, 15],
      ] as const) {
        const n = 200_000
        let sum = 0
        for (let i = 0; i < n; i++) {
          const lambda = sampleLambda(rand)
          sum += lhvOutcome(strategy, 'A', alpha, lambda) * lhvOutcome(strategy, 'B', beta, lambda)
        }
        expect(sum / n).toBeCloseTo(lhvCorrelation(strategy, alpha, beta), 2)
      }
    }
  })

  it('the naive model is exactly half the quantum correlation, everywhere', () => {
    const rand = mulberry32(616)
    for (let i = 0; i < 500; i++) {
      const alpha = rand() * 360 - 180
      const beta = rand() * 360 - 180
      expect(lhvCorrelation('naive', alpha, beta)).toBeCloseTo(
        0.5 * analyzerCorrelation(alpha, beta),
        12
      )
    }
  })
})

describe('run bookkeeping', () => {
  it('gives both models the same trials and reports honest error bars', () => {
    const run = createRun('naive', OPTIMAL_SETTINGS, 1000)
    advanceRun(run, mulberry32(1), 8000)
    expect(run.trials).toBe(8000)
    const qTotal = run.quantum.counts.reduce((a, b) => a + b, 0)
    const cTotal = run.classical.counts.reduce((a, b) => a + b, 0)
    expect(qTotal).toBe(8000)
    expect(cTotal).toBe(8000)
    // The same setting choice drives both models on every trial.
    expect(run.quantum.counts).toEqual(run.classical.counts)
    // Roughly a quarter of trials per setting pair.
    for (const n of run.quantum.counts) expect(n).toBeGreaterThan(1600)

    const stats = summarize(run.quantum)
    expect(stats.se).toBeGreaterThan(0)
    // Four correlators each from ~2000 ±1 draws: the error on S is ~4/√8000.
    expect(stats.se).toBeLessThan(0.1)
    expect(stats.s).toBeCloseTo(chshFromCorrelators(stats.correlators), 12)
  })

  it('reports an unmeasured correlator as unknown, not as zero-error', () => {
    const empty = summarize({ counts: [0, 0, 0, 0], sums: [0, 0, 0, 0] })
    expect(empty.se).toBe(Infinity)
    for (const p of empty.perPair) expect(p.se).toBe(Infinity)
  })

  it('is deterministic for a given seed', () => {
    const a = runChsh('conspiracy', OPTIMAL_SETTINGS, 5000, 77)
    const b = runChsh('conspiracy', OPTIMAL_SETTINGS, 5000, 77)
    expect(a.quantum.s).toBe(b.quantum.s)
    expect(a.classical.s).toBe(b.classical.s)
  })

  it('maps every setting-pair key to the right analyzer angles', () => {
    const s: ChshSettings = { a: 1, aPrime: 2, b: 3, bPrime: 4 }
    expect(SETTING_PAIRS.map((k) => anglesFor(s, k))).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ])
  })
})
