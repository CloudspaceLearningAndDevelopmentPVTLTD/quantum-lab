import { describe, expect, it } from 'vitest'
import {
  EINSTEIN_A_OVER_B_PER_NU3,
  GAIN_MEDIA,
  absorbedPumpPowerW,
  effectivePumpRate,
  einsteinAFromB,
  einsteinB12FromB21,
  einsteinBFromA,
  emissionCrossSectionM2,
  frequencyHz,
  integrateThreeLevel,
  inversionPumpRate,
  lasingThresholdPumpRate,
  mediumById,
  outputPowerW,
  paramsForMedium,
  populationsDark,
  pumpRateForEffective,
  stimulatedRatePerPhoton,
  thermalOccupation,
  threeLevelDerivatives,
  threeLevelSteadyState,
  thresholdInversion,
  twoLevelDerivatives,
  twoLevelPopulationsDark,
  twoLevelSteadyState,
  type ThreeLevelParams,
  type ThreeLevelState,
  type TwoLevelParams,
} from './laser'

/**
 * Reference values typed in here by hand, not imported, so a wrong constant
 * in physicalConstants.ts or a wrong power of ν in laser.ts fails these tests
 * instead of propagating through them.
 */
const H = 6.62607015e-34
const C = 299792458
const KB = 1.380649e-23

/** Planck's spectral energy density per unit frequency, J·s·m⁻³. */
function planckEnergyDensity(nu: number, T: number): number {
  return ((8 * Math.PI * H * nu ** 3) / C ** 3) / (Math.exp((H * nu) / (KB * T)) - 1)
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300)

// ────────────────────────────────────────────────────────────
// Einstein coefficients
// ────────────────────────────────────────────────────────────

describe('Einstein coefficients', () => {
  it('B₁₂ = B₂₁ for non-degenerate levels, and g₁B₁₂ = g₂B₂₁ otherwise', () => {
    expect(einsteinB12FromB21(2.5e21)).toBe(2.5e21)
    expect(einsteinB12FromB21(2.5e21, 1, 1)).toBe(2.5e21)
    // Sodium D₂: g₁ = 2 (²S₁/₂), g₂ = 4 (²P₃/₂) → B₁₂ = 2B₂₁.
    expect(einsteinB12FromB21(1e21, 2, 4)).toBeCloseTo(2e21, 6)
    expect(() => einsteinB12FromB21(1, 0, 1)).toThrow()
  })

  it('A/B scales as ν³ with the constant 8πh/c³', () => {
    const B = 1e21
    const nu = 4.3e14
    const r1 = einsteinAFromB(B, nu) / B
    const r2 = einsteinAFromB(B, 2 * nu) / B
    const r3 = einsteinAFromB(B, 3 * nu) / B
    expect(r2 / r1).toBeCloseTo(8, 9)
    expect(r3 / r1).toBeCloseTo(27, 9)
    // 8π × 6.62607015e-34 / (299792458)³ = 6.180e-58 J·s⁴·m⁻³, by hand.
    expect(rel(r1 / nu ** 3, (8 * Math.PI * H) / C ** 3)).toBeLessThan(1e-12)
    expect(EINSTEIN_A_OVER_B_PER_NU3).toBeCloseTo(6.18e-58, 60)
    // The two directions invert each other.
    expect(rel(einsteinBFromA(einsteinAFromB(B, nu), nu), B)).toBeLessThan(1e-12)
  })

  it("satisfies Einstein's detailed balance against a Planck field", () => {
    // In thermal equilibrium at T, absorptions N₁B₁₂ρ must equal emissions
    // N₂(A₂₁ + B₂₁ρ) with N₂/N₁ = e^{−hν/kT}. This holds for every (ν, T) only
    // if A/B = 8πhν³/c³ exactly — with ν² or 4π instead the two sides part.
    for (const [nu, T] of [
      [4.3e14, 300],
      [4.3e14, 6000],
      [1e13, 30],
      [2.5e15, 20000],
    ] as const) {
      const B21 = 3.7e20
      const B12 = einsteinB12FromB21(B21)
      const A = einsteinAFromB(B21, nu)
      const rho = planckEnergyDensity(nu, T)
      const ratio = Math.exp(-(H * nu) / (KB * T)) // N₂/N₁
      const absorption = B12 * rho
      const emission = ratio * (A + B21 * rho)
      expect(rel(absorption, emission)).toBeLessThan(1e-9)
    }
  })

  it('thermal occupation is the stimulated-to-spontaneous ratio in a Planck field', () => {
    const nu = frequencyHz(694.3e-9)
    for (const T of [300, 3000, 1e5]) {
      const B = 5e20
      const A = einsteinAFromB(B, nu)
      const stimOverSpont = (B * planckEnergyDensity(nu, T)) / A
      expect(rel(thermalOccupation(nu, T), stimOverSpont)).toBeLessThan(1e-9)
    }
    // Optical light at room temperature: ~e^{−69}. Nothing stimulates anything.
    expect(thermalOccupation(nu, 300)).toBeLessThan(1e-29)
    expect(thermalOccupation(nu, 300)).toBeGreaterThan(0)
  })

  it('derives the textbook cross-section σ = λ²A/(8πΔν) through B, not by quoting it', () => {
    const ruby = mediumById('ruby')
    const A = 1 / ruby.upperLifetimeS
    const sigma = emissionCrossSectionM2(A, ruby.wavelengthM, ruby.linewidthHz)
    const textbook = (ruby.wavelengthM ** 2 * A) / (8 * Math.PI * ruby.linewidthHz)
    expect(rel(sigma, textbook)).toBeLessThan(1e-12)
    // Measured ruby R₁ cross-section is 2.5 × 10⁻²⁴ m². A top-hat line with no
    // refractive-index correction lands within an order of magnitude of it.
    expect(sigma / 2.5e-24).toBeGreaterThan(1)
    expect(sigma / 2.5e-24).toBeLessThan(10)
  })

  it('K = σc/V, and falls as 1/ν² at fixed A because B ∝ A/ν³', () => {
    const A = 333
    const V = 1e-6
    const dnu = 3e11
    const K1 = stimulatedRatePerPhoton(A, 700e-9, dnu, V)
    const K2 = stimulatedRatePerPhoton(A, 350e-9, dnu, V)
    expect(rel(K1, (emissionCrossSectionM2(A, 700e-9, dnu) * C) / V)).toBeLessThan(1e-12)
    expect(K1 / K2).toBeCloseTo(4, 9)
  })
})

// ────────────────────────────────────────────────────────────
// Two-level system
// ────────────────────────────────────────────────────────────

/** Forward-Euler the two-level populations to steady state, in the test. */
function twoLevelByIntegration(A: number, N: number, W: number): number {
  let N2 = 0
  const dt = 0.02 / Math.max(A, W)
  const tEnd = 40 / A
  for (let t = 0; t < tEnd; t += dt) {
    const N1 = N - N2
    N2 += dt * (W * (N1 - N2) - A * N2)
  }
  return N2
}

describe('two-level system', () => {
  it('never inverts: N₂ < N₁ for every pump rate, approaching ½ from below', () => {
    const A = 250
    const N = 1e6
    let last = 0
    for (let k = -3; k <= 9; k++) {
      const W = A * 10 ** k
      const { N1, N2 } = twoLevelPopulationsDark(A, N, W)
      expect(N2).toBeLessThan(N1)
      expect(N2 / N).toBeGreaterThan(last)
      last = N2 / N
    }
    expect(last).toBeLessThan(0.5)
    expect(last).toBeGreaterThan(0.4999)
  })

  it('closed form agrees with integrating the rate equation from the ground state', () => {
    const A = 250
    const N = 1e6
    for (const W of [0.1 * A, A, 5 * A]) {
      const numeric = twoLevelByIntegration(A, N, W)
      expect(rel(numeric, twoLevelPopulationsDark(A, N, W).N2)).toBeLessThan(2e-3)
      // W/(2W + A), the expression derived by hand.
      expect(rel(numeric, (N * W) / (2 * W + A))).toBeLessThan(2e-3)
    }
  })

  it('with a cavity, the photon number stays at the spontaneous floor even at absurd pump rates', () => {
    const p: TwoLevelParams = { A21: 333, K: 2e-9, tauC: 1e-8, N: 1.6e19 }
    for (const W of [p.A21, 100 * p.A21, 1e6 * p.A21]) {
      const s = twoLevelSteadyState(p, W)
      expect(s.N2).toBeLessThan(s.N1)
      // No gain: n cannot exceed what spontaneous emission alone puts in, τ_cKN₂.
      expect(s.n).toBeLessThanOrEqual(p.tauC * p.K * s.N2 * (1 + 1e-12))
      expect(s.n).toBeGreaterThan(0)
      // It really is a steady state of the stated equations.
      const d = twoLevelDerivatives(s, p, W)
      expect(Math.abs(d.N2) / (W * p.N)).toBeLessThan(1e-9)
      expect(Math.abs(d.n) / (s.n / p.tauC)).toBeLessThan(1e-6)
    }
  })
})

// ────────────────────────────────────────────────────────────
// Three-level laser
// ────────────────────────────────────────────────────────────

const RUBY = paramsForMedium(mediumById('ruby'), 10e-9)

/** The dark inversion written out by hand from the three rate equations. */
function darkInversionByHand(p: ThreeLevelParams, W: number): number {
  const R = (W * p.gamma32) / (p.gamma32 + W)
  const N1 = p.N / (1 + W / (p.gamma32 + W) + R / p.A21)
  return (R / p.A21 - 1) * N1
}

describe('three-level laser: thresholds', () => {
  it('inversion appears exactly where the effective pump rate equals A₂₁', () => {
    const W = inversionPumpRate(RUBY)
    expect(rel(effectivePumpRate(W, RUBY.gamma32), RUBY.A21)).toBeLessThan(1e-12)
    const { N1, N2 } = populationsDark(RUBY, W)
    expect(rel(N1, N2)).toBeLessThan(1e-12)
    expect(populationsDark(RUBY, 0.99 * W).N2).toBeLessThan(populationsDark(RUBY, 0.99 * W).N1)
    expect(populationsDark(RUBY, 1.01 * W).N2).toBeGreaterThan(populationsDark(RUBY, 1.01 * W).N1)
    // Pump rate and effective rate invert each other.
    expect(rel(pumpRateForEffective(effectivePumpRate(1234, 1e6), 1e6), 1234)).toBeLessThan(1e-12)
  })

  it('lasing threshold matches the analytic three-level expression', () => {
    // Textbook (Svelto, Siegman): with a fast pump band the dark inversion is
    // N(R − A)/(R + A), and gain equals loss when that reaches 1/(Kτ_c).
    const D = 1 / (RUBY.K * RUBY.tauC)
    const analyticR = (RUBY.A21 * (RUBY.N + D)) / (RUBY.N - D)
    const W = lasingThresholdPumpRate(RUBY)
    const R = effectivePumpRate(W, RUBY.gamma32)
    // γ₃₂ = 10⁸ against R ~ 340 s⁻¹, so the finite-band correction is ~10⁻⁶.
    expect(rel(R, analyticR)).toBeLessThan(1e-5)

    // And independently: bisect the hand-written dark inversion for ΔN = D.
    let lo = inversionPumpRate(RUBY)
    let hi = 1e4 * RUBY.A21
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (darkInversionByHand(RUBY, mid) < D) lo = mid
      else hi = mid
    }
    expect(rel(W, (lo + hi) / 2)).toBeLessThan(1e-9)
    // For ruby the threshold is barely above the inversion point: the three-
    // level tax (lift half the atoms) dwarfs the cavity's demand.
    expect(W / inversionPumpRate(RUBY)).toBeGreaterThan(1)
    expect(W / inversionPumpRate(RUBY)).toBeLessThan(1.02)
  })

  it('a cavity too lossy for the medium has no threshold at all', () => {
    const lossy: ThreeLevelParams = { ...RUBY, tauC: 1e-11 }
    expect(thresholdInversion(lossy)).toBeGreaterThan(lossy.N)
    expect(lasingThresholdPumpRate(lossy)).toBe(Infinity)
    const s = threeLevelSteadyState(lossy, 1e4 * lossy.A21)
    // Pumped ten thousand times harder than ruby needs, and still nothing but
    // amplified spontaneous emission: with ΔN < ΔN_th the seed is multiplied
    // by 1/(1 − ΔN/ΔN_th), a finite number — no runaway.
    const D = thresholdInversion(lossy)
    const ase = (lossy.tauC * lossy.K * s.N2) / (1 - (s.N2 - s.N1) / D)
    expect(rel(s.n, ase)).toBeLessThan(1e-9)
    expect(s.n).toBeLessThan(100)
  })
})

describe('three-level laser: steady state', () => {
  it('below threshold the mode holds only spontaneous photons; above, the inversion clamps at ΔN_th', () => {
    const Wth = lasingThresholdPumpRate(RUBY)
    const D = thresholdInversion(RUBY)

    const below = threeLevelSteadyState(RUBY, 0.9 * Wth)
    expect(below.n).toBeLessThan(1e4)
    expect(below.N2 - below.N1).toBeLessThan(D)
    expect(rel(below.N2 - below.N1, darkInversionByHand(RUBY, 0.9 * Wth))).toBeLessThan(1e-3)

    for (const f of [1.1, 1.5, 3]) {
      const s = threeLevelSteadyState(RUBY, f * Wth)
      expect(s.n).toBeGreaterThan(1e11)
      expect(rel(s.N2 - s.N1, D)).toBeLessThan(1e-6)
      // Gain never exceeds loss in steady state, but sits just under it: the
      // shortfall is made up by the spontaneous seed.
      expect(RUBY.K * (s.N2 - s.N1) * RUBY.tauC).toBeLessThan(1)
    }
  })

  it('above threshold the photon number grows linearly with pump rate, at the analytic slope', () => {
    const Wth = lasingThresholdPumpRate(RUBY)
    const D = thresholdInversion(RUBY)
    const Ws = [2, 3, 4, 5].map((f) => f * Wth)
    const ns = Ws.map((W) => threeLevelSteadyState(RUBY, W).n)
    // Closed form with the inversion clamped: n = τ_c[(R − A)N₁ − A·D],
    // N₁ = (N − D)/(2 + R/γ).
    for (let i = 0; i < Ws.length; i++) {
      const R = effectivePumpRate(Ws[i], RUBY.gamma32)
      const N1 = (RUBY.N - D) / (2 + R / RUBY.gamma32)
      const analytic = RUBY.tauC * ((R - RUBY.A21) * N1 - RUBY.A21 * D)
      expect(rel(ns[i], analytic)).toBeLessThan(1e-6)
    }
    // Equal pump steps give equal photon steps.
    const d1 = ns[1] - ns[0]
    const d2 = ns[2] - ns[1]
    const d3 = ns[3] - ns[2]
    expect(rel(d1, d2)).toBeLessThan(1e-4)
    expect(rel(d2, d3)).toBeLessThan(1e-4)
    // Slope dn/dW → τ_c(N − D)/2 for a fast pump band.
    expect(rel(d1 / (Ws[1] - Ws[0]), (RUBY.tauC * (RUBY.N - D)) / 2)).toBeLessThan(1e-4)
    // And the line extrapolates back to zero photons at the threshold.
    const intercept = Ws[0] - ns[0] / (d1 / (Ws[1] - Ws[0]))
    expect(rel(intercept, Wth)).toBeLessThan(1e-4)
  })

  it('the closed-form steady state is a fixed point of the stated derivatives', () => {
    for (const W of [0.5 * RUBY.A21, 1.2 * RUBY.A21, 3 * RUBY.A21]) {
      const s = threeLevelSteadyState(RUBY, W)
      const d = threeLevelDerivatives(s, RUBY, W)
      expect(s.N1 + s.N2 + s.N3).toBeCloseTo(RUBY.N, -8)
      expect(Math.abs(d.N1) / (RUBY.A21 * RUBY.N)).toBeLessThan(1e-9)
      expect(Math.abs(d.N2) / (RUBY.A21 * RUBY.N)).toBeLessThan(1e-9)
      expect(Math.abs(d.N3) / (RUBY.A21 * RUBY.N)).toBeLessThan(1e-9)
      expect(Math.abs(d.n) / Math.max(1, s.n / RUBY.tauC)).toBeLessThan(1e-6)
    }
  })

  it('integrating the rate equations from the ground state lands on the closed form', () => {
    // A toy medium the RK4 can reach steady state on in a few thousand steps:
    // A = 1, K = 0.1, τ_c = 0.5 → ΔN_th = 20 of N = 100, so the cavity loss is
    // a real part of the threshold here, unlike ruby.
    const toy: ThreeLevelParams = { A21: 1, gamma32: 50, K: 0.1, tauC: 0.5, N: 100 }
    const ground: ThreeLevelState = { N1: 100, N2: 0, N3: 0, n: 0 }
    const Wth = lasingThresholdPumpRate(toy)
    expect(Wth).toBeGreaterThan(inversionPumpRate(toy))
    for (const W of [0.5 * Wth, 1.5 * Wth, 3 * Wth]) {
      const numeric = integrateThreeLevel(toy, W, ground, 400)
      const exact = threeLevelSteadyState(toy, W)
      expect(rel(numeric.N1, exact.N1)).toBeLessThan(1e-5)
      expect(rel(numeric.N2, exact.N2)).toBeLessThan(1e-5)
      expect(rel(numeric.n, exact.n)).toBeLessThan(1e-4)
    }
  })

  it('converts photon number and pump rate into watts', () => {
    const nu = frequencyHz(694.3e-9)
    // 10¹³ photons of 1.786 eV leaving in 10 ns ≈ 286 W.
    expect(outputPowerW(1e13, nu, 10e-9)).toBeCloseTo(286, -1)
    // Threshold pump for the ruby preset: ~half of 1.6 × 10¹⁹ ions lifted at
    // 333 s⁻¹ with 550 nm photons is a few hundred watts absorbed.
    const Wth = lasingThresholdPumpRate(RUBY)
    const s = threeLevelSteadyState(RUBY, Wth)
    const P = absorbedPumpPowerW(Wth, s.N1, s.N3, frequencyHz(550e-9))
    expect(P).toBeGreaterThan(300)
    expect(P).toBeLessThan(2000)
  })

  it('every listed medium has a reachable threshold in a 10 ns cavity', () => {
    for (const m of GAIN_MEDIA) {
      const p = paramsForMedium(m, 10e-9)
      expect(Number.isFinite(lasingThresholdPumpRate(p))).toBe(true)
      expect(thresholdInversion(p) / p.N).toBeLessThan(0.1)
    }
  })
})
