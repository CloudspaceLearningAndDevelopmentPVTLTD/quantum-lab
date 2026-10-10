/**
 * lib/quantum/identicalParticles.ts — exchange symmetry for two particles in a 1-D well.
 *
 * Feeds /visualizations/identical-particles. The single-particle orbitals come from the
 * wave-1 Schrödinger engine (solveStationary on a hard-wall box); this module only builds
 * two-body products out of them, symmetrises or antisymmetrises the product, and reads off
 * the quantities the page quotes — norm, the density along x₁ = x₂, the separation
 * distribution, the mean square separation — plus the two "consequence" calculations: how
 * N non-interacting particles fill the levels of the well, and the Madelung filling order
 * that gives the periodic table its row lengths.
 *
 * UNITS: ħ = m = 1, as in schrodinger.ts. The infinite well of width L has
 * E_n = n²π²/(2L²); the page works in multiples of E₁.
 *
 * CONVENTIONS. A two-body amplitude is stored row-major on the n×n product grid:
 * `psi[i * n + j] = ψ(x_i, x_j)`, first index particle 1, second index particle 2. The
 * discrete normalisation is Σ|ψ|² dx² = 1, which is exactly what the continuum
 * ∫∫|ψ|² dx₁dx₂ = 1 becomes when the single-particle orbitals are orthonormal on the
 * grid (Σ φ_a φ_b dx = δ_ab) — and the eigenvectors of a symmetric tridiagonal matrix
 * are, so the two-body norm comes out at 1 without any renormalisation step. The tests
 * assert that; a rescale hidden in here would make the check meaningless.
 *
 * Everything is plain TypeScript with no DOM dependency so identicalParticles.test.ts can
 * check it in node against closed forms — including Griffiths' exchange-force result for
 * ⟨(x₁ − x₂)²⟩, which is the number that makes "bosons bunch, fermions repel" quantitative.
 */

import {
  boxGrid,
  solveStationary,
  zeroPotential,
  type Eigenstate,
  type Grid,
} from './schrodinger'

/** How the two particles are related. */
export type Statistics = 'distinguishable' | 'boson' | 'fermion'

// ─────────────────────────────────────────────────────────────────────────────
// Single-particle orbitals
// ─────────────────────────────────────────────────────────────────────────────

/** The closed-form infinite-well level, for the page to quote beside the solver's. */
export function analyticWellEnergy(n: number, length: number): number {
  return (n * n * Math.PI * Math.PI) / (2 * length * length)
}

/**
 * The lowest `count` orbitals of a hard-wall box of width `length`, on `points` interior
 * grid points. boxGrid puts the implied walls exactly at 0 and L, so the numbers the page
 * shows are for the box it says it is drawing.
 */
export function wellOrbitals(
  points: number,
  length: number,
  count: number
): { grid: Grid; states: Eigenstate[] } {
  const grid = boxGrid(points, length)
  const states = solveStationary(grid, zeroPotential(grid), count)
  return { grid, states }
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-body amplitudes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two-body amplitude for particle 1 in orbital φ_a and particle 2 in φ_b.
 *
 *   distinguishable  ψ(x₁,x₂) = φ_a(x₁)φ_b(x₂)
 *   boson            ψ(x₁,x₂) = [φ_a(x₁)φ_b(x₂) + φ_b(x₁)φ_a(x₂)] / √2      (a ≠ b)
 *   fermion          ψ(x₁,x₂) = [φ_a(x₁)φ_b(x₂) − φ_b(x₁)φ_a(x₂)] / √2      (a ≠ b)
 *
 * When a and b are the SAME orbital the symmetric combination is just φ_a(x₁)φ_a(x₂) —
 * already symmetric, norm 1 with no √2 — and the antisymmetric combination is
 * identically zero: there is no such state. That is the Pauli exclusion principle in
 * one line, and the function returns null for it rather than an array of zeros, so a
 * caller cannot draw "the fermion state" that does not exist.
 *
 * Exchange is exact in floating point. Swapping x₁ ↔ x₂ swaps the two products, and IEEE
 * addition and multiplication are commutative, so ψ(x₂,x₁) is bit-for-bit ±ψ(x₁,x₂), and
 * on the diagonal the fermion amplitude is φ_a(x)φ_b(x) − φ_b(x)φ_a(x) = exactly 0.
 */
export function twoBodyAmplitude(
  phiA: ArrayLike<number>,
  phiB: ArrayLike<number>,
  statistics: Statistics,
  sameOrbital = false
): Float64Array | null {
  const n = phiA.length
  if (phiB.length !== n) throw new RangeError('orbitals must share a grid')
  if (sameOrbital && statistics === 'fermion') return null
  const psi = new Float64Array(n * n)
  if (statistics === 'distinguishable' || sameOrbital) {
    for (let i = 0; i < n; i++) {
      const a = phiA[i]
      for (let j = 0; j < n; j++) psi[i * n + j] = a * phiB[j]
    }
    return psi
  }
  const sign = statistics === 'boson' ? 1 : -1
  const scale = Math.SQRT1_2
  for (let i = 0; i < n; i++) {
    const a1 = phiA[i]
    const b1 = phiB[i]
    for (let j = 0; j < n; j++) {
      const direct = a1 * phiB[j]
      const exchanged = b1 * phiA[j]
      psi[i * n + j] = scale * (direct + sign * exchanged)
    }
  }
  return psi
}

/** ψ with its two coordinates swapped: out[i,j] = psi[j,i]. */
export function exchangeCoordinates(psi: Float64Array, n: number): Float64Array {
  if (psi.length !== n * n) throw new RangeError('amplitude is not n×n')
  const out = new Float64Array(n * n)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = psi[j * n + i]
  return out
}

/** Σ|ψ|² dx². Exactly 1 for a normalised two-body state on orthonormal orbitals. */
export function twoBodyNorm(psi: Float64Array, dx: number): number {
  let sum = 0
  for (let i = 0; i < psi.length; i++) sum += psi[i] * psi[i]
  return sum * dx * dx
}

/** |ψ|² on the product grid, row-major like ψ. */
export function twoBodyDensity(psi: Float64Array, out?: Float64Array): Float64Array {
  const target = out && out.length === psi.length ? out : new Float64Array(psi.length)
  for (let i = 0; i < psi.length; i++) target[i] = psi[i] * psi[i]
  return target
}

/** |ψ(x, x)|² along the diagonal x₁ = x₂ — the Pauli hole is this being zero. */
export function diagonalDensity(psi: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = psi[i * n + i]
    out[i] = v * v
  }
  return out
}

/**
 * The distribution of the signed separation r = x₁ − x₂, binned on the grid's own
 * spacing: `density[k]` is the probability density at r = (k − (n − 1))·dx, for k in
 * [0, 2n − 2]. Integrates to the norm of ψ.
 */
export function separationDistribution(
  psi: Float64Array,
  grid: Grid
): { r: Float64Array; density: Float64Array } {
  const { n, dx } = grid
  const bins = 2 * n - 1
  const density = new Float64Array(bins)
  const r = new Float64Array(bins)
  for (let k = 0; k < bins; k++) r[k] = (k - (n - 1)) * dx
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = psi[i * n + j]
      // Weight dx² per cell, spread over a bin of width dx → density gets v²·dx.
      density[i - j + (n - 1)] += v * v * dx
    }
  }
  return { r, density }
}

/** ⟨(x₁ − x₂)²⟩ = Σ (x_i − x_j)² |ψ_ij|² dx². */
export function meanSquareSeparation(psi: Float64Array, grid: Grid): number {
  const { n, dx, x } = grid
  let sum = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = x[i] - x[j]
      const v = psi[i * n + j]
      sum += d * d * v * v
    }
  }
  return sum * dx * dx
}

/** ⟨x⟩ and ⟨x²⟩ of one orbital, and the overlap ⟨a|x|b⟩ — the exchange-force ingredients. */
export function orbitalMoments(
  grid: Grid,
  phiA: ArrayLike<number>,
  phiB: ArrayLike<number>
): { meanA: number; meanB: number; meanSqA: number; meanSqB: number; crossAB: number } {
  const { n, dx, x } = grid
  let meanA = 0
  let meanB = 0
  let meanSqA = 0
  let meanSqB = 0
  let crossAB = 0
  for (let i = 0; i < n; i++) {
    const a2 = phiA[i] * phiA[i]
    const b2 = phiB[i] * phiB[i]
    meanA += x[i] * a2
    meanB += x[i] * b2
    meanSqA += x[i] * x[i] * a2
    meanSqB += x[i] * x[i] * b2
    crossAB += x[i] * phiA[i] * phiB[i]
  }
  return {
    meanA: meanA * dx,
    meanB: meanB * dx,
    meanSqA: meanSqA * dx,
    meanSqB: meanSqB * dx,
    crossAB: crossAB * dx,
  }
}

/**
 * Draw `count` pairs (x₁, x₂) from |ψ|² by inverse-CDF sampling on the product grid,
 * jittered uniformly inside each cell so the dots do not sit on a lattice. `random` is
 * injected so the tests can drive it and so the page can seed it.
 */
export function samplePairs(
  psi: Float64Array,
  grid: Grid,
  count: number,
  random: () => number = Math.random
): Array<[number, number]> {
  const { n, dx, x } = grid
  const cdf = new Float64Array(psi.length)
  let acc = 0
  for (let i = 0; i < psi.length; i++) {
    acc += psi[i] * psi[i]
    cdf[i] = acc
  }
  const out: Array<[number, number]> = []
  if (!(acc > 0)) return out
  for (let s = 0; s < count; s++) {
    const u = random() * acc
    // Binary search for the first cell whose cumulative mass exceeds u.
    let lo = 0
    let hi = psi.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < u) lo = mid + 1
      else hi = mid
    }
    const i = Math.floor(lo / n)
    const j = lo - i * n
    out.push([x[i] + (random() - 0.5) * dx, x[j] + (random() - 0.5) * dx])
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Filling the levels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ground state of `count` non-interacting particles on the ladder `energies`
 * (ascending): each level holds at most `spinDegeneracy` fermions and any number of
 * bosons. Returns the occupation of each level and the total energy.
 *
 *   bosons                     everything in level 1, E = N·E₁
 *   fermions, spinDegeneracy 1 one per level, E = E₁ + … + E_N   (spin-polarised)
 *   fermions, spinDegeneracy 2 two per level, E = 2E₁ + 2E₂ + …  (real electrons)
 *
 * Throws if the ladder is too short to hold the fermions; the page sizes it so that
 * cannot happen, and a silent truncation would report a wrong energy.
 */
export function groundStateOccupation(
  statistics: Statistics,
  count: number,
  energies: ArrayLike<number>,
  spinDegeneracy = 1
): { occupation: number[]; energy: number } {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer')
  if (!Number.isInteger(spinDegeneracy) || spinDegeneracy < 1) {
    throw new RangeError('spinDegeneracy must be a positive integer')
  }
  const levels = energies.length
  const occupation = new Array<number>(levels).fill(0)
  let energy = 0
  if (count === 0 || levels === 0) return { occupation, energy }
  if (statistics === 'fermion') {
    let left = count
    for (let k = 0; k < levels && left > 0; k++) {
      const take = Math.min(spinDegeneracy, left)
      occupation[k] = take
      energy += take * energies[k]
      left -= take
    }
    if (left > 0) throw new RangeError('not enough levels to hold the fermions')
  } else {
    // Bosons and distinguishable particles both pile into the ground level.
    occupation[0] = count
    energy = count * energies[0]
  }
  return { occupation, energy }
}

// ─────────────────────────────────────────────────────────────────────────────
// The periodic table's shape: Madelung filling of hydrogen-like subshells
// ─────────────────────────────────────────────────────────────────────────────

export type Subshell = {
  n: number
  l: number
  /** 's', 'p', 'd', 'f' */
  letter: string
  label: string
  /** 2(2l + 1): two spins in each of the 2l + 1 orbitals. */
  capacity: number
}

const L_LETTERS = ['s', 'p', 'd', 'f', 'g']

/**
 * Subshells in Madelung order: ascending n + l, ties broken by ascending n.
 * 1s 2s 2p 3s 3p 4s 3d 4p 5s 4d 5p 6s 4f 5d 6p 7s 5f 6d 7p.
 */
export function madelungOrder(maxN = 7): Subshell[] {
  const list: Subshell[] = []
  for (let n = 1; n <= maxN; n++) {
    for (let l = 0; l < n && l < L_LETTERS.length; l++) {
      list.push({ n, l, letter: L_LETTERS[l], label: `${n}${L_LETTERS[l]}`, capacity: 2 * (2 * l + 1) })
    }
  }
  list.sort((a, b) => a.n + a.l - (b.n + b.l) || a.n - b.n)
  return list
}

export type Occupied = Subshell & { electrons: number }

/**
 * Fill Z electrons into subshells strictly by the Madelung rule. The rule is what the
 * shell-capacity argument predicts; the atoms that disagree with it below Z = 36 are
 * chromium and copper (a half-filled or full d shell wins one electron off 4s), and
 * electronConfiguration() patches exactly those.
 */
export function madelungConfiguration(z: number): Occupied[] {
  if (!Number.isInteger(z) || z < 0) throw new RangeError('Z must be a non-negative integer')
  const out: Occupied[] = []
  let left = z
  for (const shell of madelungOrder()) {
    if (left <= 0) break
    const take = Math.min(shell.capacity, left)
    out.push({ ...shell, electrons: take })
    left -= take
  }
  if (left > 0) throw new RangeError('Z beyond the subshell table')
  return out
}

/** Known departures from the Madelung rule for Z ≤ 36, as {from, to} electron moves. */
const MADELUNG_EXCEPTIONS: Record<number, { from: string; to: string }> = {
  24: { from: '4s', to: '3d' }, // Cr: [Ar] 3d⁵ 4s¹
  29: { from: '4s', to: '3d' }, // Cu: [Ar] 3d¹⁰ 4s¹
}

/** The ground-state configuration actually observed, for Z ≤ 36. */
export function electronConfiguration(z: number): Occupied[] {
  const config = madelungConfiguration(z)
  const fix = MADELUNG_EXCEPTIONS[z]
  if (fix) {
    const from = config.find((s) => s.label === fix.from)
    const to = config.find((s) => s.label === fix.to)
    if (from && to) {
      from.electrons -= 1
      to.electrons += 1
    }
  }
  return config
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
}

/** "1s² 2s² 2p⁶ 3s¹" */
export function formatConfiguration(config: Occupied[]): string {
  return config
    .map((s) => s.label + String(s.electrons).split('').map((c) => SUPERSCRIPT[c] ?? c).join(''))
    .join(' ')
}

/**
 * Electrons per principal shell n — what the "2, 8, 8, 18" row lengths count. Note the
 * shells fill out of order once 4s dips below 3d, which is exactly why row 3 has 8
 * elements and not 18.
 */
export function shellPopulation(config: Occupied[]): number[] {
  const maxN = config.reduce((m, s) => Math.max(m, s.n), 0)
  const out = new Array<number>(maxN).fill(0)
  for (const s of config) out[s.n - 1] += s.electrons
  return out
}

/** Symbols for Z = 1 … 36, indexed by Z − 1. */
export const ELEMENT_SYMBOLS: readonly string[] = [
  'H', 'He',
  'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
] as const

/** Names for Z = 1 … 36, indexed by Z − 1. */
export const ELEMENT_NAMES: readonly string[] = [
  'Hydrogen', 'Helium',
  'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon',
  'Sodium', 'Magnesium', 'Aluminium', 'Silicon', 'Phosphorus', 'Sulfur', 'Chlorine', 'Argon',
  'Potassium', 'Calcium', 'Scandium', 'Titanium', 'Vanadium', 'Chromium', 'Manganese', 'Iron',
  'Cobalt', 'Nickel', 'Copper', 'Zinc', 'Gallium', 'Germanium', 'Arsenic', 'Selenium', 'Bromine', 'Krypton',
] as const

/** Row and 1-based column of element Z in the 18-column table, Z ≤ 36. */
export function tablePosition(z: number): { row: number; column: number } {
  if (z === 1) return { row: 1, column: 1 }
  if (z === 2) return { row: 1, column: 18 }
  if (z <= 10) return z <= 4 ? { row: 2, column: z - 2 } : { row: 2, column: z + 8 }
  if (z <= 18) return z <= 12 ? { row: 3, column: z - 10 } : { row: 3, column: z }
  if (z <= 36) return { row: 4, column: z - 18 }
  throw new RangeError('Z beyond the four-row table')
}
