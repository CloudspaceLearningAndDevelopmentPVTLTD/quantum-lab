/**
 * blackbody.ts — Planck's law, the classical law it replaced, and the two results
 * (Wien's displacement law and Stefan–Boltzmann) that fall out of it.
 *
 * The point of the /visualizations/blackbody-spectrum page is a comparison, so both
 * laws live here side by side:
 *
 *   Planck          B_λ = (2hc²/λ⁵) · 1/(e^{hc/λkT} − 1)
 *   Rayleigh–Jeans  B_λ = 2ckT/λ⁴
 *
 * Rayleigh–Jeans is not a bad guess someone made; it is what classical statistical
 * mechanics *requires*, given equipartition — kT of energy per mode, and a cavity has
 * more and more modes at shorter wavelengths, without limit. It is also the exact
 * long-wavelength limit of Planck's law, which is why it survived as long as it did.
 * Its integral over all wavelengths diverges. That divergence is the ultraviolet
 * catastrophe, and it is the reason quantisation had to be invented.
 *
 * Units. Wavelengths are quoted in nanometres at the boundary because that is what a
 * reader recognises, and converted to metres internally because the constants are SI.
 * Spectral EXITANCE (M_λ, power radiated per unit area per unit wavelength, integrating
 * to σT⁴) is what the page plots; spectral RADIANCE (B_λ, the same thing per steradian)
 * is what the formulae above give. For a Lambertian emitter M_λ = π·B_λ, and that π is
 * applied here rather than being quietly dropped.
 */

import {
  BOLTZMANN_J_K,
  PLANCK_J_S,
  SPEED_OF_LIGHT_M_S,
  STEFAN_BOLTZMANN_W_M2_K4,
  WIEN_B_M_K,
} from './physicalConstants'

/** The band a human eye responds to, in nanometres. */
export const VISIBLE_BAND_NM = { min: 380, max: 750 } as const

export type ReferenceTemperature = {
  id: string
  label: string
  kelvin: number
  /** One line on why this temperature is worth looking at. */
  note: string
}

/**
 * Four real temperatures spanning three and a half decades — from the coldest
 * blackbody in the universe to a star that is mostly ultraviolet.
 */
export const REFERENCE_TEMPERATURES: readonly ReferenceTemperature[] = [
  {
    id: 'cmb',
    label: 'CMB',
    kelvin: 2.7,
    note: 'The cosmic microwave background: the whole sky, and the most perfect blackbody ever measured.',
  },
  {
    id: 'bulb',
    label: 'Bulb',
    kelvin: 2800,
    note: 'An incandescent filament. Most of what it emits is infrared, which is why it is warm and dim.',
  },
  {
    id: 'sun',
    label: 'Sun',
    kelvin: 5778,
    note: "The Sun's photosphere. Its peak sits in the middle of the band our eyes evolved to use.",
  },
  {
    id: 'sirius',
    label: 'Sirius',
    kelvin: 9940,
    note: 'Sirius A. Blue-white to look at, but its peak is already in the ultraviolet.',
  },
] as const

/**
 * Planck spectral radiance, W·m⁻²·sr⁻¹·m⁻¹, for a wavelength in metres.
 *
 * `expm1` rather than `exp(x) − 1`: at long wavelengths x is tiny and the subtraction
 * loses every significant figure it has, which is precisely the regime where the
 * curve is supposed to meet Rayleigh–Jeans. At the other end x overflows to Infinity
 * and 1/Infinity is 0 — the correct limit, reached without a special case.
 */
export function planckRadiance(wavelengthM: number, temperatureK: number): number {
  if (wavelengthM <= 0 || temperatureK <= 0) return 0
  const x = (PLANCK_J_S * SPEED_OF_LIGHT_M_S) / (wavelengthM * BOLTZMANN_J_K * temperatureK)
  const denom = Math.expm1(x)
  if (!Number.isFinite(denom) || denom <= 0) return 0
  const numer = (2 * PLANCK_J_S * SPEED_OF_LIGHT_M_S ** 2) / wavelengthM ** 5
  return numer / denom
}

/**
 * Rayleigh–Jeans spectral radiance, W·m⁻²·sr⁻¹·m⁻¹. No h anywhere in it — this is
 * what you get from classical equipartition alone, and it goes to infinity as λ → 0.
 */
export function rayleighJeansRadiance(wavelengthM: number, temperatureK: number): number {
  if (wavelengthM <= 0 || temperatureK <= 0) return 0
  return (2 * SPEED_OF_LIGHT_M_S * BOLTZMANN_J_K * temperatureK) / wavelengthM ** 4
}

/** Planck spectral exitance in W·m⁻²·nm⁻¹, for a wavelength in nanometres. */
export function planckExitancePerNm(wavelengthNm: number, temperatureK: number): number {
  return Math.PI * planckRadiance(wavelengthNm * 1e-9, temperatureK) * 1e-9
}

/** Rayleigh–Jeans spectral exitance in W·m⁻²·nm⁻¹, for a wavelength in nanometres. */
export function rayleighJeansExitancePerNm(wavelengthNm: number, temperatureK: number): number {
  return Math.PI * rayleighJeansRadiance(wavelengthNm * 1e-9, temperatureK) * 1e-9
}

/** Wien's displacement law: the Planck peak sits at b/T. Returned in nanometres. */
export function wienPeakWavelengthNm(temperatureK: number): number {
  if (temperatureK <= 0) return Infinity
  return (WIEN_B_M_K / temperatureK) * 1e9
}

/** Total power radiated per unit area, W·m⁻²: the Stefan–Boltzmann law, σT⁴. */
export function stefanBoltzmannExitance(temperatureK: number): number {
  if (temperatureK <= 0) return 0
  return STEFAN_BOLTZMANN_W_M2_K4 * temperatureK ** 4
}

/** Total power radiated by a sphere of the given radius at this temperature, W. */
export function spherePowerW(radiusM: number, temperatureK: number): number {
  return 4 * Math.PI * radiusM ** 2 * stefanBoltzmannExitance(temperatureK)
}

/**
 * ∫ M_λ dλ between two wavelengths in nanometres, W·m⁻².
 *
 * Composite Simpson in log-wavelength: the substitution u = ln λ turns dλ into λ du,
 * and it is the right variable here because a blackbody spectrum is roughly symmetric
 * in log λ and spans decades. `intervals` is forced even, as Simpson requires.
 */
export function integrateExitance(
  temperatureK: number,
  fromNm: number,
  toNm: number,
  intervals = 2000
): number {
  if (!(toNm > fromNm) || fromNm <= 0 || temperatureK <= 0) return 0
  const n = intervals % 2 === 0 ? intervals : intervals + 1
  const u0 = Math.log(fromNm)
  const u1 = Math.log(toNm)
  const du = (u1 - u0) / n
  // f(u) = M_λ(e^u) · e^u, so the result is already in W·m⁻².
  const f = (u: number): number => {
    const nm = Math.exp(u)
    return planckExitancePerNm(nm, temperatureK) * nm
  }
  let sum = f(u0) + f(u1)
  for (let i = 1; i < n; i++) {
    sum += f(u0 + i * du) * (i % 2 === 1 ? 4 : 2)
  }
  return (sum * du) / 3
}

/**
 * Fraction of a blackbody's total output that lands between two wavelengths.
 *
 * The denominator is the analytic σT⁴, not another numerical integral, so a
 * disagreement between the two shows up as a fraction that misses 1 instead of
 * cancelling itself out. blackbody.test.ts checks exactly that.
 */
export function fractionInBand(temperatureK: number, fromNm: number, toNm: number): number {
  const total = stefanBoltzmannExitance(temperatureK)
  if (total <= 0) return 0
  return integrateExitance(temperatureK, fromNm, toNm) / total
}

/** Fraction of the output a human eye can see. */
export function visibleFraction(temperatureK: number): number {
  return fractionInBand(temperatureK, VISIBLE_BAND_NM.min, VISIBLE_BAND_NM.max)
}

/**
 * A wavelength window that frames the interesting part of the spectrum at this
 * temperature: a decade and a half either side of the Wien peak, which puts the
 * classical divergence at the left edge and the long tail at the right.
 */
export function plotRangeNm(temperatureK: number): { fromNm: number; toNm: number } {
  const peak = wienPeakWavelengthNm(temperatureK)
  return { fromNm: peak / 8, toNm: peak * 6 }
}
