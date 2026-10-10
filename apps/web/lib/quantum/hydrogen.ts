/**
 * lib/quantum/hydrogen.ts — the analytic hydrogen atom.
 *
 * Everything the /visualizations/hydrogen-atom page draws comes from here, and
 * nothing here knows about the DOM: the orbitals are closed-form solutions of
 * the Coulomb problem, evaluated exactly, so the point cloud on screen is a
 * sample of the real |ψ|² rather than an artist's impression of one.
 *
 * UNITS. Lengths are in Bohr radii (a₀ = 1) — the natural unit for this
 * problem, and the one every textbook formula below is quoted in. Energies are
 * in electron-volts. Wavelengths are in nanometres, in VACUUM (a hydrogen lamp
 * in a teaching lab is usually quoted in air, which is shorter by a factor of
 * about 1.000277: 656.46 nm vacuum is the familiar 656.28 nm air line).
 *
 * WHY REAL SPHERICAL HARMONICS. The complex Y_l^m are eigenstates of L_z, but
 * |Y_l^m|² has no φ dependence at all, so every m ≠ 0 orbital would render as
 * the same featureless doughnut and the whole point of the picture would be
 * lost. The real combinations used here — (Y_l^{+m} ± Y_l^{-m})/√2 up to a
 * phase — are the ones chemistry draws (p_x, p_y, p_z, d_xy, …). They are
 * still orthonormal, still eigenstates of L² with the same l, and still have
 * exactly l angular nodes; they simply are not eigenstates of L_z. That is a
 * real physical trade and the page says so.
 *
 * The reference for every formula here is Griffiths, *Introduction to Quantum
 * Mechanics*, §4.2. The unit tests check the output against independent
 * analytic results (the closed forms for the first few R_nl, ⟨r⟩ = (3n² −
 * l(l+1))/2, ⟨1/r⟩ = 1/n², node counts, and laboratory line wavelengths from
 * NIST) rather than against this file's own output.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** The Bohr radius a₀, in nanometres (CODATA 2018). */
export const BOHR_RADIUS_NM = 0.0529177210903

/** hc, in eV·nm — converts a photon energy in eV to a wavelength in nm. */
export const HC_EV_NM = 1239.8419843320026

/**
 * The Rydberg constant FOR HYDROGEN, in inverse metres (CODATA 2018).
 *
 * Not R_∞ (1.0973731568e7). R_H carries the reduced-mass correction for a
 * proton of finite mass, and it is the difference between predicting the Balmer
 * α line at 656.47 nm (right, to four figures) and at 656.11 nm (visibly wrong
 * against a lab spectrum).
 */
export const RYDBERG_H_INV_M = 1.0967758e7

/** R_H expressed in inverse nanometres, which is what the formulas below want. */
const RYDBERG_H_INV_NM = RYDBERG_H_INV_M * 1e-9

/**
 * The hydrogen ionization energy hcR_H in eV — 13.5984, the "13.6 eV" of every
 * textbook. Derived from R_H rather than typed in, so the energies and the
 * wavelengths on this page can never disagree with each other.
 */
export const IONIZATION_ENERGY_EV = HC_EV_NM * RYDBERG_H_INV_NM

/** Largest principal quantum number the page offers. */
export const MAX_N = 6

// ─────────────────────────────────────────────────────────────────────────────
// Small numerical helpers
// ─────────────────────────────────────────────────────────────────────────────

const LN_FACTORIAL: number[] = [0]

/**
 * ln(k!) by cached summation.
 *
 * Logs rather than factorials because the radial normalisation needs
 * (n+l)! — 11! at n = 6 is fine in a double, but (n+l)! overflows exact integer
 * precision by n ≈ 10 and the ratio (n−l−1)!/(n+l)! is far better behaved as a
 * difference of logs anyway.
 */
function lnFactorial(k: number): number {
  if (!Number.isInteger(k) || k < 0) return NaN
  for (let i = LN_FACTORIAL.length; i <= k; i++) {
    LN_FACTORIAL[i] = LN_FACTORIAL[i - 1] + Math.log(i)
  }
  return LN_FACTORIAL[k]
}

/** Throws unless (n, l, m) is a legal hydrogen state. */
export function assertQuantumNumbers(n: number, l: number, m: number): void {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n must be a positive integer, got ${n}`)
  if (!Number.isInteger(l) || l < 0 || l > n - 1) {
    throw new Error(`l must be an integer in [0, n-1] = [0, ${n - 1}], got ${l}`)
  }
  if (!Number.isInteger(m) || Math.abs(m) > l) {
    throw new Error(`m must be an integer in [-l, l] = [${-l}, ${l}], got ${m}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Special functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The associated Laguerre polynomial L_k^α(x), by the stable three-term
 * recurrence
 *
 *   (k+1)·L_{k+1}^α(x) = (2k+1+α−x)·L_k^α(x) − (k+α)·L_{k−1}^α(x)
 *
 * starting from L_0^α = 1 and L_1^α = 1 + α − x.
 *
 * Note the convention: this is the polynomial of degree k with the *upper*
 * index α, the one that appears in Griffiths eq. 4.88. Some references (and
 * Mathematica's `LaguerreL[n, a, x]` is one of them, up to the same convention)
 * agree; others use the "generalised" L_{k+α}^α which differs by a factorial.
 * Get this wrong and the radial function is off by a constant, which the
 * normalisation test catches immediately.
 */
export function associatedLaguerre(k: number, alpha: number, x: number): number {
  if (k < 0) return 0
  if (k === 0) return 1
  let prev = 1
  let cur = 1 + alpha - x
  for (let i = 1; i < k; i++) {
    const next = ((2 * i + 1 + alpha - x) * cur - (i + alpha) * prev) / (i + 1)
    prev = cur
    cur = next
  }
  return cur
}

/**
 * The associated Legendre function P_l^m(x) for m ≥ 0, |x| ≤ 1, WITHOUT the
 * Condon–Shortley phase (−1)^m.
 *
 * Dropping the phase is the convention real spherical harmonics are normally
 * quoted in, and it means P_l^l(x) = (2l−1)!!·(1−x²)^{l/2} is positive, so the
 * lobe signs the page colours are the familiar ones (the +x lobe of p_x really
 * is the positive one). It cannot change any probability density.
 */
export function associatedLegendre(l: number, m: number, x: number): number {
  if (m < 0 || m > l || l < 0) return 0
  // P_m^m = (2m−1)!!·(1−x²)^{m/2}
  let pmm = 1
  if (m > 0) {
    const somx2 = Math.sqrt(Math.max(0, (1 - x) * (1 + x)))
    let fact = 1
    for (let i = 1; i <= m; i++) {
      pmm *= fact * somx2
      fact += 2
    }
  }
  if (l === m) return pmm

  let pmmp1 = x * (2 * m + 1) * pmm
  if (l === m + 1) return pmmp1

  let pll = 0
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmmp1 - (ll + m - 1) * pmm) / (ll - m)
    pmm = pmmp1
    pmmp1 = pll
  }
  return pll
}

/**
 * The real spherical harmonic Y_{l,m}(θ, φ), orthonormal over the sphere:
 *
 *   m = 0  →  N_l0 · P_l(cos θ)
 *   m > 0  →  √2 · N_lm · P_l^m(cos θ) · cos(mφ)
 *   m < 0  →  √2 · N_l|m| · P_l^|m|(cos θ) · sin(|m|φ)
 *
 * with N_lm = √[(2l+1)(l−m)! / (4π(l+m)!)]. θ is the polar angle from +z, φ the
 * azimuth from +x. Returns a real number whose SIGN is physical: it is the sign
 * of the wavefunction's lobe, and adjacent lobes of opposite sign are what an
 * angular node separates.
 */
export function realSphericalHarmonic(l: number, m: number, theta: number, phi: number): number {
  const am = Math.abs(m)
  if (l < 0 || am > l) return 0
  const norm = Math.sqrt(
    ((2 * l + 1) / (4 * Math.PI)) * Math.exp(lnFactorial(l - am) - lnFactorial(l + am))
  )
  const p = associatedLegendre(l, am, Math.cos(theta))
  if (m === 0) return norm * p
  const azimuthal = m > 0 ? Math.cos(am * phi) : Math.sin(am * phi)
  return Math.SQRT2 * norm * p * azimuthal
}

// ─────────────────────────────────────────────────────────────────────────────
// The wavefunction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The radial wavefunction R_nl(r), with r in Bohr radii:
 *
 *   R_nl(r) = √[ (2/n)³ · (n−l−1)! / (2n·(n+l)!) ] · e^{−ρ/2} · ρ^l · L_{n−l−1}^{2l+1}(ρ)
 *   ρ = 2r/n
 *
 * Normalised so that ∫₀^∞ R_nl(r)² r² dr = 1.
 */
export function radialWavefunction(n: number, l: number, r: number): number {
  if (!Number.isInteger(n) || n < 1) return NaN
  if (!Number.isInteger(l) || l < 0 || l > n - 1) return NaN
  if (r < 0) return NaN
  const rho = (2 * r) / n
  const lnNorm =
    1.5 * Math.log(2 / n) +
    0.5 * (lnFactorial(n - l - 1) - Math.log(2 * n) - lnFactorial(n + l))
  const poly = associatedLaguerre(n - l - 1, 2 * l + 1, rho)
  // rho^l is 0^0 = 1 at the origin for l = 0, which is what Math.pow gives.
  return Math.exp(lnNorm - rho / 2) * Math.pow(rho, l) * poly
}

/**
 * The radial probability density P(r) = r²·R_nl(r)², i.e. the probability per
 * unit radius of finding the electron in a thin shell at r. This — not R² —
 * is the curve whose peak sits at n²a₀ for a circular orbit (l = n−1), and it
 * is the distribution the point cloud's radii are drawn from.
 */
export function radialProbabilityDensity(n: number, l: number, r: number): number {
  const R = radialWavefunction(n, l, r)
  return r * r * R * R
}

/**
 * ψ_{n,l,m}(r, θ, φ) = R_nl(r) · Y_{l,m}(θ, φ), real-valued, normalised over
 * all space. r is in Bohr radii.
 */
export function psi(
  n: number,
  l: number,
  m: number,
  r: number,
  theta: number,
  phi: number
): number {
  return radialWavefunction(n, l, r) * realSphericalHarmonic(l, m, theta, phi)
}

/** |ψ|² — the probability density per unit volume. */
export function probabilityDensity(
  n: number,
  l: number,
  m: number,
  r: number,
  theta: number,
  phi: number
): number {
  const v = psi(n, l, m, r, theta, phi)
  return v * v
}

/** Radial nodes: spherical shells where ψ = 0. There are n − l − 1 of them. */
export function radialNodeCount(n: number, l: number): number {
  return n - l - 1
}

/** Angular nodes: planes and cones where ψ = 0. There are exactly l of them. */
export function angularNodeCount(l: number): number {
  return l
}

/** Total nodal surfaces, always n − 1 regardless of how l splits them. */
export function totalNodeCount(n: number): number {
  return n - 1
}

/**
 * The analytic expectation value ⟨r⟩ = ½·(3n² − l(l+1)) a₀.
 *
 * Worth noticing on the page: it depends on l, so 3s, 3p and 3d are *not* the
 * same size even though they have exactly the same energy.
 */
export function expectedRadius(n: number, l: number): number {
  return 0.5 * (3 * n * n - l * (l + 1))
}

/** The Bohr-model orbit radius r_n = n²a₀, in Bohr radii. */
export function bohrRadiusOfOrbit(n: number): number {
  return n * n
}

// ─────────────────────────────────────────────────────────────────────────────
// Energies and spectra
// ─────────────────────────────────────────────────────────────────────────────

/** E_n = −13.6 eV / n². Bohr and Schrödinger agree on this exactly. */
export function energyEv(n: number): number {
  return -IONIZATION_ENERGY_EV / (n * n)
}

/** Energy of the photon emitted in n_i → n_f, in eV. Positive for emission. */
export function transitionEnergyEv(nInitial: number, nFinal: number): number {
  return energyEv(nInitial) - energyEv(nFinal)
}

/**
 * Vacuum wavelength of the n_i → n_f line, in nanometres, from the Rydberg
 * formula 1/λ = R_H(1/n_f² − 1/n_i²).
 */
export function transitionWavelengthNm(nInitial: number, nFinal: number): number {
  if (nInitial <= nFinal) return NaN
  const inverse = RYDBERG_H_INV_NM * (1 / (nFinal * nFinal) - 1 / (nInitial * nInitial))
  return 1 / inverse
}

export type SpectralRegion = 'ultraviolet' | 'visible' | 'infrared'

export type SpectralSeries = {
  /** The lower level every line in the series lands on. */
  nFinal: number
  name: string
  region: SpectralRegion
  /** Discovered/observed-by note, for the page copy. */
  note: string
}

/**
 * The named series. Balmer is the one a reader has probably seen: it is the
 * only series that lands in the visible, which is a historical accident of
 * where n = 2 happens to sit, not a fact about hydrogen.
 */
export const SPECTRAL_SERIES: readonly SpectralSeries[] = [
  {
    nFinal: 1,
    name: 'Lyman',
    region: 'ultraviolet',
    note: 'Every line lands in the far ultraviolet — invisible to the eye, and absorbed by air.',
  },
  {
    nFinal: 2,
    name: 'Balmer',
    region: 'visible',
    note: 'The four lines you see in a hydrogen discharge tube, and the only series in the visible.',
  },
  {
    nFinal: 3,
    name: 'Paschen',
    region: 'infrared',
    note: 'Infrared. Real, measurable, and completely invisible.',
  },
  {
    nFinal: 4,
    name: 'Brackett',
    region: 'infrared',
    note: 'Deeper infrared still; used to trace hydrogen through interstellar dust.',
  },
] as const

/** The Balmer line's Greek letter: n_i = 3 is α, 4 is β, and so on. */
const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ'] as const

/** e.g. `Balmer α` for 3 → 2, or `null` if the transition starts no series. */
export function lineName(nInitial: number, nFinal: number): string | null {
  const series = SPECTRAL_SERIES.find((s) => s.nFinal === nFinal)
  if (!series) return null
  const index = nInitial - nFinal - 1
  if (index < 0 || index >= GREEK.length) return series.name
  return `${series.name} ${GREEK[index]}`
}

/** The visible band, in nanometres — the range the spectrum strip renders. */
export const VISIBLE_MIN_NM = 380
export const VISIBLE_MAX_NM = 750

export function isVisible(wavelengthNm: number): boolean {
  return wavelengthNm >= VISIBLE_MIN_NM && wavelengthNm <= VISIBLE_MAX_NM
}

export function regionOf(wavelengthNm: number): SpectralRegion {
  if (wavelengthNm < VISIBLE_MIN_NM) return 'ultraviolet'
  if (wavelengthNm > VISIBLE_MAX_NM) return 'infrared'
  return 'visible'
}

export type EmissionLine = {
  nInitial: number
  nFinal: number
  wavelengthNm: number
  photonEv: number
  name: string
  region: SpectralRegion
}

/** Every line of a series from n_f+1 up to (and including) `maxInitial`. */
export function seriesLines(nFinal: number, maxInitial: number): EmissionLine[] {
  const out: EmissionLine[] = []
  for (let ni = nFinal + 1; ni <= maxInitial; ni++) {
    const wavelengthNm = transitionWavelengthNm(ni, nFinal)
    out.push({
      nInitial: ni,
      nFinal,
      wavelengthNm,
      photonEv: transitionEnergyEv(ni, nFinal),
      name: lineName(ni, nFinal) ?? `${ni} → ${nFinal}`,
      region: regionOf(wavelengthNm),
    })
  }
  return out
}

/** The series limit: where the lines pile up as n_i → ∞. */
export function seriesLimitNm(nFinal: number): number {
  return 1 / (RYDBERG_H_INV_NM / (nFinal * nFinal))
}

/*
 * Wavelength → colour used to live here as a second copy of Dan Bruton's fit.
 * It has moved to lib/viz/spectralColor.ts, which is the one implementation the
 * whole app now shares — import `wavelengthToCss` from there.
 *
 * The two copies had drifted: this one ran the red band out to 780 nm while
 * spectralColor stops at 750, so the same deep-red line rendered red on the
 * hydrogen spectrum strip and pure black on the blackbody curve. 750 nm won,
 * because it is the edge `VISIBLE_MAX_NM` above already uses — this file was
 * calling 760 nm "infrared" in `regionOf` and painting it red in the same
 * breath. They also disagreed on scale (0–255 here, 0–1 there) behind
 * identical signatures, which is a bug that typechecks.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Naming
// ─────────────────────────────────────────────────────────────────────────────

export const SUBSHELL_LETTERS = ['s', 'p', 'd', 'f', 'g', 'h'] as const

/** `l` → its spectroscopic letter, falling back to `l=<n>` past h. */
export function subshellLetter(l: number): string {
  return SUBSHELL_LETTERS[l] ?? `l=${l}`
}

/**
 * The chemistry name for a real orbital, split so the page can render the
 * subscript properly: `{ shell: '3d', sub: 'xy' }`.
 */
export function orbitalName(n: number, l: number, m: number): { shell: string; sub: string } {
  const shell = `${n}${subshellLetter(l)}`
  const table = new Map<string, string>([
    ['0,0', ''],
    ['1,0', 'z'],
    ['1,1', 'x'],
    ['1,-1', 'y'],
    ['2,0', 'z²'],
    ['2,1', 'xz'],
    ['2,-1', 'yz'],
    ['2,2', 'x²−y²'],
    ['2,-2', 'xy'],
    ['3,0', 'z³'],
    ['3,1', 'xz²'],
    ['3,-1', 'yz²'],
    ['3,2', 'z(x²−y²)'],
    ['3,-2', 'xyz'],
    ['3,3', 'x(x²−3y²)'],
    ['3,-3', 'y(3x²−y²)'],
  ])
  const sub = table.get(`${l},${m}`)
  return { shell, sub: sub === undefined ? `m=${m}` : sub }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sampling |ψ|² for the point cloud
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A small, fast, seeded PRNG (mulberry32). Seeded so the cloud is reproducible:
 * the same orbital renders the same twice, and the sampling tests are
 * deterministic rather than flaky at the third decimal place.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RadialSampler {
  readonly n: number
  readonly l: number
  /** Upper end of the tabulated grid, in Bohr radii. */
  readonly rMax: number
  /** Inverse CDF. `quantile(u)` for u ∈ [0, 1] returns a radius. */
  quantile(u: number): number
  /** ⟨r⟩ computed from the tabulated distribution (checked against theory). */
  meanRadius(): number
}

/**
 * Tabulate P(r) = r²R_nl(r)² and invert its CDF.
 *
 * Inverse-transform sampling rather than rejection: the radial distribution is
 * strongly peaked and its shape changes a lot with n, so a rejection envelope
 * would either be loose (slow) or need tuning per orbital. One 4096-point
 * tabulation is built per orbital and then every sample is a binary search.
 *
 * The grid runs to n(n+15) a₀, comfortably past the point where the e^{−2r/n}
 * tail has died: the CDF is renormalised to the tabulated total, so any
 * truncation error shows up directly as a shift in ⟨r⟩, which the tests pin to
 * the analytic ½(3n² − l(l+1)).
 */
export function makeRadialSampler(n: number, l: number, gridPoints = 4096): RadialSampler {
  const rMax = n * (n + 15)
  const dr = rMax / gridPoints
  const cdf = new Float64Array(gridPoints + 1)
  let total = 0
  let weightedR = 0
  let prev = 0 // P(0) = 0 for every orbital
  for (let i = 1; i <= gridPoints; i++) {
    const r = i * dr
    const p = radialProbabilityDensity(n, l, r)
    const slice = ((prev + p) / 2) * dr
    total += slice
    weightedR += slice * (r - dr / 2)
    cdf[i] = total
    prev = p
  }
  const mean = total > 0 ? weightedR / total : 0
  if (total > 0) for (let i = 0; i <= gridPoints; i++) cdf[i] /= total

  return {
    n,
    l,
    rMax,
    meanRadius: () => mean,
    quantile(u: number): number {
      const target = Math.min(1, Math.max(0, u))
      // Binary search for the first index whose cumulative probability ≥ target.
      let lo = 0
      let hi = gridPoints
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cdf[mid] < target) lo = mid + 1
        else hi = mid
      }
      if (lo === 0) return 0
      const c0 = cdf[lo - 1]
      const c1 = cdf[lo]
      const frac = c1 > c0 ? (target - c0) / (c1 - c0) : 0
      return (lo - 1 + frac) * dr
    },
  }
}

/** Largest value of |Y_{l,m}|² anywhere on the sphere, found on a coarse grid. */
export function maxAngularDensity(l: number, m: number, steps = 96): number {
  let max = 0
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI
    for (let j = 0; j < steps; j++) {
      const phi = (j / steps) * 2 * Math.PI
      const y = realSphericalHarmonic(l, m, theta, phi)
      const d = y * y
      if (d > max) max = d
    }
  }
  // A 1% cushion: the grid can miss the true maximum by a hair, and an envelope
  // that is slightly too LOW silently truncates the brightest part of the lobe.
  return max * 1.01
}

export interface OrbitalCloud {
  /** xyz triples in Bohr radii, `count` points long. */
  positions: Float32Array
  /** Sign of ψ at each point: +1 or −1. This is what colours the lobes. */
  signs: Int8Array
  count: number
  /** Radius containing 98% of the probability — the natural framing distance. */
  extent: number
}

/**
 * Draw `count` independent samples from |ψ_{n,l,m}|² dV.
 *
 * Separable, because ψ is: the radius comes from the tabulated radial CDF, and
 * the direction from rejection sampling against |Y_{l,m}|² with cos θ uniform
 * on [−1, 1] (which is what makes the *solid angle* uniform — sampling θ
 * uniformly instead would crowd the poles, and every orbital would sprout two
 * fake tufts along z).
 *
 * Acceptance is at worst ~1/(2l+1)-ish, so even 3d at 60k points is a few
 * milliseconds. The loop is capped so a pathological envelope can never hang
 * the render thread.
 */
export function sampleOrbitalCloud(
  n: number,
  l: number,
  m: number,
  count: number,
  seed = 1
): OrbitalCloud {
  assertQuantumNumbers(n, l, m)
  const rng = mulberry32(seed)
  const sampler = makeRadialSampler(n, l)
  const envelope = maxAngularDensity(l, m)
  const positions = new Float32Array(count * 3)
  const signs = new Int8Array(count)

  for (let i = 0; i < count; i++) {
    const r = sampler.quantile(rng())

    let theta = 0
    let phi = 0
    let y = 0
    for (let attempt = 0; attempt < 512; attempt++) {
      const cosTheta = 2 * rng() - 1
      phi = rng() * 2 * Math.PI
      theta = Math.acos(Math.min(1, Math.max(-1, cosTheta)))
      y = realSphericalHarmonic(l, m, theta, phi)
      if (rng() * envelope <= y * y) break
    }

    const sinTheta = Math.sin(theta)
    positions[i * 3] = r * sinTheta * Math.cos(phi)
    positions[i * 3 + 1] = r * sinTheta * Math.sin(phi)
    positions[i * 3 + 2] = r * Math.cos(theta)
    const radial = radialWavefunction(n, l, r)
    signs[i] = radial * y >= 0 ? 1 : -1
  }

  return { positions, signs, count, extent: sampler.quantile(0.98) }
}
