/**
 * lib/quantum/alphaDecay.ts — the Gamow model of alpha decay, plus the two things
 * /visualizations/alpha-decay draws next to it: a scaled Schrödinger eigenstate that
 * leaks through the same barrier, and the scanning-tunnelling-microscope current law.
 *
 * THE MODEL (Gamow 1928; Gurney & Condon, independently, the same year). An alpha particle
 * is assumed to exist, preformed, inside a nuclear well of radius R. Outside R it feels only
 * the Coulomb repulsion of the daughter nucleus, V(r) = 2·Z_d·e²/(4πε₀ r), which is higher
 * than the alpha's energy Q all the way out to the classical turning point b = 2Z_d e²/(4πε₀Q).
 * Classically it can never leave. Quantum mechanically it tunnels with probability
 *
 *     T = exp(−G),   G = (2/ħ) ∫_R^b √(2μ (V(r) − Q)) dr
 *
 * which for a 1/r barrier integrates in closed form (see gamowFactor). The decay constant is
 * the number of times per second the alpha hits the wall, f = v_in / 2R, times T; the
 * half-life is ln2 / (f·T).
 *
 * Every unit in this file is nuclear: energies in MeV, lengths in fm, times in seconds. The
 * scaled display model at the bottom is the one exception — it hands a potential to the
 * ħ = m = 1 engine in ./schrodinger.ts and gets an eigenfunction back.
 *
 * WHAT THE MODEL GETS RIGHT AND WRONG. G is enormous — 30 to 90 — so a few percent change in
 * G is a factor of e or more in the half-life. That is the Geiger–Nuttall law: the nine
 * nuclides below span 24 orders of magnitude in half-life on a factor of two in Q. The model reproduces that slope
 * essentially exactly. What it cannot do is the absolute value to better than about an order
 * of magnitude: the nuclear radius is not a sharp number, the alpha is not really preformed
 * with probability 1, and near closed shells (Po-210, whose 126 neutrons fill a shell) the
 * preformation factor drops by a further 10–30×. The tests pin exactly that: within 10× for
 * every nuclide, and the ORDER of the half-lives — 24 orders of magnitude of it — preserved.
 */

import { boxGrid, hamiltonianTridiagonal, type Grid } from './schrodinger'

// ─────────────────────────────────────────────────────────────────────────────
// Constants (CODATA 2018), nuclear units
// ─────────────────────────────────────────────────────────────────────────────

/** ħc in MeV·fm. */
export const HBAR_C_MEV_FM = 197.3269804
/** e²/(4πε₀) in MeV·fm — the Coulomb constant in the units that make V(r) = Z₁Z₂·this/r. */
export const COULOMB_MEV_FM = 1.4399645
/** Alpha-particle rest energy, MeV. */
export const ALPHA_MASS_MEV = 3727.3794
/** Atomic mass unit, MeV. Daughter masses are taken as A_d × this — good to 0.1%. */
export const AMU_MEV = 931.49410242
/** Speed of light in fm/s. */
export const C_FM_PER_S = 2.99792458e23
/** Fine-structure constant, for the Sommerfeld cross-check in the tests. */
export const FINE_STRUCTURE = COULOMB_MEV_FM / HBAR_C_MEV_FM

const JULIAN_YEAR_S = 365.25 * 86400

// ─────────────────────────────────────────────────────────────────────────────
// Real nuclides
// ─────────────────────────────────────────────────────────────────────────────

export type Nuclide = {
  /** Stable id, e.g. 'U-238'. */
  id: string
  /** Chemical symbol of the parent. */
  symbol: string
  element: string
  /** Proton number of the PARENT. The daughter has Z − 2. */
  Z: number
  /** Mass number of the parent. The daughter has A − 4. */
  A: number
  /** Alpha-decay Q value, MeV (ground state to ground state). */
  q: number
  /** Measured half-life in seconds. */
  halfLifeS: number
  /** The measured half-life as it is usually quoted. */
  halfLifeLabel: string
  /** One of the four the page leads with; the rest are extras for the plot. */
  featured: boolean
}

/**
 * Q values from the 2020 Atomic Mass Evaluation (ground-state to ground-state alpha
 * separation energies), half-lives from the ENSDF / Nubase 2020 adopted values, both rounded
 * to the precision a page can use. Nothing here is fitted.
 */
export const NUCLIDES: readonly Nuclide[] = [
  {
    id: 'U-238',
    symbol: 'U',
    element: 'Uranium',
    Z: 92,
    A: 238,
    q: 4.27,
    halfLifeS: 4.468e9 * JULIAN_YEAR_S,
    halfLifeLabel: '4.47 billion years',
    featured: true,
  },
  {
    id: 'Ra-226',
    symbol: 'Ra',
    element: 'Radium',
    Z: 88,
    A: 226,
    q: 4.8706,
    halfLifeS: 1600 * JULIAN_YEAR_S,
    halfLifeLabel: '1,600 years',
    featured: true,
  },
  {
    id: 'Po-210',
    symbol: 'Po',
    element: 'Polonium',
    Z: 84,
    A: 210,
    q: 5.4075,
    halfLifeS: 138.376 * 86400,
    halfLifeLabel: '138.4 days',
    featured: true,
  },
  {
    id: 'Po-212',
    symbol: 'Po',
    element: 'Polonium',
    Z: 84,
    A: 212,
    q: 8.9542,
    halfLifeS: 0.299e-6,
    halfLifeLabel: '0.30 microseconds',
    featured: true,
  },
  {
    id: 'Th-232',
    symbol: 'Th',
    element: 'Thorium',
    Z: 90,
    A: 232,
    q: 4.0816,
    halfLifeS: 1.405e10 * JULIAN_YEAR_S,
    halfLifeLabel: '14.1 billion years',
    featured: false,
  },
  {
    id: 'Pu-239',
    symbol: 'Pu',
    element: 'Plutonium',
    Z: 94,
    A: 239,
    q: 5.2445,
    halfLifeS: 24110 * JULIAN_YEAR_S,
    halfLifeLabel: '24,110 years',
    featured: false,
  },
  {
    id: 'Rn-222',
    symbol: 'Rn',
    element: 'Radon',
    Z: 86,
    A: 222,
    q: 5.5904,
    halfLifeS: 3.8235 * 86400,
    halfLifeLabel: '3.82 days',
    featured: false,
  },
  {
    id: 'Po-218',
    symbol: 'Po',
    element: 'Polonium',
    Z: 84,
    A: 218,
    q: 6.1147,
    halfLifeS: 3.098 * 60,
    halfLifeLabel: '3.10 minutes',
    featured: false,
  },
  {
    id: 'Po-214',
    symbol: 'Po',
    element: 'Polonium',
    Z: 84,
    A: 214,
    q: 7.8335,
    halfLifeS: 164.3e-6,
    halfLifeLabel: '164 microseconds',
    featured: false,
  },
]

export function nuclideById(id: string): Nuclide | undefined {
  return NUCLIDES.find((n) => n.id === id)
}

// ─────────────────────────────────────────────────────────────────────────────
// The Gamow model
// ─────────────────────────────────────────────────────────────────────────────

export type GamowInput = {
  /** Parent proton number. */
  Z: number
  /** Parent mass number. */
  A: number
  /** Alpha Q value, MeV. */
  q: number
  /** Radius parameter r₀ in R = r₀(A_d^{1/3} + 4^{1/3}) fm. Default DEFAULT_R0. */
  r0?: number
  /** Depth of the nuclear well the alpha rattles in, MeV. Sets the assault frequency. */
  wellDepth?: number
}

/**
 * The one fitted number in the model. R = r₀(A_d^{1/3} + 4^{1/3}) is the touching-spheres
 * radius; 1.1 fm is the low end of the usual 1.1–1.4 fm range and is what puts all nine
 * nuclides above within an order of magnitude at once. Slide it to 1.4 and every half-life
 * drops by four orders of magnitude — that sensitivity is the lesson, not a bug.
 */
export const DEFAULT_R0 = 1.1
/** A typical depth for the alpha-nucleus well, MeV. Only the assault frequency sees it. */
export const DEFAULT_WELL_DEPTH = 35

export type GamowResult = {
  /** Daughter proton number. */
  Zd: number
  /** Reduced mass of the alpha–daughter pair, MeV. */
  mu: number
  /** Nuclear radius R, fm. */
  R: number
  /** Classical turning point b = 2Z_d e²/(4πε₀Q), fm. */
  b: number
  /** Height of the barrier at the nuclear surface, V(R), MeV. */
  barrierTop: number
  /** The Gamow exponent G. T = e^{−G}. */
  G: number
  /** Transmission probability per assault. */
  transmission: number
  /** Assaults on the wall per second, f = v_in / 2R. */
  frequency: number
  /** λ = f·T, per second. */
  decayConstant: number
  /** ln2 / λ, seconds. */
  halfLifeS: number
}

/** R = r₀ (A_d^{1/3} + 4^{1/3}), fm. */
export function nuclearRadius(A: number, r0 = DEFAULT_R0): number {
  return r0 * (Math.cbrt(A - 4) + Math.cbrt(4))
}

/** V(r) = 2·Z_d·e²/(4πε₀ r) in MeV for r in fm. */
export function coulombPotential(Zd: number, r: number): number {
  return (2 * Zd * COULOMB_MEV_FM) / r
}

/** Where the Coulomb barrier drops to Q: b = 2·Z_d·e²/(4πε₀Q), fm. */
export function turningPoint(Zd: number, q: number): number {
  return (2 * Zd * COULOMB_MEV_FM) / q
}

/** Reduced mass of alpha + daughter, MeV. */
export function reducedMass(A: number): number {
  const md = (A - 4) * AMU_MEV
  return (ALPHA_MASS_MEV * md) / (ALPHA_MASS_MEV + md)
}

/**
 * The dimensionless part of the Coulomb-barrier integral:
 *   ∫_R^b √(1/r − 1/b) dr = √b · [ arccos(√x) − √(x(1 − x)) ],  x = R/b.
 * At x → 0 it is π/2 (the Sommerfeld limit); at x = 1 it is 0 (no barrier left).
 */
export function gamowBracket(x: number): number {
  const c = Math.max(0, Math.min(1, x))
  return Math.acos(Math.sqrt(c)) - Math.sqrt(c * (1 - c))
}

/**
 * The Gamow exponent in closed form:
 *   G = (4 Z_d e²/(4πε₀)) · √(2μ) / (ħ √Q) · [arccos√x − √(x(1−x))].
 * Returns G = 0 when Q is already above the barrier top (x ≥ 1): nothing to tunnel through.
 */
export function gamowFactor(input: GamowInput): number {
  const { Z, A, q } = input
  const r0 = input.r0 ?? DEFAULT_R0
  if (!(q > 0)) return Infinity
  const Zd = Z - 2
  const R = nuclearRadius(A, r0)
  const b = turningPoint(Zd, q)
  if (R >= b) return 0
  const mu = reducedMass(A)
  return ((4 * Zd * COULOMB_MEV_FM * Math.sqrt(2 * mu)) / (HBAR_C_MEV_FM * Math.sqrt(q))) *
    gamowBracket(R / b)
}

/**
 * The same exponent by brute-force quadrature of (2/ħ)∫√(2μ(V − Q)) dr — an independent
 * route to the same number, used by the tests to check the closed form. Midpoint rule with
 * a √ substitution near b so the integrable singularity in the derivative does not cost
 * accuracy: with u² = b − r the integrand is smooth.
 */
export function gamowFactorNumeric(input: GamowInput, steps = 20000): number {
  const { Z, A, q } = input
  const r0 = input.r0 ?? DEFAULT_R0
  const Zd = Z - 2
  const R = nuclearRadius(A, r0)
  const b = turningPoint(Zd, q)
  if (R >= b) return 0
  const mu = reducedMass(A)
  // r = b − u², dr = −2u du, u from 0 to √(b − R).
  const uMax = Math.sqrt(b - R)
  const du = uMax / steps
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) * du
    const r = b - u * u
    const excess = coulombPotential(Zd, r) - q
    if (excess <= 0) continue
    sum += Math.sqrt(2 * mu * excess) * 2 * u * du
  }
  return (2 * sum) / HBAR_C_MEV_FM
}

/**
 * Assaults per second: the alpha's speed inside the well over the well's diameter. Inside,
 * its kinetic energy is Q + V₀ — it is moving much faster than the Q alone would suggest.
 * Around 10²¹ s⁻¹ for every nuclide here; the 24 orders of magnitude in half-life all come
 * from the exponent, not from this prefactor.
 */
export function assaultFrequency(input: GamowInput): number {
  const { A, q } = input
  const r0 = input.r0 ?? DEFAULT_R0
  const wellDepth = input.wellDepth ?? DEFAULT_WELL_DEPTH
  const mu = reducedMass(A)
  const R = nuclearRadius(A, r0)
  const beta = Math.sqrt((2 * (q + wellDepth)) / mu) // v/c, non-relativistic
  return (beta * C_FM_PER_S) / (2 * R)
}

/** The whole Gamow chain for one nucleus: G, T, f, λ and the half-life. */
export function predictDecay(input: GamowInput): GamowResult {
  const { Z, A, q } = input
  const r0 = input.r0 ?? DEFAULT_R0
  const Zd = Z - 2
  const mu = reducedMass(A)
  const R = nuclearRadius(A, r0)
  const b = turningPoint(Zd, q)
  const G = gamowFactor(input)
  const transmission = Math.exp(-G)
  const frequency = assaultFrequency(input)
  const decayConstant = frequency * transmission
  return {
    Zd,
    mu,
    R,
    b,
    barrierTop: coulombPotential(Zd, R),
    G,
    transmission,
    frequency,
    decayConstant,
    halfLifeS: Math.LN2 / decayConstant,
  }
}

/**
 * Generic WKB transmission for any 1-D barrier in the ħ = m = 1 units of ./schrodinger.ts:
 *   T = exp(−2 ∫ √(2(V(x) − E)) dx)  over the classically forbidden part of [x0, x1].
 * This is the approximation the Gamow factor IS; the tests hold it against the exact
 * rectangular-barrier result, where it must agree in the thick-barrier limit.
 */
export function wkbTransmission(
  potential: (x: number) => number,
  energy: number,
  x0: number,
  x1: number,
  steps = 4000
): number {
  const dx = (x1 - x0) / steps
  let integral = 0
  for (let i = 0; i < steps; i++) {
    const x = x0 + (i + 0.5) * dx
    const excess = potential(x) - energy
    if (excess > 0) integral += Math.sqrt(2 * excess) * dx
  }
  return Math.exp(-2 * integral)
}

/** The Geiger–Nuttall abscissa the page plots half-lives against: Z_d / √Q. */
export function geigerNuttallX(Zd: number, q: number): number {
  return Zd / Math.sqrt(q)
}

/** Ordinary least squares through (x, y) pairs. Needs at least two distinct x. */
export function fitLine(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx)
    sxy += (p.x - mx) * (p.y - my)
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

/** A half-life in seconds as people say it: "4.47 billion years", "164 μs". */
export function formatHalfLife(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const y = seconds / JULIAN_YEAR_S
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
  if (y >= 1e9) return `${fmt(y / 1e9)} billion years`
  if (y >= 1e6) return `${fmt(y / 1e6)} million years`
  if (y >= 1) return `${fmt(y)} years`
  const d = seconds / 86400
  if (d >= 1) return `${fmt(d)} days`
  const h = seconds / 3600
  if (h >= 1) return `${fmt(h)} hours`
  const m = seconds / 60
  if (m >= 1) return `${fmt(m)} minutes`
  if (seconds >= 1) return `${fmt(seconds)} s`
  if (seconds >= 1e-3) return `${fmt(seconds * 1e3)} ms`
  if (seconds >= 1e-6) return `${fmt(seconds * 1e6)} μs`
  if (seconds >= 1e-9) return `${fmt(seconds * 1e9)} ns`
  return `${seconds.toExponential(2)} s`
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanning tunnelling microscope
// ─────────────────────────────────────────────────────────────────────────────

/** ħ²/(2mₑ) in eV·Å²: 3.80998. So κ[Å⁻¹] = √(φ[eV] / 3.80998). */
export const HBAR2_OVER_2ME_EV_A2 = 3.8099821

/**
 * The decay constant of an electron's wavefunction in the vacuum gap, κ = √(2mₑφ)/ħ, in Å⁻¹
 * for a work function φ in eV. Around 1 Å⁻¹ for every metal, which is why STM works at all:
 * the current I ∝ e^{−2κd} changes by e^{2κ} ≈ 9× per ångström of tip height.
 */
export function stmKappa(workFunctionEv: number): number {
  return Math.sqrt(Math.max(0, workFunctionEv) / HBAR2_OVER_2ME_EV_A2)
}

/** I(d)/I(d + Δd) — the factor the current rises when the tip comes Δd closer. */
export function stmCurrentRatio(deltaAngstrom: number, workFunctionEv: number): number {
  return Math.exp(2 * stmKappa(workFunctionEv) * deltaAngstrom)
}

/** Tunnelling current relative to the current at gap d = 0 (arbitrary units). */
export function stmCurrent(gapAngstrom: number, workFunctionEv: number): number {
  return Math.exp(-2 * stmKappa(workFunctionEv) * Math.max(0, gapAngstrom))
}

// ─────────────────────────────────────────────────────────────────────────────
// The scaled Schrödinger picture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A real alpha wavefunction is 10¹⁹ times smaller outside the barrier than inside — nothing
 * a canvas can show. What the page draws instead is the stationary solution, at the alpha's
 * exact energy, of the same finite-difference Schrödinger equation ./schrodinger.ts solves
 * for every other tunnelling page, for a barrier with the SAME SHAPE (square well, then 1/r)
 * and the same R/b as the real nucleus, but with the Gamow exponent divided by
 * DISPLAY_G_SCALE so the leak is visible. The shape of the curve — oscillating inside,
 * dying through the barrier, small and oscillating again outside — is the real thing; only
 * the ratio of the amplitudes is scaled, and the page says by how much.
 *
 * HOW. The quasi-bound (Gamow) state is the solution that is purely OUTGOING beyond the
 * turning point b, which by the WKB connection formula means purely DECAYING through the
 * barrier — that is the solution whose amplitude falls by e^{−G/2} from R to b. Integrating
 * the three-term recurrence of the tridiagonal Hamiltonian INWARD from the far end is
 * numerically the stable direction for exactly that solution (the unwanted one shrinks
 * going inward), so a WKB start at the outer edge, u ∝ −k^{−½}sin(∫k dr − π/4), fixes the
 * outside phase and the barrier does the rest. Inside the well the recurrence continues down
 * to r = 0, where the s-wave condition u(0) = 0 must hold; the well depth is the one free
 * parameter and is tuned by bisection until it does. No eigensolve, no box, ~100 sweeps of
 * a 512-point grid.
 */
export const DISPLAY_G_SCALE = 14
/** The smallest exponent worth drawing: below this there is barely a barrier to leak through. */
export const DISPLAY_G_MIN = 3

export type DisplayModel = {
  grid: Grid
  potential: Float64Array
  /** The stationary wavefunction u(r) at `energy`, normalised to peak 1 inside the well. */
  psi: Float64Array
  /** R/b, as in the real nucleus. */
  x: number
  /** Nuclear radius in model units (always 1). */
  R: number
  /** Turning point in model units, 1/x. */
  b: number
  /** The well depth the tuning landed on. */
  wellDepth: number
  /** The Gamow exponent of the drawn barrier. */
  G: number
  /** The energy the wavefunction is computed at. */
  energy: number
  /** Height of the drawn barrier at r = R. */
  barrierTop: number
  /** Peak |u| inside the well over peak |u| beyond the turning point. */
  amplitudeRatio: number
  /** |u| at the implied wall r = 0, relative to the interior peak. ~0 when tuning succeeded. */
  originResidual: number
}

/** V = −depth for r < R, coulomb/r beyond, on a grid in units where R = 1. */
export function displayPotential(grid: Grid, depth: number, coulomb: number, R = 1): Float64Array {
  const v = new Float64Array(grid.n)
  for (let i = 0; i < grid.n; i++) {
    const r = grid.x[i]
    v[i] = r < R ? -depth : coulomb / r
  }
  return v
}

/** Peak |ψ| for r < R divided by peak |ψ| for r > b. Large for a quasi-bound state. */
export function amplitudeRatio(grid: Grid, psi: ArrayLike<number>, R: number, b: number): number {
  let inside = 0
  let outside = 0
  for (let i = 0; i < grid.n; i++) {
    const a = Math.abs(psi[i])
    if (grid.x[i] < R) inside = Math.max(inside, a)
    else if (grid.x[i] > b) outside = Math.max(outside, a)
  }
  return outside > 0 ? inside / outside : Infinity
}

/**
 * Solve (H − E)u = 0 on the grid by inward recurrence from a WKB outgoing-wave start, using
 * the same tridiagonal H the eigensolver builds. Returns u on the grid and the value the
 * recurrence predicts one site before the first grid point — the implied wall at r = 0,
 * which the s-wave solution must vanish at.
 */
export function shootInward(
  grid: Grid,
  potential: Float64Array,
  energy: number,
  turningPointModel: number
): { u: Float64Array; wall: number } {
  const { n, dx, x } = grid
  const { diagonal, offDiagonal } = hamiltonianTridiagonal(grid, potential)
  const e = offDiagonal[1] // constant −1/(2dx²)
  const u = new Float64Array(n)

  // WKB phase ∫_b^r k dr' accumulated outward from the turning point, for the start values.
  const phaseAt = (target: number): number => {
    let phase = 0
    const steps = 400
    const h = (target - turningPointModel) / steps
    for (let s = 0; s < steps; s++) {
      const r = turningPointModel + (s + 0.5) * h
      const k2 = 2 * (energy - potential[Math.min(n - 1, Math.max(0, Math.round((r - x[0]) / dx)))])
      phase += Math.sqrt(Math.max(0, k2)) * h
    }
    return phase
  }
  for (const i of [n - 1, n - 2]) {
    const k = Math.sqrt(Math.max(1e-9, 2 * (energy - potential[i])))
    // The WKB connection formula: the solution that GROWS going inward through the barrier
    // (large at R, small at b — the Gamow state) is −k^{−½} sin(∫k dr − π/4) outside. Its
    // partner, k^{−½} cos(…), is the one that decays inward and never reaches the well.
    u[i] = -Math.sin(phaseAt(x[i]) - Math.PI / 4) / Math.sqrt(k)
  }
  for (let i = n - 2; i >= 1; i--) {
    u[i - 1] = -((diagonal[i] - energy) * u[i] + e * u[i + 1]) / e
    // Keep the numbers in range: the solution grows by e^{G/2} through the barrier.
    if (Math.abs(u[i - 1]) > 1e100) {
      for (let j = i - 1; j < n; j++) u[j] *= 1e-100
    }
  }
  const wall = -((diagonal[0] - energy) * u[0] + e * u[1]) / e
  return { u, wall }
}

/**
 * Build the display model for a nucleus with R/b = x and real Gamow exponent G_real.
 *
 * In ħ = m = 1 units with R = 1 the barrier C/r − E has exponent
 *   G = 2√2 · √E / x · bracket(x)
 * so the energy follows from (G_display, x), and C = E/x puts the turning point at 1/x.
 * The well depth is then tuned so that u(0) = 0: scanning upward from a shallow well, the
 * first sign change of u(0) is the lowest quasi-bound level, and bisection pins it.
 */
export function buildDisplayModel(x: number, gReal: number, n = 512): DisplayModel {
  const xc = Math.max(0.03, Math.min(0.85, x))
  const G = Math.max(DISPLAY_G_MIN, gReal / DISPLAY_G_SCALE)
  const R = 1
  const b = R / xc
  const bracket = gamowBracket(xc)
  const sqrtE = (G * xc) / (2 * Math.SQRT2 * bracket)
  const energy = sqrtE * sqrtE
  const coulomb = energy * b // C = E·b, so V(b) = E exactly.
  const barrierTop = coulomb / R
  const outsideWavelength = (2 * Math.PI) / Math.sqrt(2 * energy)
  const length = Math.min(24, b + Math.max(0.8 * b, 0.75 * outsideWavelength))
  const grid = boxGrid(n, length)

  const wallAt = (depth: number): number => {
    const { u, wall } = shootInward(grid, displayPotential(grid, depth, coulomb, R), energy, b)
    let peak = 0
    for (let i = 0; i < grid.n && grid.x[i] < R; i++) peak = Math.max(peak, Math.abs(u[i]))
    return peak > 0 ? wall / peak : wall
  }

  // Scan for the first sign change of u(0) as the well deepens.
  let lo = 0.02
  let hi = 60
  let prev = wallAt(lo)
  let found = false
  for (let d = lo * 1.15; d <= hi; d *= 1.15) {
    const w = wallAt(d)
    if (Number.isFinite(w) && Number.isFinite(prev) && Math.sign(w) !== Math.sign(prev) && w !== 0) {
      hi = d
      found = true
      break
    }
    lo = d
    prev = w
  }
  if (found) {
    for (let iter = 0; iter < 40; iter++) {
      const mid = 0.5 * (lo + hi)
      const w = wallAt(mid)
      if (Math.sign(w) === Math.sign(prev)) {
        lo = mid
        prev = w
      } else hi = mid
    }
  }
  const wellDepth = found ? 0.5 * (lo + hi) : lo

  const potential = displayPotential(grid, wellDepth, coulomb, R)
  const { u, wall } = shootInward(grid, potential, energy, b)
  let peak = 0
  for (let i = 0; i < grid.n && grid.x[i] < R; i++) peak = Math.max(peak, Math.abs(u[i]))
  const scale = peak > 0 ? 1 / peak : 1
  const psi = new Float64Array(grid.n)
  for (let i = 0; i < grid.n; i++) psi[i] = u[i] * scale

  return {
    grid,
    potential,
    psi,
    x: xc,
    R,
    b,
    wellDepth,
    G,
    energy,
    barrierTop,
    amplitudeRatio: amplitudeRatio(grid, psi, R, b),
    originResidual: Math.abs(wall * scale),
  }
}
