/**
 * physicalConstants.ts — the SI defining constants, plus the two derived constants
 * (Stefan–Boltzmann σ and Wien's displacement b) that the blackbody and photoelectric
 * pages quote at the reader.
 *
 * Since the 2019 SI redefinition h, c, e and k_B are *exact* by definition, so the
 * literals below are not measurements with error bars — they are the definitions.
 *
 * σ and b are DERIVED here rather than pasted from a table. That is deliberate: it
 * lets physicalConstants.test.ts check the numbers this module computes against the
 * independently published CODATA values, and a formula that reproduces a table entry
 * it was never shown to ten significant figures is real evidence the formula is right.
 */

/** Planck's constant, J·s. Exact by SI definition. */
export const PLANCK_J_S = 6.62607015e-34
/** Speed of light in vacuum, m/s. Exact by SI definition. */
export const SPEED_OF_LIGHT_M_S = 299792458
/** Elementary charge, C. Exact by SI definition. */
export const ELEMENTARY_CHARGE_C = 1.602176634e-19
/** Boltzmann's constant, J/K. Exact by SI definition. */
export const BOLTZMANN_J_K = 1.380649e-23
/** Electron rest mass, kg (CODATA 2018 — measured, not defined). */
export const ELECTRON_MASS_KG = 9.1093837015e-31

/** Planck's constant in electron-volt seconds — the natural unit for photon energies. */
export const PLANCK_EV_S = PLANCK_J_S / ELEMENTARY_CHARGE_C

/**
 * hc in eV·nm ≈ 1239.84. The single most useful number in this whole subject:
 * photon energy in eV is 1239.84 divided by the wavelength in nanometres.
 */
export const HC_EV_NM = ((PLANCK_J_S * SPEED_OF_LIGHT_M_S) / ELEMENTARY_CHARGE_C) * 1e9

/**
 * The slope of a stopping-voltage-against-frequency graph, volts per hertz.
 * Millikan measured exactly this in 1916 — while trying to disprove Einstein — and
 * got h to within half a percent. It is h/e, and it is the same for every metal.
 */
export const PLANCK_SLOPE_V_PER_HZ = PLANCK_J_S / ELEMENTARY_CHARGE_C

/**
 * Stefan–Boltzmann constant, W·m⁻²·K⁻⁴, from σ = 2π⁵k⁴ / (15c²h³).
 *
 * That closed form only exists because Planck's law is integrable; the classical
 * Rayleigh–Jeans law integrates to infinity, which is why classical physics has no
 * Stefan–Boltzmann constant to derive.
 */
export const STEFAN_BOLTZMANN_W_M2_K4 =
  (2 * Math.PI ** 5 * BOLTZMANN_J_K ** 4) / (15 * SPEED_OF_LIGHT_M_S ** 2 * PLANCK_J_S ** 3)

/**
 * The root of x = 5(1 − e^−x), which is where d/dλ of the Planck spectral radiance
 * vanishes. Newton from x₀ = 5; the iteration converges quadratically and is fully
 * settled in well under ten steps.
 */
export function solveWienX(): number {
  let x = 5
  for (let i = 0; i < 60; i++) {
    const e = Math.exp(-x)
    const f = x - 5 + 5 * e
    const df = 1 - 5 * e
    const next = x - f / df
    if (!Number.isFinite(next)) break
    if (Math.abs(next - x) < 1e-15) return next
    x = next
  }
  return x
}

/** x ≈ 4.965114231744276. */
export const WIEN_X = solveWienX()

/**
 * Wien's displacement constant, m·K: λ_peak · T = b, with b = hc / (k·x).
 * ≈ 2.897771955 × 10⁻³ m·K.
 */
export const WIEN_B_M_K = (PLANCK_J_S * SPEED_OF_LIGHT_M_S) / (BOLTZMANN_J_K * WIEN_X)

/** Photon energy in eV for a wavelength in nanometres. */
export function photonEnergyEvFromWavelengthNm(wavelengthNm: number): number {
  return HC_EV_NM / wavelengthNm
}

/** Wavelength in nanometres for a photon energy in eV. */
export function wavelengthNmFromPhotonEnergyEv(energyEv: number): number {
  return HC_EV_NM / energyEv
}

/** Frequency in hertz for a wavelength in nanometres. */
export function frequencyHzFromWavelengthNm(wavelengthNm: number): number {
  return SPEED_OF_LIGHT_M_S / (wavelengthNm * 1e-9)
}

/** Wavelength in nanometres for a frequency in hertz. */
export function wavelengthNmFromFrequencyHz(frequencyHz: number): number {
  return (SPEED_OF_LIGHT_M_S / frequencyHz) * 1e9
}
