/**
 * electronDiffraction.ts — the Davisson–Germer experiment (1927) and the X-ray
 * diffraction of the same nickel crystal, for /visualizations/electron-diffraction.
 *
 * Three pieces of physics live here, each checked in electronDiffraction.test.ts
 * against numbers that were not produced by this code:
 *
 *   1. de Broglie.  λ = h / √(2 m e V) for an electron accelerated through V volts.
 *      At 54 V this is 0.167 nm — X-ray territory, which is why a crystal is the
 *      right ruler.
 *
 *   2. The surface grating.  Davisson and Germer fired electrons straight down onto
 *      the (111) face of a nickel crystal and swung a detector round it. Electrons
 *      at 54 eV only penetrate a few atomic layers, so what they see is not the
 *      three-dimensional lattice but the rows of atoms on the surface, spaced
 *      D = 0.215 nm apart — a reflection grating. The grating condition is
 *
 *          D sin θ = n λ,        θ = angle between incident and scattered beams.
 *
 *      Textbooks often quote the same peak in Bragg form, 2 d sin φ = λ with
 *      d = 0.091 nm and φ = 65°. That is not a different spacing of nickel: it is
 *      the family of planes bisecting the incident and scattered beams, whose
 *      spacing is d = D sin(θ/2) and whose glancing angle is φ = 90° − θ/2. The two
 *      statements are the same equation, and `equivalentBragg` returns the second
 *      from the first so the page can print both.
 *
 *   3. X-rays on the same crystal.  X-rays of the same wavelength penetrate microns,
 *      so they diffract from the full lattice: 2 d_hkl sin θ = λ with
 *      d_hkl = a / √(h² + k² + l²) and, for an fcc metal, only reflections with
 *      h, k, l all odd or all even. The standard Cu Kα powder pattern of nickel
 *      (JCPDS 04-0850) is what the test compares against.
 *
 * Units: volts, nanometres, degrees at the boundary; radians only inside.
 */

import { ELECTRON_MASS_KG, ELEMENTARY_CHARGE_C, PLANCK_J_S } from './physicalConstants'

export const DEG = Math.PI / 180

// ────────────────────────────────────────────────────────────
// de Broglie
// ────────────────────────────────────────────────────────────

/**
 * de Broglie wavelength in nanometres of an electron accelerated from rest
 * through `voltageV` volts: λ = h / √(2 m e V). Non-relativistic — at 400 V the
 * relativistic correction is 0.02%, far below anything the page displays.
 */
export function deBroglieWavelengthNm(voltageV: number): number {
  if (!(voltageV > 0)) return Number.POSITIVE_INFINITY
  const momentum = Math.sqrt(2 * ELECTRON_MASS_KG * ELEMENTARY_CHARGE_C * voltageV)
  return (PLANCK_J_S / momentum) * 1e9
}

/** The inverse: the accelerating voltage that gives an electron this wavelength. */
export function voltageForWavelengthNm(wavelengthNm: number): number {
  if (!(wavelengthNm > 0)) return Number.POSITIVE_INFINITY
  const m = wavelengthNm * 1e-9
  return (PLANCK_J_S * PLANCK_J_S) / (2 * ELECTRON_MASS_KG * ELEMENTARY_CHARGE_C * m * m)
}

/** λ(nm) = DE_BROGLIE_NM_ROOT_V / √V — the pocket formula, ≈ 1.226. */
export const DE_BROGLIE_NM_ROOT_V = deBroglieWavelengthNm(1)

// ────────────────────────────────────────────────────────────
// Nickel
// ────────────────────────────────────────────────────────────

/** Cubic lattice constant of fcc nickel at room temperature, nm (JCPDS 04-0850: 3.5238 Å). */
export const NI_LATTICE_CONSTANT_NM = 0.35238

/**
 * Spacing of the atom rows on the (111) surface of an fcc crystal: the close-packed
 * layer is a triangular net with side a/√2, and its rows are (√3/2) of that apart.
 * For nickel this is 0.2158 nm; Davisson and Germer used 2.15 Å from X-ray data.
 */
export const NI_111_ROW_SPACING_NM = (NI_LATTICE_CONSTANT_NM * Math.sqrt(3)) / (2 * Math.sqrt(2))

/** Interplanar spacing d_hkl = a / √(h² + k² + l²) for a cubic crystal. */
export function cubicPlaneSpacingNm(a: number, h: number, k: number, l: number): number {
  return a / Math.sqrt(h * h + k * k + l * l)
}

// ────────────────────────────────────────────────────────────
// The surface grating (Davisson–Germer geometry)
// ────────────────────────────────────────────────────────────

/**
 * The angle, measured from the incident beam, at which order `order` of the
 * surface grating peaks: D sin θ = nλ. Null when nλ > D — the order does not
 * exist at this wavelength, which is what happens to the first-order peak below
 * about 32 V on nickel.
 */
export function gratingPeakAngleDeg(
  wavelengthNm: number,
  order = 1,
  rowSpacingNm = NI_111_ROW_SPACING_NM
): number | null {
  const s = (order * wavelengthNm) / rowSpacingNm
  if (!(s >= 0) || s > 1) return null
  return Math.asin(s) / DEG
}

/** Same thing, from the voltage. */
export function peakAngleDegAtVoltage(
  voltageV: number,
  order = 1,
  rowSpacingNm = NI_111_ROW_SPACING_NM
): number | null {
  return gratingPeakAngleDeg(deBroglieWavelengthNm(voltageV), order, rowSpacingNm)
}

/**
 * The voltage at which a detector fixed at `thetaDeg` sees order `order` peak:
 * λ = D sin θ / n, then V from λ. Infinity at θ = 0 (no finite voltage puts a
 * non-zero order straight back up the beam).
 */
export function peakVoltageV(
  thetaDeg: number,
  order = 1,
  rowSpacingNm = NI_111_ROW_SPACING_NM
): number {
  const lambda = (rowSpacingNm * Math.sin(thetaDeg * DEG)) / order
  return voltageForWavelengthNm(lambda)
}

/**
 * The Bragg-law reading of a surface-grating peak at scattering angle θ: the planes
 * that bisect the incident and scattered beams have spacing d = D sin(θ/2) and are
 * met at glancing angle φ = 90° − θ/2, and 2 d sin φ = D sin θ exactly.
 */
export function equivalentBragg(
  thetaDeg: number,
  rowSpacingNm = NI_111_ROW_SPACING_NM
): { spacingNm: number; glancingAngleDeg: number } {
  return {
    spacingNm: rowSpacingNm * Math.sin((thetaDeg / 2) * DEG),
    glancingAngleDeg: 90 - thetaDeg / 2,
  }
}

// ────────────────────────────────────────────────────────────
// Electron intensity model
// ────────────────────────────────────────────────────────────

export type ElectronModel = {
  /** Surface rows scattering coherently. Sets the peak width: Δ(sin θ) ≈ λ / (N D). */
  rows: number
  /** Fraction of the scattered current that is featureless diffuse background. */
  diffuse: number
  rowSpacingNm: number
  /**
   * Scale of the falling single-atom scattering amplitude, in Å⁻¹ of
   * s = sin(θ/2)/λ. The amplitude is taken as 1 / (1 + (s/s₀)²) — the shape of
   * scattering from a screened nucleus — so higher orders and larger angles are
   * weaker, as they are on any real diffractometer.
   */
  formFactorScale: number
}

/**
 * Seven coherent rows gives a first-order peak about 12° wide at 54 V — the width
 * of the peak in Davisson and Germer's own polar plots, which is set by how few
 * layers a 54 eV electron samples before it is absorbed, not by the crystal's
 * perfection.
 */
export const DEFAULT_ELECTRON_MODEL: ElectronModel = {
  rows: 7,
  diffuse: 0.22,
  rowSpacingNm: NI_111_ROW_SPACING_NM,
  formFactorScale: 0.4,
}

/** |f|² for the single-atom envelope: s in Å⁻¹. */
export function electronFormFactorSquared(sPerAngstrom: number, scale: number): number {
  const r = sPerAngstrom / scale
  const f = 1 / (1 + r * r)
  return f * f
}

/**
 * The N-slit interference factor [sin(Nx) / (N sin x)]², with the x → kπ limit
 * taken by hand so a detector sitting exactly on a peak reads 1, not NaN.
 */
export function gratingFactor(x: number, rows: number): number {
  const N = Math.max(1, Math.round(rows))
  const s = Math.sin(x)
  if (Math.abs(s) < 1e-9) return 1
  const v = Math.sin(N * x) / (N * s)
  return v * v
}

/**
 * Relative scattered intensity a detector at `thetaDeg` sees, for electrons at
 * `voltageV`. Kinematic (single-scattering) model: the N-row grating factor of
 * the (111) surface, plus a diffuse background, both under the single-atom
 * form factor and a cos θ envelope (the detector cannot see below the surface
 * plane). Normalised so the specular beam at θ = 0 reads 1.
 */
export function electronIntensity(
  thetaDeg: number,
  voltageV: number,
  model: ElectronModel = DEFAULT_ELECTRON_MODEL
): number {
  const theta = Math.abs(thetaDeg) * DEG
  if (theta >= Math.PI / 2) return 0
  const lambda = deBroglieWavelengthNm(voltageV)
  if (!Number.isFinite(lambda)) return 0
  const x = (Math.PI * model.rowSpacingNm * Math.sin(theta)) / lambda
  const g = gratingFactor(x, model.rows)
  const s = Math.sin(theta / 2) / (lambda * 10)
  const f2 = electronFormFactorSquared(s, model.formFactorScale)
  const envelope = Math.cos(theta) * f2
  return envelope * (model.diffuse + (1 - model.diffuse) * g)
}

/** Intensity sampled on a regular angle grid — the polar plot. */
export function polarProfile(
  voltageV: number,
  stepDeg = 1,
  model: ElectronModel = DEFAULT_ELECTRON_MODEL
): { thetaDeg: number; intensity: number }[] {
  const out: { thetaDeg: number; intensity: number }[] = []
  for (let t = 0; t <= 90 + 1e-9; t += stepDeg) {
    out.push({ thetaDeg: t, intensity: electronIntensity(t, voltageV, model) })
  }
  return out
}

/**
 * Intensity at a fixed detector as the voltage is swept — Davisson and Germer's
 * second figure. Plotted against √V the orders come out evenly spaced, because
 * λ ∝ 1/√V and the condition is nλ = D sin θ.
 */
export function voltageScan(
  thetaDeg: number,
  minV: number,
  maxV: number,
  steps: number,
  model: ElectronModel = DEFAULT_ELECTRON_MODEL
): { voltageV: number; intensity: number }[] {
  const out: { voltageV: number; intensity: number }[] = []
  const a = Math.sqrt(minV)
  const b = Math.sqrt(maxV)
  for (let i = 0; i <= steps; i++) {
    const r = a + ((b - a) * i) / steps
    const v = r * r
    out.push({ voltageV: v, intensity: electronIntensity(thetaDeg, v, model) })
  }
  return out
}

/** Index of the largest value; ties go to the first. */
export function argmax(values: readonly number[]): number {
  let best = 0
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i
  return best
}

/**
 * Cumulative distribution of scattering angle over −90…90°, for sampling
 * electrons one at a time in the lab. Returns the bin edges and CDF; a uniform
 * deviate is turned into an angle with `sampleAngleDeg`.
 */
export function scatteringCdf(
  voltageV: number,
  binDeg = 0.5,
  model: ElectronModel = DEFAULT_ELECTRON_MODEL
): { edges: number[]; cdf: number[] } {
  const edges: number[] = []
  const weights: number[] = []
  for (let t = -90; t < 90 - 1e-9; t += binDeg) {
    edges.push(t)
    weights.push(electronIntensity(t + binDeg / 2, voltageV, model))
  }
  edges.push(90)
  const total = weights.reduce((s, w) => s + w, 0)
  const cdf: number[] = []
  let acc = 0
  for (const w of weights) {
    acc += total > 0 ? w / total : 1 / weights.length
    cdf.push(acc)
  }
  cdf[cdf.length - 1] = 1
  return { edges, cdf }
}

export function sampleAngleDeg(u: number, table: { edges: number[]; cdf: number[] }): number {
  const { edges, cdf } = table
  let lo = 0
  let hi = cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cdf[mid] < u) lo = mid + 1
    else hi = mid
  }
  const prev = lo === 0 ? 0 : cdf[lo - 1]
  const span = cdf[lo] - prev
  const frac = span > 0 ? (u - prev) / span : 0.5
  return edges[lo] + (edges[lo + 1] - edges[lo]) * Math.min(1, Math.max(0, frac))
}

// ────────────────────────────────────────────────────────────
// X-rays on the same crystal
// ────────────────────────────────────────────────────────────

export type Reflection = {
  hkl: readonly [number, number, number]
  /** Number of symmetry-equivalent planes contributing to a powder line. */
  multiplicity: number
}

/**
 * The allowed reflections of an fcc lattice with h² + k² + l² ≤ 27: all-odd or
 * all-even indices only. (100), (110), (210) … are extinguished by the
 * face-centring — that absence is how one tells fcc from simple cubic.
 */
export const FCC_REFLECTIONS: readonly Reflection[] = [
  { hkl: [1, 1, 1], multiplicity: 8 },
  { hkl: [2, 0, 0], multiplicity: 6 },
  { hkl: [2, 2, 0], multiplicity: 12 },
  { hkl: [3, 1, 1], multiplicity: 24 },
  { hkl: [2, 2, 2], multiplicity: 8 },
  { hkl: [4, 0, 0], multiplicity: 6 },
  { hkl: [3, 3, 1], multiplicity: 24 },
  { hkl: [4, 2, 0], multiplicity: 24 },
  { hkl: [4, 2, 2], multiplicity: 24 },
  { hkl: [5, 1, 1], multiplicity: 24 },
  { hkl: [3, 3, 3], multiplicity: 8 },
] as const

/** True when an fcc lattice reflects from (hkl): indices all odd or all even. */
export function fccAllowed(h: number, k: number, l: number): boolean {
  const odd = (n: number) => Math.abs(n) % 2 === 1
  return (odd(h) && odd(k) && odd(l)) || (!odd(h) && !odd(k) && !odd(l))
}

/** Bragg: 2 d sin θ = nλ. Returns 2θ in degrees, or null when the order cannot form. */
export function braggTwoThetaDeg(dNm: number, wavelengthNm: number, order = 1): number | null {
  const s = (order * wavelengthNm) / (2 * dNm)
  if (!(s >= 0) || s > 1) return null
  return (2 * Math.asin(s)) / DEG
}

/**
 * Atomic scattering factor of nickel, f(s) = Σ aᵢ exp(−bᵢ s²) + c with s = sin θ / λ
 * in Å⁻¹ — the Cromer–Mann fit from the International Tables for Crystallography,
 * vol. C, table 6.1.1.4. f(0) = 28, the atomic number, as it must.
 */
const NI_CROMER_MANN = {
  a: [12.8376, 7.292, 4.4438, 2.38],
  b: [3.8785, 0.2565, 12.1763, 66.3421],
  c: 1.0341,
} as const

export function nickelFormFactor(sinThetaOverLambdaPerAngstrom: number): number {
  const s2 = sinThetaOverLambdaPerAngstrom * sinThetaOverLambdaPerAngstrom
  let f = NI_CROMER_MANN.c
  for (let i = 0; i < 4; i++) f += NI_CROMER_MANN.a[i] * Math.exp(-NI_CROMER_MANN.b[i] * s2)
  return f
}

export type XrayPeak = {
  hkl: readonly [number, number, number]
  label: string
  dNm: number
  twoThetaDeg: number
  /** Relative to the strongest line in this pattern (= 1). */
  intensity: number
}

/**
 * The powder-diffraction lines of nickel at wavelength λ: positions from Bragg's
 * law on d_hkl, relative intensities from multiplicity × |f|² × the
 * Lorentz–polarisation factor (1 + cos² 2θ) / (sin² θ cos θ). No temperature
 * factor and no absorption, which is why the weak high-angle lines come out a
 * little strong compared with a measured card — the positions are exact.
 */
export function xrayPowderPeaks(
  wavelengthNm: number,
  latticeNm = NI_LATTICE_CONSTANT_NM
): XrayPeak[] {
  const peaks: XrayPeak[] = []
  for (const r of FCC_REFLECTIONS) {
    const [h, k, l] = r.hkl
    const d = cubicPlaneSpacingNm(latticeNm, h, k, l)
    const twoTheta = braggTwoThetaDeg(d, wavelengthNm)
    if (twoTheta === null) continue
    const theta = (twoTheta / 2) * DEG
    const s = Math.sin(theta) / (wavelengthNm * 10) // Å⁻¹
    const f = nickelFormFactor(s)
    const lp = (1 + Math.cos(2 * theta) ** 2) / (Math.sin(theta) ** 2 * Math.cos(theta))
    peaks.push({
      hkl: r.hkl,
      label: `(${h}${k}${l})`,
      dNm: d,
      twoThetaDeg: twoTheta,
      intensity: r.multiplicity * f * f * lp,
    })
  }
  const top = peaks.reduce((m, p) => Math.max(m, p.intensity), 0)
  if (top > 0) for (const p of peaks) p.intensity /= top
  return peaks
}

/**
 * The powder pattern as a curve: each line a Lorentzian of full width
 * `widthDeg` (an instrument width — a well-annealed metal gives lines a few
 * tenths of a degree wide on a laboratory diffractometer).
 */
export function xrayPattern(
  peaks: readonly XrayPeak[],
  twoThetaDeg: number,
  widthDeg = 0.7
): number {
  const hw = widthDeg / 2
  let y = 0
  for (const p of peaks) {
    const dx = (twoThetaDeg - p.twoThetaDeg) / hw
    y += p.intensity / (1 + dx * dx)
  }
  return y
}

/** Cu Kα₁, the wavelength almost every published metal powder pattern is taken with. */
export const CU_K_ALPHA_NM = 0.154056
