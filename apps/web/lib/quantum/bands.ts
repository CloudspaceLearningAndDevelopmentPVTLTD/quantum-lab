/**
 * lib/quantum/bands.ts — Bloch bands of a one-dimensional periodic potential.
 *
 * Behind /visualizations/band-structure. Takes a unit cell — a barrier of height V₀ and
 * width b inside a lattice of spacing a (Kronig–Penney), or any potential sampled on a
 * schrodinger.ts Grid — and returns the allowed energy bands, the dispersion E(k) inside
 * each one, and the gaps between them. Plain TypeScript with no DOM dependency, so every
 * number is checked in bands.test.ts against closed forms and tabulated values rather
 * than eyeballed on a canvas.
 *
 * UNITS. ħ = m = 1, the same as schrodinger.ts: a plane wave e^{iqx} has energy q²/2 and
 * the free-electron band edges in a lattice of spacing a sit at (nπ/a)²/2.
 *
 * WHY A TRANSFER MATRIX AND NOT A SUPERCELL.
 *
 * Bloch's theorem says a state of energy E exists in the crystal exactly when the
 * one-cell transfer matrix M(E) — the 2×2 real matrix carrying (ψ, ψ′) across one period —
 * has an eigenvalue e^{ika} of unit modulus. det M = 1 always (the Wronskian is
 * conserved), so the two eigenvalues are reciprocals and the condition collapses to
 *
 *     cos(ka) = ½ Tr M(E)  ≡  Δ(E),   with  |Δ(E)| ≤ 1  inside a band.
 *
 * That one scalar function of energy IS the band structure: bands are the intervals where
 * |Δ| ≤ 1, gaps are where |Δ| > 1, and E(k) is the inverse of Δ on each band. Computing
 * it costs one 2×2 matrix product per slab of the cell, and the answer is exact for a
 * piecewise-constant potential — the Kronig–Penney closed form falls out of it, which is
 * what the tests check.
 *
 * The alternative — a supercell of N cells fed to solveStationary() — would give N states
 * per band with no k label, at O(N · grid) cost, and its hard walls can add surface states
 * the infinite crystal does not have. The wave-1 engine is still used here, in two ways:
 * cellFromGrid() takes a potential sampled on one of its Grids (each grid point becomes a
 * slab of width dx, so an arbitrary smooth V(x) works too — the tests do the Mathieu
 * cosine that way), and bands.test.ts runs a hard-wall supercell through solveStationary()
 * as an independent count of the states per band.
 *
 * FINDING THE BANDS ROBUSTLY. Δ(E) crosses zero exactly once per band (at k = π/2a) and
 * never in a gap, so a coarse scan in q = √(2(E − V_min)) catches every band as a sign
 * change no matter how narrow the band is — the tight-binding limit makes them
 * exponentially thin, and a scan that looked for |Δ| ≤ 1 directly would step over them.
 * Between two consecutive zeros Δ has exactly one critical point (Hill's discriminant
 * theorem), so the two band edges on either side of a gap come from a golden-section
 * search for that extremum followed by bisection on |Δ| = 1. When the gap is closed —
 * V = 0, or a Fourier component that vanishes — the extremum touches ±1 and both edges
 * coincide there, which bisection alone could never resolve.
 */

import type { Grid } from './schrodinger'

/** A region of constant potential. A cell is a list of these, left to right. */
export type Slab = { width: number; potential: number }

/** One period of the crystal. `period` is the sum of the slab widths. */
export type UnitCell = {
  readonly period: number
  readonly slabs: readonly Slab[]
  /** Lowest value of V in the cell. No state can lie below it. */
  readonly vMin: number
  /** Highest value of V in the cell. Above it every slab is classically allowed. */
  readonly vMax: number
}

/** One allowed band. */
export type Band = {
  /** 0 for the lowest band. */
  index: number
  bottom: number
  top: number
  /**
   * E at k = π/(2a), where Δ = 0. For a half-filled band this is the Fermi energy
   * exactly, because states are spread uniformly in k.
   */
  centre: number
  /** E at k_j = j·π/(a·(samples−1)), j = 0 … samples−1. */
  energies: Float64Array
}

export type BandStructure = {
  cell: UnitCell
  bands: Band[]
  /** k values the `energies` arrays are sampled at, from 0 to π/a inclusive. */
  kSamples: Float64Array
}

// ─────────────────────────────────────────────────────────────────────────────
// Cells
// ─────────────────────────────────────────────────────────────────────────────

function makeCell(slabs: Slab[]): UnitCell {
  let period = 0
  let vMin = Infinity
  let vMax = -Infinity
  for (const s of slabs) {
    if (!(s.width >= 0) || !Number.isFinite(s.potential)) {
      throw new RangeError('slab widths must be non-negative and potentials finite')
    }
    period += s.width
    vMin = Math.min(vMin, s.potential)
    vMax = Math.max(vMax, s.potential)
  }
  if (!(period > 0)) throw new RangeError('a unit cell needs positive total width')
  return { period, slabs, vMin, vMax }
}

/**
 * The Kronig–Penney cell: a well of width a − b at V = 0 followed by a barrier of height
 * V₀ and width b. Zero-width or zero-height barriers give the free electron back.
 */
export function kronigPenneyCell(
  period: number,
  barrierHeight: number,
  barrierWidth: number
): UnitCell {
  if (!(period > 0)) throw new RangeError('period must be positive')
  if (!(barrierWidth >= 0) || barrierWidth > period) {
    throw new RangeError('barrier width must lie in [0, period]')
  }
  return makeCell([
    { width: period - barrierWidth, potential: 0 },
    { width: barrierWidth, potential: barrierHeight },
  ])
}

/**
 * One period of a potential sampled on a schrodinger.ts Grid: point i stands for the slab
 * [x_i − dx/2, x_i + dx/2] at V_i, so the period is n·dx and the grid should span exactly
 * one period with no repeated end point — centeredGrid(n, a/2) does that. The midpoint
 * rule makes this second-order accurate in dx for a smooth V.
 */
export function cellFromGrid(grid: Grid, potential: ArrayLike<number>): UnitCell {
  if (potential.length !== grid.n) throw new RangeError('potential length must match grid size')
  const slabs: Slab[] = new Array(grid.n)
  for (let i = 0; i < grid.n; i++) slabs[i] = { width: grid.dx, potential: potential[i] }
  return makeCell(slabs)
}

// ─────────────────────────────────────────────────────────────────────────────
// The discriminant Δ(E) = ½ Tr M(E)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The transfer matrix of one cell at energy E, acting on the column (ψ, ψ′):
 * (ψ, ψ′) at the right edge = M · (ψ, ψ′) at the left edge. Returned row-major.
 *
 * In a slab of width w with ε = E − V the solutions are cos/sin of qw (ε > 0, q = √2ε) or
 * cosh/sinh of κw (ε < 0, κ = √−2ε); ε = 0 is the straight line ψ = A + Bx. ψ and ψ′ are
 * both continuous at a finite step, so the cell matrix is just the product of the slab
 * matrices — no interface factors — and every entry is real.
 */
export function cellTransferMatrix(
  cell: UnitCell,
  energy: number
): [number, number, number, number] {
  let m11 = 1
  let m12 = 0
  let m21 = 0
  let m22 = 1
  for (const slab of cell.slabs) {
    const w = slab.width
    if (w === 0) continue
    const eps = energy - slab.potential
    let s11: number
    let s12: number
    let s21: number
    if (eps > 1e-300) {
      const q = Math.sqrt(2 * eps)
      const c = Math.cos(q * w)
      const s = Math.sin(q * w)
      s11 = c
      s12 = s / q
      s21 = -q * s
    } else if (eps < -1e-300) {
      const kappa = Math.sqrt(-2 * eps)
      const c = Math.cosh(kappa * w)
      const s = Math.sinh(kappa * w)
      s11 = c
      s12 = s / kappa
      s21 = kappa * s
    } else {
      s11 = 1
      s12 = w
      s21 = 0
    }
    // Slab matrices have s22 = s11. Left-multiply: M ← S · M.
    const n11 = s11 * m11 + s12 * m21
    const n12 = s11 * m12 + s12 * m22
    const n21 = s21 * m11 + s11 * m21
    const n22 = s21 * m12 + s11 * m22
    m11 = n11
    m12 = n12
    m21 = n21
    m22 = n22
  }
  return [m11, m12, m21, m22]
}

/** Δ(E) = ½ Tr M(E) = cos(ka) inside a band. |Δ| > 1 means E is in a gap. */
export function blochDiscriminant(cell: UnitCell, energy: number): number {
  const m = cellTransferMatrix(cell, energy)
  return 0.5 * (m[0] + m[3])
}

// ─────────────────────────────────────────────────────────────────────────────
// Bands
// ─────────────────────────────────────────────────────────────────────────────

/** Root of a monotone f on [lo, hi] with f(lo) and f(hi) of opposite sign. */
function bisect(f: (e: number) => number, lo: number, hi: number, fLo: number): number {
  let a = lo
  let b = hi
  let fa = fLo
  for (let iter = 0; iter < 200; iter++) {
    const mid = 0.5 * (a + b)
    if (mid <= a || mid >= b) break
    const fm = f(mid)
    if (fm === 0) return mid
    if ((fm < 0) === (fa < 0)) {
      a = mid
      fa = fm
    } else {
      b = mid
    }
    if (b - a <= 1e-13 * Math.max(1, Math.abs(a), Math.abs(b))) break
  }
  return 0.5 * (a + b)
}

/** Argmax of a unimodal f on [lo, hi] by golden-section search. */
function argmax(f: (e: number) => number, lo: number, hi: number): number {
  const phi = (Math.sqrt(5) - 1) / 2
  let a = lo
  let b = hi
  let c = b - phi * (b - a)
  let d = a + phi * (b - a)
  let fc = f(c)
  let fd = f(d)
  for (let iter = 0; iter < 200; iter++) {
    if (b - a <= 1e-13 * Math.max(1, Math.abs(a), Math.abs(b))) break
    if (fc < fd) {
      a = c
      c = d
      fc = fd
      d = a + phi * (b - a)
      fd = f(d)
    } else {
      b = d
      d = c
      fd = fc
      c = b - phi * (b - a)
      fc = f(c)
    }
  }
  return 0.5 * (a + b)
}

export type BandSearchOptions = {
  /** Stop once this many bands have been found. Default 8. */
  maxBands?: number
  /** Stop once a band starts above this energy. Default: unbounded. */
  energyMax?: number
  /** Points per band in the E(k) sample, k from 0 to π/a inclusive. Default 48. */
  kSamples?: number
}

/**
 * The lowest bands of the crystal, lowest first, each with its E(k) sampled on
 * [0, π/a]. Bands with `bottom > energyMax` are not returned.
 *
 * A closed gap — the free electron, or a barrier whose n-th Fourier component vanishes —
 * is returned as two bands sharing an edge; the caller can test `top === next.bottom`.
 */
export function findBands(cell: UnitCell, options: BandSearchOptions = {}): BandStructure {
  const maxBands = Math.max(0, Math.floor(options.maxBands ?? 8))
  const energyMax = options.energyMax ?? Infinity
  const samples = Math.max(2, Math.floor(options.kSamples ?? 48))
  const a = cell.period
  const delta = (e: number) => blochDiscriminant(cell, e)

  const kSamples = new Float64Array(samples)
  for (let j = 0; j < samples; j++) kSamples[j] = ((j / (samples - 1)) * Math.PI) / a

  const bands: Band[] = []
  if (maxBands === 0) return { cell, bands, kSamples }

  // ── 1. Zeros of Δ: one per band, found by a scan uniform in q ─────────────────
  // Consecutive bands are ~π/a apart in q = √(2(E − V_min)) for the free electron, and a
  // single-well cell only spreads them out. A step of π/(32a) leaves a wide margin for
  // cells with internal structure (a double well per period splits each band in two).
  const dq = Math.PI / (32 * a)
  const zeros: number[] = []
  const energyAt = (q: number) => cell.vMin + 0.5 * q * q
  let qPrev = 0
  let fPrev = delta(energyAt(qPrev))
  // One extra zero past the last wanted band pins that band's top edge.
  const wanted = maxBands + 1
  // Hard ceiling on the scan so a pathological cell cannot loop forever: 64 free bands'
  // worth of q above the barrier top is more than any page or test asks for.
  const qCeiling = Math.sqrt(2 * Math.max(cell.vMax - cell.vMin, 0)) + (64 * Math.PI) / a
  while (zeros.length < wanted && qPrev < qCeiling) {
    const q = qPrev + dq
    const f = delta(energyAt(q))
    if ((f < 0) !== (fPrev < 0)) {
      zeros.push(bisect(delta, energyAt(qPrev), energyAt(q), fPrev))
    }
    qPrev = q
    fPrev = f
    // Band n's bottom lies above zeros[n−1], and its top needs zeros[n+1]. Once
    // zeros[m−2] is past energyMax, every band that can still be wanted has both.
    if (zeros.length >= 2 && zeros[zeros.length - 2] > energyMax) break
  }

  // ── 2. Edges: the extremum of Δ between two zeros, then bisection to |Δ| = 1 ──────
  const nBands = Math.max(0, zeros.length - 1)
  const bottoms = new Float64Array(nBands)
  const tops = new Float64Array(nBands)
  if (nBands > 0) {
    // Below the first zero Δ decreases monotonically from +∞ (or from exactly 1 at
    // V_min for the free electron), so band 0's bottom is a plain bisection from V_min.
    const f0 = delta(cell.vMin)
    bottoms[0] =
      f0 <= 1 + 1e-12 ? cell.vMin : bisect((e) => delta(e) - 1, cell.vMin, zeros[0], f0 - 1)
  }
  for (let g = 1; g <= nBands; g++) {
    // Gap g separates band g−1 from band g. Between zeros[g−1] and zeros[g], Δ has the
    // sign (−1)^g and exactly one extremum; the top of band g−1 is where |Δ| first
    // reaches 1 on the way up, the bottom of band g where it last leaves 1 on the way down.
    const sign = g % 2 === 0 ? 1 : -1
    const h = (e: number) => sign * delta(e)
    const peakE = argmax(h, zeros[g - 1], zeros[g])
    const peak = h(peakE)
    if (peak <= 1 + 1e-12) {
      // Closed gap: both bands share this edge.
      tops[g - 1] = peakE
      if (g < nBands) bottoms[g] = peakE
    } else {
      tops[g - 1] = bisect((e) => h(e) - 1, zeros[g - 1], peakE, -1)
      if (g < nBands) bottoms[g] = bisect((e) => h(e) - 1, peakE, zeros[g], peak - 1)
    }
  }

  // ── 3. Dispersion: invert Δ(E) = cos(ka) on each band ────────────────────────
  for (let n = 0; n < nBands && n < maxBands; n++) {
    const bottom = bottoms[n]
    const top = tops[n]
    if (bottom > energyMax) break
    const energies = new Float64Array(samples)
    // Even bands rise with k (bottom at k = 0), odd bands fall (bottom at k = π/a):
    // Δ = +1 at k = 0 and the bottom of band n carries Δ = (−1)^n.
    const rising = n % 2 === 0
    for (let j = 0; j < samples; j++) {
      const target = Math.cos(kSamples[j] * a)
      if (j === 0) {
        energies[j] = rising ? bottom : top
      } else if (j === samples - 1) {
        energies[j] = rising ? top : bottom
      } else if (top - bottom <= 0) {
        energies[j] = bottom
      } else {
        // Δ − target is monotone on [bottom, top]: decreasing for a rising band.
        const h = (e: number) => delta(e) - target
        const hBottom = rising ? 1 - target : -1 - target
        energies[j] = bisect(h, bottom, top, hBottom)
      }
    }
    bands.push({ index: n, bottom, top, centre: zeros[n], energies })
  }

  return { cell, bands, kSamples }
}

/**
 * The free-electron parabola folded into the reduced zone: band n at reduced wavevector
 * k ∈ [0, π/a] has extended-zone wavevector q = nπ/a + k (n even) or (n+1)π/a − k (n odd),
 * and E = q²/2. This is what every band collapses onto as V → 0.
 */
export function freeElectronFolded(period: number, bandIndex: number, k: number): number {
  const g = Math.PI / period
  const q = bandIndex % 2 === 0 ? bandIndex * g + k : (bandIndex + 1) * g - k
  return 0.5 * q * q
}

/**
 * The n-th Fourier component of a Kronig–Penney barrier, |V_n| for G = 2πn/a:
 * |V_n| = (V₀/nπ)·|sin(nπb/a)|. To first order in V₀ the n-th gap is 2|V_n|. Exposed so the
 * page can show the prediction beside the computed gap; the tests derive it on their own.
 */
export function kronigPenneyFourierComponent(
  n: number,
  barrierHeight: number,
  barrierWidth: number,
  period: number
): number {
  if (n === 0) return (barrierHeight * barrierWidth) / period
  return Math.abs((barrierHeight / (n * Math.PI)) * Math.sin((n * Math.PI * barrierWidth) / period))
}

// ─────────────────────────────────────────────────────────────────────────────
// Filling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ħ²/(m_e·Å²) in eV. With one length unit taken as LENGTH_UNIT_ANGSTROM, energies here
 * convert to eV by ENERGY_UNIT_EV. The choice of 2 Å puts the lattice-spacing slider's
 * 1–4 range at 2–8 Å, which brackets real crystals (Si: 5.43 Å, NaCl: 5.64 Å).
 */
const HBAR2_OVER_ME_ANGSTROM2_EV = 7.619964
export const LENGTH_UNIT_ANGSTROM = 2
export const ENERGY_UNIT_EV =
  HBAR2_OVER_ME_ANGSTROM2_EV / (LENGTH_UNIT_ANGSTROM * LENGTH_UNIT_ANGSTROM)

/**
 * The conventional dividing line: a filled-band material with a gap up to about 3 eV is
 * called a semiconductor, above that an insulator. It is a convention, not a phase
 * transition — diamond (5.5 eV) is an insulator by it and GaN (3.4 eV) is on the fence.
 */
export const SEMICONDUCTOR_MAX_GAP_EV = 3

/** k_B·300 K in eV. */
export const ROOM_TEMPERATURE_EV = 0.02585

export type Regime = 'metal' | 'semiconductor' | 'insulator'

export type Filling = {
  electronsPerCell: number
  /** Number of completely filled bands. */
  filledBands: number
  /** True when the electron count is odd: the top occupied band is half full. */
  partiallyFilled: boolean
  /** Index of the highest band holding electrons, or −1 for none. */
  highestOccupied: number
  fermiEnergy: number
  /** Energy from the top of the highest filled band to the next band. 0 for a metal. */
  gap: number
  gapEv: number
  regime: Regime
  /** True when the requested electron count needs more bands than were computed. */
  overflow: boolean
}

/**
 * Fill the bands from the bottom with `electronsPerCell` electrons per unit cell, two per
 * band (spin), and say what kind of solid that makes.
 *
 * An odd count leaves the top band half full: E_F sits at the band's Δ = 0 energy (states
 * are uniform in k, so half the band's states lie below k = π/2a) and the solid conducts.
 * An even count fills whole bands: E_F sits mid-gap, and the size of that gap in eV picks
 * semiconductor or insulator. A closed gap with an even count — the free electron — is
 * still a metal, because there is nothing to jump.
 */
export function fillBands(bands: Band[], electronsPerCell: number): Filling {
  const n = Math.max(0, Math.round(electronsPerCell))
  const filled = Math.floor(n / 2)
  const partial = n % 2 === 1
  const highest = partial ? filled : filled - 1

  if (n === 0) {
    return {
      electronsPerCell: 0,
      filledBands: 0,
      partiallyFilled: false,
      highestOccupied: -1,
      fermiEnergy: bands[0]?.bottom ?? 0,
      gap: 0,
      gapEv: 0,
      regime: 'insulator',
      overflow: false,
    }
  }

  const overflow = highest >= bands.length || (!partial && filled >= bands.length)
  if (overflow) {
    const last = bands[bands.length - 1]
    return {
      electronsPerCell: n,
      filledBands: Math.min(filled, bands.length),
      partiallyFilled: partial,
      highestOccupied: Math.min(highest, bands.length - 1),
      fermiEnergy: last?.top ?? 0,
      gap: 0,
      gapEv: 0,
      regime: 'metal',
      overflow: true,
    }
  }

  if (partial) {
    return {
      electronsPerCell: n,
      filledBands: filled,
      partiallyFilled: true,
      highestOccupied: highest,
      fermiEnergy: bands[highest].centre,
      gap: 0,
      gapEv: 0,
      regime: 'metal',
      overflow: false,
    }
  }

  const below = bands[filled - 1]
  const above = bands[filled]
  const gap = Math.max(0, above.bottom - below.top)
  const gapEv = gap * ENERGY_UNIT_EV
  const fermiEnergy = 0.5 * (below.top + above.bottom)
  const regime: Regime =
    gap <= 1e-9 ? 'metal' : gapEv <= SEMICONDUCTOR_MAX_GAP_EV ? 'semiconductor' : 'insulator'
  return {
    electronsPerCell: n,
    filledBands: filled,
    partiallyFilled: false,
    highestOccupied: highest,
    fermiEnergy,
    gap,
    gapEv,
    regime,
    overflow: false,
  }
}
