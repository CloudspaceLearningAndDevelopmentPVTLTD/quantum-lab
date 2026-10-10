import { describe, expect, it } from 'vitest'
import {
  REFERENCE_TEMPERATURES,
  VISIBLE_BAND_NM,
  fractionInBand,
  integrateExitance,
  planckExitancePerNm,
  planckRadiance,
  rayleighJeansExitancePerNm,
  rayleighJeansRadiance,
  spherePowerW,
  stefanBoltzmannExitance,
  visibleFraction,
  wienPeakWavelengthNm,
} from './blackbody'
import {
  BOLTZMANN_J_K,
  PLANCK_J_S,
  SPEED_OF_LIGHT_M_S,
  STEFAN_BOLTZMANN_W_M2_K4,
} from './physicalConstants'

/**
 * Find the peak of the Planck curve by brute force, with no reference to Wien's law.
 *
 * A coarse scan over eleven decades of wavelength (1 nm to 10 cm — wide enough to
 * contain the peak for every temperature tested, from the microwave background to a
 * blue star) followed by a ternary search. Comparing this against b/T is a real test:
 * one side maximises the function numerically, the other applies a closed form derived
 * by solving x = 5(1 − e^−x).
 */
function numericPeakNm(temperatureK: number): number {
  const lo0 = Math.log(1)
  const hi0 = Math.log(1e8)
  const steps = 6000
  let bestU = lo0
  let bestV = -Infinity
  for (let i = 0; i <= steps; i++) {
    const u = lo0 + ((hi0 - lo0) * i) / steps
    const v = planckExitancePerNm(Math.exp(u), temperatureK)
    if (v > bestV) {
      bestV = v
      bestU = u
    }
  }
  const width = (hi0 - lo0) / steps
  let lo = bestU - width
  let hi = bestU + width
  for (let i = 0; i < 200; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (planckExitancePerNm(Math.exp(a), temperatureK) < planckExitancePerNm(Math.exp(b), temperatureK)) {
      lo = a
    } else {
      hi = b
    }
  }
  return Math.exp((lo + hi) / 2)
}

describe("Wien's displacement law", () => {
  it('b/T lands exactly on the numerically located peak of the Planck curve', () => {
    for (const T of [2.7, 300, 2800, 5778, 9940, 30000]) {
      const found = numericPeakNm(T)
      expect(wienPeakWavelengthNm(T) / found).toBeCloseTo(1, 4)
    }
  })

  it('gives the peak wavelengths quoted for the reference temperatures', () => {
    const peak = (id: string) =>
      wienPeakWavelengthNm(REFERENCE_TEMPERATURES.find((t) => t.id === id)!.kelvin)
    // 2.897772e-3 / 5778 = 5.015e-7 m. The Sun peaks in green, mid-visible.
    expect(peak('sun')).toBeCloseTo(501.5, 0)
    // An incandescent filament peaks in the near infrared — most of its output is heat.
    expect(peak('bulb')).toBeCloseTo(1034.9, 0)
    // Sirius peaks in the ultraviolet, past the short edge of vision.
    expect(peak('sirius')).toBeCloseTo(291.5, 0)
    // The microwave background peaks near a millimetre — hence "microwave".
    expect(peak('cmb') / 1e6).toBeCloseTo(1.073, 2)
  })

  it('the peak moves inversely with temperature: double T, halve λ', () => {
    expect(wienPeakWavelengthNm(2000)).toBeCloseTo(2 * wienPeakWavelengthNm(4000), 6)
    expect(wienPeakWavelengthNm(1000) * 1000).toBeCloseTo(wienPeakWavelengthNm(1) * 1, 3)
  })
})

describe('Stefan–Boltzmann emerges from integrating Planck', () => {
  /**
   * The strongest check in this file. σT⁴ is an analytic result obtained by
   * integrating Planck's law in closed form; integrateExitance does the same integral
   * numerically in log-wavelength with Simpson's rule. They share no code path.
   */
  it('the numerical integral of the Planck curve equals σT⁴', () => {
    for (const T of [2.7, 300, 2800, 5778, 9940]) {
      const peak = wienPeakWavelengthNm(T)
      const numeric = integrateExitance(T, peak / 400, peak * 400, 4000)
      expect(numeric / stefanBoltzmannExitance(T)).toBeCloseTo(1, 4)
    }
  })

  it('total power scales as the fourth power of temperature', () => {
    expect(stefanBoltzmannExitance(2000) / stefanBoltzmannExitance(1000)).toBeCloseTo(16, 6)
    // The Sun's photosphere radiates 63.2 MW from every square metre.
    expect(stefanBoltzmannExitance(5778) / 1e6).toBeCloseTo(63.2, 0)
    expect(stefanBoltzmannExitance(0)).toBe(0)
  })

  it("reproduces the Sun's luminosity from its radius and surface temperature", () => {
    // R = 6.957e8 m, T = 5778 K. The accepted luminosity is 3.828e26 W, measured by
    // entirely different means (solar constant × the area of Earth's orbit).
    expect(spherePowerW(6.957e8, 5778) / 3.828e26).toBeCloseTo(1, 2)
  })

  it('the fractions in every band add up to one', () => {
    const T = 5778
    const peak = wienPeakWavelengthNm(T)
    const whole = fractionInBand(T, peak / 400, peak * 400)
    expect(whole).toBeCloseTo(1, 4)
    const below = fractionInBand(T, peak / 400, VISIBLE_BAND_NM.min)
    const inside = visibleFraction(T)
    const above = fractionInBand(T, VISIBLE_BAND_NM.max, peak * 400)
    expect(below + inside + above).toBeCloseTo(whole, 6)
  })

  it('gives the accepted visible fractions for the Sun and a light bulb', () => {
    // Roughly 40% of sunlight is visible, depending where the band edges are put; with
    // this page's 380–750 nm it comes to 44%, which is the number the page prints.
    const sun = visibleFraction(5778)
    expect(sun).toBeGreaterThan(0.42)
    expect(sun).toBeLessThan(0.45)
    // An incandescent bulb wastes almost all of it as infrared — the page says 8%.
    expect(visibleFraction(2800)).toBeGreaterThan(0.07)
    expect(visibleFraction(2800)).toBeLessThan(0.09)
    // Sirius is hotter but not better placed: its peak has gone past the band.
    expect(visibleFraction(9940)).toBeGreaterThan(0.38)
    expect(visibleFraction(9940)).toBeLessThan(0.41)
    expect(visibleFraction(9940)).toBeLessThan(sun)
    // The microwave background emits nothing a human eye could ever register.
    expect(visibleFraction(2.7)).toBeLessThan(1e-12)
  })

  /**
   * The page claims the visible share peaks near 7000 K at about 47%, and that the
   * Sun sits within a couple of points of it. That is a claim about a maximum, so it
   * is checked by searching for the maximum rather than by evaluating one point.
   */
  it('the visible share peaks near 7000 K, a short way above the Sun', () => {
    let best = 0
    let bestT = 0
    for (let T = 3000; T <= 12000; T += 25) {
      const v = visibleFraction(T)
      if (v > best) {
        best = v
        bestT = T
      }
    }
    expect(bestT).toBeGreaterThan(6500)
    expect(bestT).toBeLessThan(7500)
    expect(best).toBeGreaterThan(0.45)
    expect(best).toBeLessThan(0.49)
    expect(best - visibleFraction(5778)).toBeLessThan(0.04)
  })
})

describe('Rayleigh–Jeans: right at the long end, catastrophic at the short end', () => {
  /**
   * The exact relation between the two laws is RJ/Planck = (e^x − 1)/x with
   * x = hc/λkT. Every claim the page makes about the classical curve — that it is the
   * long-wavelength limit, and that it diverges to the ultraviolet — is that one
   * expression read at small and large x. Testing it directly tests both at once.
   */
  const x = (wavelengthM: number, T: number) =>
    (PLANCK_J_S * SPEED_OF_LIGHT_M_S) / (wavelengthM * BOLTZMANN_J_K * T)

  it('the ratio of the two laws is exactly (e^x − 1)/x', () => {
    const T = 5778
    for (const nm of [100, 300, 501, 1000, 1e4, 1e6]) {
      const m = nm * 1e-9
      const xi = x(m, T)
      const ratio = rayleighJeansRadiance(m, T) / planckRadiance(m, T)
      expect(ratio / (Math.expm1(xi) / xi)).toBeCloseTo(1, 8)
    }
  })

  it('agrees with Planck to a part in a thousand far into the infrared', () => {
    const T = 5778
    const m = wienPeakWavelengthNm(T) * 1e-9 * 2000
    const ratio = rayleighJeansRadiance(m, T) / planckRadiance(m, T)
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(1.0015)
    // (e^x − 1)/x = 1 + x/2 + x²/6 + x³/24 + …, so the classical law's excess is that
    // series — three terms of it already pin the discrepancy to eleven decimal places.
    const xi = x(m, T)
    expect(ratio - 1).toBeCloseTo(xi / 2 + xi ** 2 / 6 + xi ** 3 / 24, 11)
  })

  it('overshoots Planck by twenty orders of magnitude at a tenth of the peak', () => {
    const T = 5778
    const m = (wienPeakWavelengthNm(T) / 10) * 1e-9
    expect(rayleighJeansRadiance(m, T) / planckRadiance(m, T)).toBeGreaterThan(1e18)
  })

  it('its integral diverges: every decade shorter adds a thousand times more energy', () => {
    // ∫ 2πckT/λ⁴ dλ = (2πckT/3)(1/λ₁³ − 1/λ₂³), which has no finite λ₁ → 0 limit.
    const T = 5778
    const closedForm = (from: number, to: number) =>
      ((2 * Math.PI * SPEED_OF_LIGHT_M_S * BOLTZMANN_J_K * T) / 3) *
      (1 / (from * 1e-9) ** 3 - 1 / (to * 1e-9) ** 3)

    // Simpson over the module's own per-nm exitance must match that closed form.
    const numeric = (fromNm: number, toNm: number) => {
      const n = 4000
      const du = (Math.log(toNm) - Math.log(fromNm)) / n
      const f = (u: number) => {
        const nm = Math.exp(u)
        return rayleighJeansExitancePerNm(nm, T) * nm
      }
      let sum = f(Math.log(fromNm)) + f(Math.log(toNm))
      for (let i = 1; i < n; i++) sum += f(Math.log(fromNm) + i * du) * (i % 2 === 1 ? 4 : 2)
      return (sum * du) / 3
    }

    expect(numeric(100, 1e6) / closedForm(100, 1e6)).toBeCloseTo(1, 6)

    // Each decade of shorter wavelength contributes ~1000× the previous one, forever.
    const decade1 = numeric(100, 1000)
    const decade2 = numeric(10, 100)
    const decade3 = numeric(1, 10)
    expect(decade2 / decade1).toBeGreaterThan(900)
    expect(decade3 / decade2).toBeGreaterThan(900)
    // Meanwhile Planck's contribution over the same shrinking windows collapses to nil.
    expect(integrateExitance(T, 1, 10, 400)).toBeLessThan(1e-30 * stefanBoltzmannExitance(T))
  })
})

describe('guards', () => {
  it('non-physical inputs return zero rather than NaN', () => {
    for (const fn of [planckRadiance, rayleighJeansRadiance]) {
      expect(fn(0, 5778)).toBe(0)
      expect(fn(-1, 5778)).toBe(0)
      expect(fn(500e-9, 0)).toBe(0)
      expect(fn(500e-9, -5)).toBe(0)
    }
    expect(planckExitancePerNm(1e-6, 5778)).toBe(0)
    expect(integrateExitance(5778, 100, 100)).toBe(0)
    expect(fractionInBand(0, 100, 1000)).toBe(0)
    expect(Number.isFinite(planckExitancePerNm(1e-3, 30000))).toBe(true)
  })

  it('exitance is π times radiance, per nanometre rather than per metre', () => {
    const T = 5778
    expect(planckExitancePerNm(500, T) / (Math.PI * planckRadiance(500e-9, T) * 1e-9)).toBeCloseTo(
      1,
      12
    )
    // σ ties the two together: this is the same constant the integral test recovers.
    expect(STEFAN_BOLTZMANN_W_M2_K4).toBeGreaterThan(0)
  })
})
