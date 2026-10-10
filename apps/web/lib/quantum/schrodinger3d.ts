/**
 * lib/quantum/schrodinger3d.ts — separable eigenstates on a 3-D grid.
 *
 * Four systems, one output shape. Every function here fills a `Volume`: |ψ|² on
 * a regular nx × ny × nz grid (x fastest), the phase of ψ at every voxel, the
 * physical bounds of the grid and the energy of the state. The renderer
 * (components/viz/VolumeRenderer.tsx) draws that and nothing else, so it never
 * needs to know which system it is looking at.
 *
 * UNITS. ħ = m = 1 for the box, the oscillator and the rotor, matching
 * lib/quantum/schrodinger.ts. Lengths are in whatever unit the caller's L or
 * 1/√ω is in; energies follow (ħ²/m·length⁻²). The rotor's moment of inertia is
 * I = 1, so its energy is l(l+1)/2. Hydrogen is the exception: it reuses
 * lib/quantum/hydrogen.ts, so its lengths are Bohr radii and its energy is in
 * eV. Each `Volume` carries an `energyUnit` string so a page can label it.
 *
 * WHY |ψ|² AND A PHASE, NOT ψ. The renderer draws probability density — the
 * physically honest quantity — and only uses the phase to colour it. For the
 * real eigenstates (box, oscillator, hydrogen, the real rotor basis) the phase
 * is 0 or π, so the two colours mark the two signs of ψ and the boundary
 * between them is a nodal surface. For the complex rotor states Y_l^m the phase
 * is mφ and winds continuously around z; the density itself has no φ dependence
 * at all, which is the point that view makes.
 *
 * LAYOUT. `index = ix + nx·(iy + ny·iz)` — x varies fastest, then y, then z.
 * That is the order WebGL's texImage3D expects for a width × height × depth
 * texture, so the density array uploads without a copy.
 *
 * Every formula below is checked in schrodinger3d.test.ts against values
 * derived independently: closed-form energies, the degeneracy counts of the
 * cubic box and the isotropic oscillator, node counts, and grid normalisation.
 */

import {
  assertQuantumNumbers,
  makeRadialSampler,
  psi as hydrogenPsi,
  energyEv as hydrogenEnergyEv,
  realSphericalHarmonic,
  associatedLegendre,
} from './hydrogen'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = readonly [number, number, number]

export type System3D = 'box' | 'oscillator' | 'rotor' | 'hydrogen'

export interface Volume {
  system: System3D
  /** |ψ|² per unit volume, `nx·ny·nz` long, x fastest. */
  density: Float32Array
  /** arg ψ in (−π, π] per voxel. 0 or π for a real state. */
  phase: Float32Array
  nx: number
  ny: number
  nz: number
  /** Physical position of the first voxel centre along each axis. */
  min: Vec3
  /** Physical position of the last voxel centre along each axis. */
  max: Vec3
  /** Voxel spacing along each axis. */
  spacing: Vec3
  energy: number
  /** Human-readable unit for `energy`. */
  energyUnit: string
  /** Largest density value on the grid, for the renderer's transfer function. */
  maxDensity: number
  /** Σ |ψ|² dV over the grid. Should be 1 to within the grid's resolution. */
  norm: number
  /** Whether ψ is complex (phase winds continuously) or real (phase ∈ {0, π}). */
  complex: boolean
  /** Short label, e.g. `(1, 2, 1)` or `Y₂¹`. */
  label: string
}

/** A regular grid: `count` voxel centres from `min` to `max` inclusive. */
export interface Axis {
  count: number
  min: number
  max: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers (exported so the tests can hit them directly)
// ─────────────────────────────────────────────────────────────────────────────

/** Voxel-centre coordinates along one axis. */
export function axisCoordinates(axis: Axis): Float64Array {
  const out = new Float64Array(axis.count)
  const step = axis.count > 1 ? (axis.max - axis.min) / (axis.count - 1) : 0
  for (let i = 0; i < axis.count; i++) out[i] = axis.min + i * step
  return out
}

function spacingOf(axis: Axis): number {
  return axis.count > 1 ? (axis.max - axis.min) / (axis.count - 1) : 1
}

/** Number of sign changes in a sampled real function — its interior node count. */
export function countSignChanges(values: ArrayLike<number>, floor = 0): number {
  let nodes = 0
  let last = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Math.abs(v) <= floor) continue
    const sign = v > 0 ? 1 : -1
    if (last !== 0 && sign !== last) nodes++
    last = sign
  }
  return nodes
}

/**
 * The Hermite polynomial H_n(ξ) (physicists' convention), by the recurrence
 * H_{n+1} = 2ξ·H_n − 2n·H_{n−1}, from H_0 = 1 and H_1 = 2ξ.
 */
export function hermite(n: number, xi: number): number {
  if (n < 0) return 0
  if (n === 0) return 1
  let prev = 1
  let cur = 2 * xi
  for (let k = 1; k < n; k++) {
    const next = 2 * xi * cur - 2 * k * prev
    prev = cur
    cur = next
  }
  return cur
}

/** ln(k!) — small k only, so a plain loop is fine. */
function lnFactorial(k: number): number {
  let s = 0
  for (let i = 2; i <= k; i++) s += Math.log(i)
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// One-dimensional eigenfunctions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infinite well on [0, L]: ψ_n(x) = √(2/L)·sin(nπx/L), n = 1, 2, 3, …
 * Zero outside the well.
 */
export function boxEigenfunction1d(n: number, L: number, x: number): number {
  if (x <= 0 || x >= L) return 0
  return Math.sqrt(2 / L) * Math.sin((n * Math.PI * x) / L)
}

/** E_n = n²π²/(2L²), with ħ = m = 1. */
export function boxEnergy1d(n: number, L: number): number {
  return (n * n * Math.PI * Math.PI) / (2 * L * L)
}

/**
 * Harmonic oscillator with frequency ω (ħ = m = 1):
 *   ψ_n(x) = (ω/π)^{1/4} · (2ⁿ n!)^{-1/2} · H_n(√ω x) · exp(−ωx²/2)
 */
export function oscillatorEigenfunction1d(n: number, omega: number, x: number): number {
  const xi = Math.sqrt(omega) * x
  const lnNorm = 0.25 * Math.log(omega / Math.PI) - 0.5 * (n * Math.LN2 + lnFactorial(n))
  return Math.exp(lnNorm - (xi * xi) / 2) * hermite(n, xi)
}

/** E_n = (n + ½)ω. */
export function oscillatorEnergy1d(n: number, omega: number): number {
  return (n + 0.5) * omega
}

// ─────────────────────────────────────────────────────────────────────────────
// Energies and degeneracies (closed form, no grid)
// ─────────────────────────────────────────────────────────────────────────────

/** E = (π²/2)·Σ nᵢ²/Lᵢ². */
export function boxEnergy(n: Vec3, L: Vec3): number {
  return boxEnergy1d(n[0], L[0]) + boxEnergy1d(n[1], L[1]) + boxEnergy1d(n[2], L[2])
}

/** E = Σ (nᵢ + ½)ωᵢ. */
export function oscillatorEnergy(n: Vec3, omega: Vec3): number {
  return (
    oscillatorEnergy1d(n[0], omega[0]) +
    oscillatorEnergy1d(n[1], omega[1]) +
    oscillatorEnergy1d(n[2], omega[2])
  )
}

/** E = l(l+1)/(2I) with I = 1. */
export function rotorEnergy(l: number, momentOfInertia = 1): number {
  return (l * (l + 1)) / (2 * momentOfInertia)
}

/**
 * Every box state (nx, ny, nz) with 1 ≤ nᵢ ≤ `maxN` whose energy matches the
 * given state's to within a relative tolerance — the given state included.
 *
 * For a cube this is the permutation degeneracy ((1,1,2) ↔ (1,2,1) ↔ (2,1,1))
 * plus the "accidental" ones like (3,3,3) ↔ (5,1,1), both with Σn² = 27. For
 * an anisotropic box most of those split apart, which is what the page shows.
 */
export function boxDegeneratePartners(n: Vec3, L: Vec3, maxN = 6, tolerance = 1e-9): Vec3[] {
  const target = boxEnergy(n, L)
  const out: Vec3[] = []
  for (let a = 1; a <= maxN; a++) {
    for (let b = 1; b <= maxN; b++) {
      for (let c = 1; c <= maxN; c++) {
        const e = boxEnergy([a, b, c], L)
        if (Math.abs(e - target) <= tolerance * Math.max(1, Math.abs(target))) out.push([a, b, c])
      }
    }
  }
  return out
}

/**
 * Every oscillator state with the same energy as (nx, ny, nz) for frequencies
 * ω, searched up to `maxN` quanta per axis. For an isotropic oscillator this
 * is every triple with the same nx + ny + nz, which is (N+1)(N+2)/2 states.
 */
export function oscillatorDegeneratePartners(
  n: Vec3,
  omega: Vec3,
  maxN = 8,
  tolerance = 1e-9
): Vec3[] {
  const target = oscillatorEnergy(n, omega)
  const out: Vec3[] = []
  for (let a = 0; a <= maxN; a++) {
    for (let b = 0; b <= maxN; b++) {
      for (let c = 0; c <= maxN; c++) {
        const e = oscillatorEnergy([a, b, c], omega)
        if (Math.abs(e - target) <= tolerance * Math.max(1, Math.abs(target))) out.push([a, b, c])
      }
    }
  }
  return out
}

/** The closed form for the isotropic oscillator's degeneracy at level N. */
export function isotropicOscillatorDegeneracy(level: number): number {
  return ((level + 1) * (level + 2)) / 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Building volumes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill a Volume from three 1-D real eigenfunctions ψ(x)·ψ(y)·ψ(z). The
 * density is the product of squares, and the phase is 0 where the product is
 * positive and π where it is negative.
 */
function separableVolume(
  system: System3D,
  fx: Float64Array,
  fy: Float64Array,
  fz: Float64Array,
  axes: [Axis, Axis, Axis],
  energy: number,
  energyUnit: string,
  label: string
): Volume {
  const nx = axes[0].count
  const ny = axes[1].count
  const nz = axes[2].count
  const density = new Float32Array(nx * ny * nz)
  const phase = new Float32Array(nx * ny * nz)
  let maxDensity = 0
  let sum = 0
  let i = 0
  for (let iz = 0; iz < nz; iz++) {
    const pz = fz[iz]
    for (let iy = 0; iy < ny; iy++) {
      const pyz = fy[iy] * pz
      for (let ix = 0; ix < nx; ix++) {
        const p = fx[ix] * pyz
        const d = p * p
        density[i] = d
        phase[i] = p < 0 ? Math.PI : 0
        if (d > maxDensity) maxDensity = d
        sum += d
        i++
      }
    }
  }
  const spacing: Vec3 = [spacingOf(axes[0]), spacingOf(axes[1]), spacingOf(axes[2])]
  return {
    system,
    density,
    phase,
    nx,
    ny,
    nz,
    min: [axes[0].min, axes[1].min, axes[2].min],
    max: [axes[0].max, axes[1].max, axes[2].max],
    spacing,
    energy,
    energyUnit,
    maxDensity,
    norm: sum * spacing[0] * spacing[1] * spacing[2],
    complex: false,
    label,
  }
}

function sample1d(axis: Axis, f: (x: number) => number): Float64Array {
  const xs = axisCoordinates(axis)
  const out = new Float64Array(axis.count)
  for (let i = 0; i < axis.count; i++) out[i] = f(xs[i])
  return out
}

export interface BoxOptions {
  /** Quantum numbers (nx, ny, nz), each ≥ 1. */
  n: Vec3
  /** Side lengths (Lx, Ly, Lz). */
  L: Vec3
  /** Voxels per axis. Default 48. */
  resolution?: number
}

/**
 * Particle in a 3-D box: ψ = Π √(2/Lᵢ) sin(nᵢπxᵢ/Lᵢ), E = (π²/2) Σ nᵢ²/Lᵢ².
 *
 * The grid covers [0, Lᵢ] with the voxel centres pulled half a step inside each
 * wall, so the Riemann sum is a midpoint rule and the boundary voxels are not
 * wasted on the zero at the wall.
 */
export function boxVolume({ n, L, resolution = 48 }: BoxOptions): Volume {
  for (let k = 0; k < 3; k++) {
    if (!Number.isInteger(n[k]) || n[k] < 1) throw new Error(`n[${k}] must be a positive integer`)
    if (!(L[k] > 0)) throw new Error(`L[${k}] must be positive`)
  }
  const axes = [0, 1, 2].map((k) => {
    const h = L[k] / resolution
    return { count: resolution, min: h / 2, max: L[k] - h / 2 }
  }) as [Axis, Axis, Axis]
  const f = (k: number) => sample1d(axes[k], (x) => boxEigenfunction1d(n[k], L[k], x))
  return separableVolume(
    'box',
    f(0),
    f(1),
    f(2),
    axes,
    boxEnergy(n, L),
    'ħ²/m·L⁻²',
    `(${n[0]}, ${n[1]}, ${n[2]})`
  )
}

export interface OscillatorOptions {
  /** Quanta (nx, ny, nz), each ≥ 0. */
  n: Vec3
  /** Frequencies (ωx, ωy, ωz). Equal for the isotropic oscillator. */
  omega: Vec3
  /** Voxels per axis. Default 48. */
  resolution?: number
  /**
   * Half-width of the grid along each axis. Defaults to a box that holds the
   * requested state comfortably; pass a fixed value so a set of degenerate
   * states shares one frame.
   */
  halfWidth?: Vec3
}

/**
 * The classical turning point √((2n+1)/ω) plus 2.4 oscillator lengths for the
 * Gaussian tail to die: past the turning point |ψ|² falls like e^{−ξ²}, and at
 * 2.4 beyond it the ground state is down to e^{−11.6} ≈ 10⁻⁵ of its peak.
 */
export function oscillatorHalfWidth(n: number, omega: number): number {
  return (Math.sqrt(2 * n + 1) + 2.4) / Math.sqrt(omega)
}

/**
 * The 3-D harmonic oscillator, isotropic or not: ψ = Π ψ_{nᵢ}(xᵢ; ωᵢ),
 * E = Σ (nᵢ + ½)ωᵢ. Grid centred on the origin.
 */
export function oscillatorVolume({
  n,
  omega,
  resolution = 48,
  halfWidth,
}: OscillatorOptions): Volume {
  for (let k = 0; k < 3; k++) {
    if (!Number.isInteger(n[k]) || n[k] < 0) throw new Error(`n[${k}] must be a non-negative integer`)
    if (!(omega[k] > 0)) throw new Error(`omega[${k}] must be positive`)
  }
  const axes = [0, 1, 2].map((k) => {
    const w = halfWidth ? halfWidth[k] : oscillatorHalfWidth(n[k], omega[k])
    return { count: resolution, min: -w, max: w }
  }) as [Axis, Axis, Axis]
  const f = (k: number) => sample1d(axes[k], (x) => oscillatorEigenfunction1d(n[k], omega[k], x))
  return separableVolume(
    'oscillator',
    f(0),
    f(1),
    f(2),
    axes,
    oscillatorEnergy(n, omega),
    'ħω₀',
    `(${n[0]}, ${n[1]}, ${n[2]})`
  )
}

export interface RotorOptions {
  l: number
  m: number
  /**
   * `complex`: the L_z eigenstate Y_l^m, whose phase winds as e^{imφ} and whose
   * density is φ-independent. `real`: the chemistry combination (p_x, d_xy, …)
   * with lobes of alternating sign. Default `complex`.
   */
  basis?: 'complex' | 'real'
  /** Voxels per axis. Default 48. */
  resolution?: number
  /** Radius of the sphere the rotor lives on. Default 1. */
  radius?: number
  /**
   * The rotor's wavefunction is defined only on the sphere r = R. To draw it as
   * a volume it is smeared over a thin Gaussian shell of this standard
   * deviation (fraction of R). Default 0.09. The shell profile is normalised so
   * ∫ g(r) r² dr = 1 and the volume integral of |ψ|² stays 1.
   */
  shellWidth?: number
  momentOfInertia?: number
}

/**
 * The complex spherical harmonic Y_l^m(θ, φ) with the Condon–Shortley phase,
 * returned as (re, im). Reuses the associated Legendre function from
 * lib/quantum/hydrogen.ts (which omits the phase, hence the (−1)^m here).
 */
export function complexSphericalHarmonic(
  l: number,
  m: number,
  theta: number,
  phi: number
): [number, number] {
  const am = Math.abs(m)
  if (l < 0 || am > l) return [0, 0]
  const norm = Math.sqrt(
    ((2 * l + 1) / (4 * Math.PI)) * Math.exp(lnFactorial(l - am) - lnFactorial(l + am))
  )
  const p = associatedLegendre(l, am, Math.cos(theta))
  // Y_l^{-m} = (−1)^m conj(Y_l^m); with the CS phase (−1)^m on Y_l^{|m|}, the
  // magnitude for ±m is the same and only the sign of the phase winding flips.
  const cs = am % 2 === 0 ? 1 : -1
  const sign = m >= 0 ? cs : 1
  const mag = sign * norm * p
  return [mag * Math.cos(m * phi), mag * Math.sin(m * phi)]
}

/**
 * The rigid rotor: eigenstates are spherical harmonics on the sphere r = R,
 * E = l(l+1)/(2I). Drawn as a thin spherical shell so the angular structure is
 * visible in three dimensions.
 */
export function rotorVolume({
  l,
  m,
  basis = 'complex',
  resolution = 48,
  radius = 1,
  shellWidth = 0.09,
  momentOfInertia = 1,
}: RotorOptions): Volume {
  if (!Number.isInteger(l) || l < 0) throw new Error('l must be a non-negative integer')
  if (!Number.isInteger(m) || Math.abs(m) > l) throw new Error('m must satisfy |m| ≤ l')
  const sigma = shellWidth * radius
  const extent = radius + 4 * sigma
  const axes = [0, 1, 2].map(() => ({ count: resolution, min: -extent, max: extent })) as [
    Axis,
    Axis,
    Axis,
  ]
  // Normalise the radial shell so ∫ g(r) r² dr = 1 (numerically, on a fine grid).
  const gRaw = (r: number) => Math.exp(-((r - radius) * (r - radius)) / (2 * sigma * sigma))
  const steps = 4000
  const rMax = radius + 6 * sigma
  let shellNorm = 0
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * rMax
    const w = i === 0 || i === steps ? 0.5 : 1
    shellNorm += w * gRaw(r) * r * r
  }
  shellNorm *= rMax / steps
  const g = (r: number) => gRaw(r) / shellNorm

  const xs = axisCoordinates(axes[0])
  const nx = resolution
  const density = new Float32Array(nx * nx * nx)
  const phase = new Float32Array(nx * nx * nx)
  let maxDensity = 0
  let sum = 0
  let i = 0
  const complex = basis === 'complex'
  for (let iz = 0; iz < nx; iz++) {
    const z = xs[iz]
    for (let iy = 0; iy < nx; iy++) {
      const y = xs[iy]
      for (let ix = 0; ix < nx; ix++) {
        const x = xs[ix]
        const r = Math.sqrt(x * x + y * y + z * z)
        const shell = g(r)
        if (shell < 1e-12) {
          density[i] = 0
          phase[i] = 0
          i++
          continue
        }
        const theta = r > 0 ? Math.acos(Math.max(-1, Math.min(1, z / r))) : 0
        const phi = Math.atan2(y, x)
        let d: number
        let ph: number
        if (complex) {
          const [re, im] = complexSphericalHarmonic(l, m, theta, phi)
          d = (re * re + im * im) * shell
          ph = Math.atan2(im, re)
        } else {
          const yr = realSphericalHarmonic(l, m, theta, phi)
          d = yr * yr * shell
          ph = yr < 0 ? Math.PI : 0
        }
        density[i] = d
        phase[i] = ph
        if (d > maxDensity) maxDensity = d
        sum += d
        i++
      }
    }
  }
  const h = spacingOf(axes[0])
  const mLabel = m < 0 ? `⁻${Math.abs(m)}` : `${m}`
  return {
    system: 'rotor',
    density,
    phase,
    nx,
    ny: nx,
    nz: nx,
    min: [-extent, -extent, -extent],
    max: [extent, extent, extent],
    spacing: [h, h, h],
    energy: rotorEnergy(l, momentOfInertia),
    energyUnit: 'ħ²/I',
    maxDensity,
    norm: sum * h * h * h,
    complex,
    label: complex ? `Y${subscriptDigits(l)}${superscriptDigits(mLabel)}` : `l=${l}, m=${m}`,
  }
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
function subscriptDigits(v: number): string {
  return String(v)
    .split('')
    .map((c) => SUB[Number(c)] ?? c)
    .join('')
}
function superscriptDigits(v: string): string {
  return v
    .split('')
    .map((c) => (/\d/.test(c) ? SUP[Number(c)] : c))
    .join('')
}

export interface HydrogenOptions {
  n: number
  l: number
  m: number
  /** Voxels per axis. Default 48. */
  resolution?: number
  /**
   * Half-width of the cubic grid in Bohr radii. Defaults to the radius that
   * encloses 98% of the probability, the same framing the point cloud uses.
   */
  extent?: number
}

/**
 * Hydrogen |ψ_{nlm}|² on a cube, from the analytic wavefunction in
 * lib/quantum/hydrogen.ts (real orbitals, so the phase is 0 or π and marks the
 * sign of each lobe). Energy in eV.
 */
export function hydrogenVolume({ n, l, m, resolution = 48, extent }: HydrogenOptions): Volume {
  assertQuantumNumbers(n, l, m)
  const half = extent ?? makeRadialSampler(n, l).quantile(0.98)
  const axes = [0, 1, 2].map(() => ({ count: resolution, min: -half, max: half })) as [
    Axis,
    Axis,
    Axis,
  ]
  const xs = axisCoordinates(axes[0])
  const N = resolution
  const density = new Float32Array(N * N * N)
  const phase = new Float32Array(N * N * N)
  let maxDensity = 0
  let sum = 0
  let i = 0
  for (let iz = 0; iz < N; iz++) {
    const z = xs[iz]
    for (let iy = 0; iy < N; iy++) {
      const y = xs[iy]
      for (let ix = 0; ix < N; ix++) {
        const x = xs[ix]
        const r = Math.sqrt(x * x + y * y + z * z)
        const theta = r > 0 ? Math.acos(Math.max(-1, Math.min(1, z / r))) : 0
        const phi = Math.atan2(y, x)
        const p = hydrogenPsi(n, l, m, r, theta, phi)
        const d = p * p
        density[i] = d
        phase[i] = p < 0 ? Math.PI : 0
        if (d > maxDensity) maxDensity = d
        sum += d
        i++
      }
    }
  }
  const h = spacingOf(axes[0])
  return {
    system: 'hydrogen',
    density,
    phase,
    nx: N,
    ny: N,
    nz: N,
    min: [-half, -half, -half],
    max: [half, half, half],
    spacing: [h, h, h],
    energy: hydrogenEnergyEv(n),
    energyUnit: 'eV',
    maxDensity,
    norm: sum * h * h * h,
    complex: false,
    label: `n=${n}, l=${l}, m=${m}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a volume
// ─────────────────────────────────────────────────────────────────────────────

/** Flat index of voxel (ix, iy, iz). */
export function voxelIndex(v: Pick<Volume, 'nx' | 'ny'>, ix: number, iy: number, iz: number): number {
  return ix + v.nx * (iy + v.ny * iz)
}

/**
 * The signed amplitude √|ψ|²·cos(phase) sampled along one axis through the
 * voxel (ix, iy, iz), holding the other two indices fixed. For a real state
 * this is ψ itself along that line, so its sign changes are the nodes.
 */
export function lineThrough(
  v: Volume,
  axis: 0 | 1 | 2,
  fixed: [number, number, number]
): Float64Array {
  const count = axis === 0 ? v.nx : axis === 1 ? v.ny : v.nz
  const out = new Float64Array(count)
  const idx: [number, number, number] = [...fixed]
  for (let i = 0; i < count; i++) {
    idx[axis] = i
    const k = voxelIndex(v, idx[0], idx[1], idx[2])
    out[i] = Math.sqrt(v.density[k]) * Math.cos(v.phase[k])
  }
  return out
}

/**
 * Count the nodes along each axis through the grid centre. For a separable
 * real state that is (nx−1, ny−1, nz−1) for the box and (nx, ny, nz) for the
 * oscillator. Lines are taken slightly off the exact centre so an axis that
 * is itself a nodal plane (any odd oscillator state) does not read as zero.
 */
export function axisNodeCounts(v: Volume): [number, number, number] {
  const c: [number, number, number] = [
    Math.floor(v.nx * 0.37),
    Math.floor(v.ny * 0.37),
    Math.floor(v.nz * 0.37),
  ]
  const floor = Math.sqrt(v.maxDensity) * 1e-6
  return [
    countSignChanges(lineThrough(v, 0, c), floor),
    countSignChanges(lineThrough(v, 1, c), floor),
    countSignChanges(lineThrough(v, 2, c), floor),
  ]
}

/**
 * Extract one axis-aligned slice of density and phase, for the 2-D fallback
 * viewer and for tests. `axis` is the axis normal to the slice; `index` the
 * voxel index along it. The returned arrays are `width × height` with the
 * remaining two axes in (x, y, z) order.
 */
export function sliceVolume(
  v: Volume,
  axis: 0 | 1 | 2,
  index: number
): { width: number; height: number; density: Float32Array; phase: Float32Array } {
  const dims = [v.nx, v.ny, v.nz]
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
  const width = dims[a]
  const height = dims[b]
  const density = new Float32Array(width * height)
  const phase = new Float32Array(width * height)
  const k = Math.max(0, Math.min(dims[axis] - 1, Math.round(index)))
  const idx: [number, number, number] = [0, 0, 0]
  idx[axis] = k
  for (let j = 0; j < height; j++) {
    idx[b] = j
    for (let i = 0; i < width; i++) {
      idx[a] = i
      const src = voxelIndex(v, idx[0], idx[1], idx[2])
      density[j * width + i] = v.density[src]
      phase[j * width + i] = v.phase[src]
    }
  }
  return { width, height, density, phase }
}
