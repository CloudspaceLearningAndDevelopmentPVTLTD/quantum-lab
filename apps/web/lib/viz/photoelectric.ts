/**
 * photoelectric.ts — Einstein's 1905 photoelectric equation and the apparatus around it.
 *
 * The whole content of the photon hypothesis is one line:
 *
 *     KE_max = hf − φ
 *
 * Everything the /visualizations/photoelectric-effect page shows is a consequence of
 * it. Intensity appears nowhere in that equation, which is exactly why the stopping
 * voltage does not care how bright the light is; and KE_max cannot be negative, which
 * is why there is a threshold frequency below which nothing happens at any brightness.
 *
 * Units: energies in electron-volts, frequencies in hertz, wavelengths in nanometres,
 * voltages in volts. Because one electron-volt is by definition the energy an electron
 * gains across one volt, a stopping voltage in volts is numerically equal to KE_max in
 * eV — that identity is used below and is not a coincidence to be tidied away.
 */

import {
  ELECTRON_MASS_KG,
  ELEMENTARY_CHARGE_C,
  HC_EV_NM,
  PLANCK_EV_S,
  frequencyHzFromWavelengthNm,
  wavelengthNmFromFrequencyHz,
} from './physicalConstants'

export type Metal = {
  id: string
  name: string
  symbol: string
  /** Work function in eV: the least energy that frees an electron from the surface. */
  workFunctionEv: number
}

/**
 * Four metals spanning the range that makes the experiment vivid — sodium emits
 * under green light, platinum needs deep ultraviolet.
 *
 * Work functions are surface-sensitive: they depend on crystal face, oxidation and
 * adsorbates, and published values for the same metal differ by a few tenths of an eV.
 * These are the standard polycrystalline figures a textbook quotes.
 */
export const METALS: readonly Metal[] = [
  { id: 'sodium', name: 'Sodium', symbol: 'Na', workFunctionEv: 2.28 },
  { id: 'zinc', name: 'Zinc', symbol: 'Zn', workFunctionEv: 4.3 },
  { id: 'copper', name: 'Copper', symbol: 'Cu', workFunctionEv: 4.7 },
  { id: 'platinum', name: 'Platinum', symbol: 'Pt', workFunctionEv: 6.35 },
] as const

export function metalById(id: string): Metal {
  return METALS.find((m) => m.id === id) ?? METALS[0]
}

/** Photon energy in eV at a given frequency. E = hf. */
export function photonEnergyEv(frequencyHz: number): number {
  return PLANCK_EV_S * frequencyHz
}

/** The lowest frequency that can free an electron from this surface: f₀ = φ/h. */
export function thresholdFrequencyHz(workFunctionEv: number): number {
  return workFunctionEv / PLANCK_EV_S
}

/** The longest wavelength that can free an electron: λ₀ = hc/φ. */
export function thresholdWavelengthNm(workFunctionEv: number): number {
  return HC_EV_NM / workFunctionEv
}

/** True when photons at this frequency carry at least the work function. */
export function emits(frequencyHz: number, workFunctionEv: number): boolean {
  return photonEnergyEv(frequencyHz) > workFunctionEv
}

/**
 * KE_max = hf − φ, floored at zero.
 *
 * The floor is the physics, not defensive programming: a photon that cannot pay the
 * work function does not eject a slow electron, it ejects no electron at all. Two
 * such photons do not club together either, which is what a wave theory would predict
 * and what turning up the intensity below threshold conspicuously fails to produce.
 */
export function maxKineticEnergyEv(frequencyHz: number, workFunctionEv: number): number {
  return Math.max(0, photonEnergyEv(frequencyHz) - workFunctionEv)
}

/**
 * The retarding voltage that just stops the fastest electron, in volts.
 * Numerically equal to KE_max in eV, since eV₀ = KE_max.
 */
export function stoppingVoltageV(frequencyHz: number, workFunctionEv: number): number {
  return maxKineticEnergyEv(frequencyHz, workFunctionEv)
}

/** Speed of an electron with the given kinetic energy in eV. Non-relativistic. */
export function electronSpeedMs(kineticEnergyEv: number): number {
  if (kineticEnergyEv <= 0) return 0
  return Math.sqrt((2 * kineticEnergyEv * ELEMENTARY_CHARGE_C) / ELECTRON_MASS_KG)
}

/**
 * Fraction of the emitted electrons that still reach the collector against a
 * retarding voltage V.
 *
 * MODEL, stated as one: the emitted electrons are taken to have kinetic energies
 * spread uniformly between 0 and KE_max, so the fraction with more than eV of energy
 * falls linearly to zero at V = V_stop. The true distribution depends on the metal's
 * band structure and on how deep below the surface each electron started, and the
 * real I–V curve is a shallower S than this straight line.
 *
 * What is NOT a model is the intercept. Einstein's equation predicts one number about
 * this curve — the voltage at which the current reaches zero — and that number is
 * exact here, independent of the shape assumed for everything to its left.
 */
export function collectedFraction(retardingVoltageV: number, stoppingV: number): number {
  if (retardingVoltageV <= 0) return 1
  if (stoppingV <= 0) return 0
  if (retardingVoltageV >= stoppingV) return 0
  return 1 - retardingVoltageV / stoppingV
}

export type PhotocurrentInput = {
  frequencyHz: number
  workFunctionEv: number
  /** Beam intensity as a fraction of the lamp's maximum, 0…1. */
  intensity: number
  /** Retarding voltage applied to the collector, volts. Zero means no retarding field. */
  retardingVoltageV: number
}

/**
 * Photocurrent as a fraction of the saturation current the brightest beam would give.
 *
 * The photon ARRIVAL RATE is proportional to intensity, so the number of electrons
 * ejected per second — and therefore the saturation current — is proportional to
 * intensity. Their ENERGY is set by frequency alone. Those two sentences are the
 * entire experimental result, and they are two different sentences.
 */
export function photocurrentFraction(input: PhotocurrentInput): number {
  const { frequencyHz, workFunctionEv, intensity, retardingVoltageV } = input
  if (!emits(frequencyHz, workFunctionEv)) return 0
  const stopping = stoppingVoltageV(frequencyHz, workFunctionEv)
  return Math.max(0, Math.min(1, intensity)) * collectedFraction(retardingVoltageV, stopping)
}

/** Everything the page displays for one setting of the controls. */
export type PhotoelectricReadout = {
  frequencyHz: number
  wavelengthNm: number
  photonEnergyEv: number
  workFunctionEv: number
  thresholdFrequencyHz: number
  thresholdWavelengthNm: number
  emits: boolean
  maxKineticEnergyEv: number
  stoppingVoltageV: number
  electronSpeedMs: number
  currentFraction: number
}

export function readout(input: PhotocurrentInput): PhotoelectricReadout {
  const { frequencyHz, workFunctionEv } = input
  const ke = maxKineticEnergyEv(frequencyHz, workFunctionEv)
  return {
    frequencyHz,
    wavelengthNm: wavelengthNmFromFrequencyHz(frequencyHz),
    photonEnergyEv: photonEnergyEv(frequencyHz),
    workFunctionEv,
    thresholdFrequencyHz: thresholdFrequencyHz(workFunctionEv),
    thresholdWavelengthNm: thresholdWavelengthNm(workFunctionEv),
    emits: emits(frequencyHz, workFunctionEv),
    maxKineticEnergyEv: ke,
    stoppingVoltageV: stoppingVoltageV(frequencyHz, workFunctionEv),
    electronSpeedMs: electronSpeedMs(ke),
    currentFraction: photocurrentFraction(input),
  }
}

/** Convenience re-export so page code has one import for the frequency/wavelength pair. */
export { frequencyHzFromWavelengthNm, wavelengthNmFromFrequencyHz }

/**
 * Least-squares slope and intercept of stopping voltage against frequency, over the
 * frequencies at which this metal actually emits.
 *
 * This is the measurement Millikan made. The page invites the reader to do it by eye
 * off the graph; this function is what the page's own "you should get h ≈ …" figure
 * is computed from, so the claim on screen is derived from the plotted points rather
 * than asserted alongside them.
 */
export function fitStoppingLine(
  workFunctionEv: number,
  frequencies: readonly number[]
): { slopeVPerHz: number; interceptV: number; thresholdHz: number } | null {
  const pts = frequencies
    .filter((f) => emits(f, workFunctionEv))
    .map((f) => [f, stoppingVoltageV(f, workFunctionEv)] as const)
  if (pts.length < 2) return null
  const n = pts.length
  let sx = 0
  let sy = 0
  for (const [x, y] of pts) {
    sx += x
    sy += y
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my)
    den += (x - mx) * (x - mx)
  }
  if (den === 0) return null
  const slope = num / den
  const intercept = my - slope * mx
  return { slopeVPerHz: slope, interceptV: intercept, thresholdHz: -intercept / slope }
}
