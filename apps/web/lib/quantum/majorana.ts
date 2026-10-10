/**
 * lib/quantum/majorana.ts — the Majorana stellar representation of a spin-j state.
 *
 * A spin-1/2 state is one point on the Bloch sphere. A spin-j state — equivalently
 * any state in the symmetric subspace of 2j qubits — is 2j points on the SAME
 * sphere (Majorana, 1932). Rotating the state rotates the constellation rigidly;
 * anything that is not a rotation moves the stars relative to one another.
 *
 * CONVENTIONS (they match lib/quantum.ts and BlochSphere.tsx):
 *   |0⟩ = |↑⟩ = |j, m=+j⟩ is the north pole (+z); |1⟩ = |↓⟩ is the south pole.
 *   Amplitude arrays are ordered m = +j, +j−1, …, −j, so `amp[k]` is the amplitude
 *   of |j, m = j−k⟩ — equivalently of the Dicke state with k excitations (k ones).
 *   A single-qubit state cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩ has its star at
 *   (sin θ cos φ, sin θ sin φ, cos θ).
 *
 * THE POLYNOMIAL. Write the symmetric state as Sym(|n₁⟩ ⊗ … ⊗ |n_{2j}⟩) with
 * |nᵢ⟩ = αᵢ|0⟩ + βᵢ|1⟩. Expanding, the Dicke amplitude with k excitations is
 * proportional to e_k(ζ) / √C(2j,k), where ζᵢ = βᵢ/αᵢ and e_k is the k-th
 * elementary symmetric polynomial. Since ∏(z − ζᵢ) = Σ (−1)^k e_k z^{2j−k},
 *
 *     P(z) = Σ_{k=0}^{2j} (−1)^k √C(2j,k) · amp[k] · z^{2j−k}
 *
 * has roots exactly ζᵢ = tan(θᵢ/2) e^{iφᵢ}, and the inverse stereographic
 * projection (from the south pole) puts ζᵢ back at (θᵢ, φᵢ). A vanishing leading
 * coefficient drops the degree; each missing root is a root at ζ = ∞, i.e. a
 * star at the south pole. |j, m⟩ therefore has j+m stars at the north pole and
 * j−m at the south pole, which is the check the tests use.
 *
 * NUMERICS. Roots are found by the Aberth–Ehrlich iteration (cubic convergence
 * on simple roots, every root simultaneously) after stripping exact roots at 0
 * and ∞, then polished with Newton. A root of multiplicity m is only ever
 * locatable to ~ε^{1/m} in floating point, whatever the algorithm — for a
 * spin-3 coherent state (a six-fold root) that is ~2·10⁻³ on the sphere,
 * invisible on screen and accounted for in the tests.
 */

import type { Complex } from '@/lib/quantum'

export type { Complex }

// ── Tiny complex toolkit (kept local so this module has no runtime imports) ──

export const cx = (re: number, im = 0): Complex => ({ re, im })
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })
const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })
const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const scale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s })
const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im
const abs = (a: Complex): number => Math.hypot(a.re, a.im)
const div = (a: Complex, b: Complex): Complex => {
  const d = abs2(b)
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im })
const expi = (t: number): Complex => ({ re: Math.cos(t), im: Math.sin(t) })

// ── Combinatorics ──

/** Binomial coefficient C(n, k) as a float; exact for the small n used here. */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}

// ── Polynomial root finding ──

export interface RootResult {
  /** Finite roots, in no particular order. */
  roots: Complex[]
  /** Number of roots at z = ∞ (the degree deficit from vanishing leading coefficients). */
  atInfinity: number
}

/** Evaluate Σ coef[i] z^i by Horner's rule. */
export function evalPoly(coef: readonly Complex[], z: Complex): Complex {
  let acc = cx(0)
  for (let i = coef.length - 1; i >= 0; i--) acc = add(mul(acc, z), coef[i])
  return acc
}

/** Derivative of Σ coef[i] z^i, evaluated at z. */
function evalPolyDeriv(coef: readonly Complex[], z: Complex): Complex {
  let acc = cx(0)
  for (let i = coef.length - 1; i >= 1; i--) acc = add(mul(acc, z), scale(coef[i], i))
  return acc
}

/**
 * Multiply out ∏(z − rᵢ) into ascending coefficients. Used by the tests to build
 * polynomials with known roots, and by nothing on the hot path.
 */
export function polyFromRoots(roots: readonly Complex[]): Complex[] {
  let coef: Complex[] = [cx(1)]
  for (const r of roots) {
    const next: Complex[] = new Array<Complex>(coef.length + 1).fill(cx(0))
    for (let i = 0; i < coef.length; i++) {
      next[i + 1] = add(next[i + 1], coef[i])
      next[i] = sub(next[i], mul(coef[i], r))
    }
    coef = next
  }
  return coef
}

/**
 * All roots of Σ coef[i] z^i, ascending coefficient order.
 *
 * `degree` is the nominal degree (the array length − 1 unless given). Leading
 * coefficients that are zero relative to the largest one are counted as roots at
 * infinity; trailing zeros are roots at exactly 0. What remains is solved by
 * Aberth–Ehrlich from a circle of starting points, then Newton-polished.
 */
export function polynomialRoots(
  coefficients: readonly Complex[],
  options: { degree?: number; relTol?: number } = {}
): RootResult {
  const degree = options.degree ?? coefficients.length - 1
  const relTol = options.relTol ?? 1e-12
  const coef = coefficients.slice(0, degree + 1)
  while (coef.length < degree + 1) coef.push(cx(0))

  let maxAbs = 0
  for (const c of coef) maxAbs = Math.max(maxAbs, abs(c))
  if (maxAbs === 0) return { roots: [], atInfinity: degree }
  const zeroTol = maxAbs * relTol

  // Roots at infinity: leading coefficients that vanish.
  let hi = coef.length - 1
  while (hi > 0 && abs(coef[hi]) <= zeroTol) hi--
  const atInfinity = coef.length - 1 - hi

  // Roots at zero: trailing coefficients that vanish.
  let lo = 0
  while (lo < hi && abs(coef[lo]) <= zeroTol) lo++
  const roots: Complex[] = []
  for (let i = 0; i < lo; i++) roots.push(cx(0))

  const p = coef.slice(lo, hi + 1)
  const n = p.length - 1
  if (n === 0) return { roots, atInfinity }

  // Monic, ascending.
  const lead = p[n]
  const monic = p.map((c) => div(c, lead))

  if (n === 1) {
    roots.push(scale(monic[0], -1))
    return { roots, atInfinity }
  }
  if (n === 2) {
    // z² + b z + c: stable quadratic (the larger root by the formula, the other by Vieta).
    const b = monic[1]
    const c = monic[0]
    const disc = csqrt(sub(mul(b, b), scale(c, 4)))
    // Pick the sign for which b + s does NOT cancel; the other root comes from
    // Vieta (r1 · r2 = c), which is exact where the formula would lose digits.
    const s = b.re * disc.re + b.im * disc.im >= 0 ? disc : scale(disc, -1)
    const r1 = scale(add(b, s), -0.5)
    const r2 = abs(r1) > 0 ? div(c, r1) : scale(sub(s, b), 0.5)
    roots.push(r1, r2)
    return { roots, atInfinity }
  }

  // Aberth–Ehrlich. Start on a circle whose radius is the geometric mean of a
  // Cauchy-style bound and the smallest-root bound, offset by an irrational-ish
  // angle so no starting point sits on a symmetry axis of the polynomial.
  let bound = 0
  for (let i = 0; i < n; i++) bound = Math.max(bound, abs(monic[i]))
  const upper = 1 + bound
  const radius = Math.max(1e-3, Math.min(upper, Math.pow(abs(monic[0]), 1 / n) || upper * 0.5))
  const z: Complex[] = []
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / n + 0.4
    z.push(scale(expi(ang), radius))
  }

  const MAX_ITER = 400
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let maxStep = 0
    for (let i = 0; i < n; i++) {
      const pz = evalPoly(monic, z[i])
      const dpz = evalPolyDeriv(monic, z[i])
      if (abs(pz) === 0) continue
      // Newton ratio, guarded against a zero derivative by a nudge.
      let ratio: Complex
      if (abs(dpz) < 1e-300) {
        ratio = cx(1e-8, 1e-8)
      } else {
        ratio = div(pz, dpz)
      }
      let sumInv = cx(0)
      for (let k = 0; k < n; k++) {
        if (k === i) continue
        const d = sub(z[i], z[k])
        if (abs2(d) < 1e-300) {
          // Two iterates collapsed: separate them and move on.
          z[k] = add(z[k], cx(1e-6, 1e-6))
          continue
        }
        sumInv = add(sumInv, div(cx(1), d))
      }
      const denom = sub(cx(1), mul(ratio, sumInv))
      const step = abs(denom) < 1e-300 ? ratio : div(ratio, denom)
      z[i] = sub(z[i], step)
      maxStep = Math.max(maxStep, abs(step) / Math.max(1, abs(z[i])))
    }
    if (maxStep < 1e-15) break
  }

  // Newton polish: a few steps sharpen simple roots to machine precision and are
  // harmless (monotone) at multiple roots.
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < 3; s++) {
      const pz = evalPoly(monic, z[i])
      const dpz = evalPolyDeriv(monic, z[i])
      if (abs(dpz) < 1e-300) break
      const step = div(pz, dpz)
      if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) break
      const next = sub(z[i], step)
      if (abs(evalPoly(monic, next)) > abs(pz)) break
      z[i] = next
    }
    roots.push(z[i])
  }
  return { roots, atInfinity }
}

/** Principal square root of a complex number. */
function csqrt(a: Complex): Complex {
  const r = abs(a)
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2))
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2))
  return { re, im: a.im < 0 ? -im : im }
}

// ── The sphere ──

/** A unit vector in Bloch coordinates (+z = |0⟩ = north). */
export interface Star {
  x: number
  y: number
  z: number
  /** Polar angle from +z, in [0, π]. */
  theta: number
  /** Azimuth from +x toward +y, in (−π, π]. */
  phi: number
}

/** Build a Star from spherical angles. */
export function starFromAngles(theta: number, phi: number): Star {
  return {
    x: Math.sin(theta) * Math.cos(phi),
    y: Math.sin(theta) * Math.sin(phi),
    z: Math.cos(theta),
    theta,
    phi: Math.atan2(Math.sin(phi), Math.cos(phi)),
  }
}

/**
 * Inverse stereographic projection from the south pole: ζ = tan(θ/2) e^{iφ}.
 * ζ = 0 is the north pole, |ζ| = 1 the equator, and ζ → ∞ the south pole.
 */
export function stereographicToStar(zeta: Complex): Star {
  const r2 = abs2(zeta)
  if (!Number.isFinite(r2)) return starFromAngles(Math.PI, 0)
  const d = 1 + r2
  const x = (2 * zeta.re) / d
  const y = (2 * zeta.im) / d
  const z = (1 - r2) / d
  return {
    x,
    y,
    z,
    theta: Math.atan2(Math.hypot(x, y), z),
    phi: r2 === 0 ? 0 : Math.atan2(zeta.im, zeta.re),
  }
}

/** The star at the south pole — where every root at infinity lands. */
export const SOUTH_POLE: Star = { x: 0, y: 0, z: -1, theta: Math.PI, phi: 0 }

/** Angle in radians between two stars (great-circle distance on the unit sphere). */
export function angleBetween(a: Star, b: Star): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

// ── Spin-j states ──

/** Spin quantum number of an amplitude array of length 2j+1. */
export function spinOf(amplitudes: readonly Complex[]): number {
  return (amplitudes.length - 1) / 2
}

/** Squared norm Σ|amp|². */
export function normSquared(amplitudes: readonly Complex[]): number {
  let s = 0
  for (const a of amplitudes) s += abs2(a)
  return s
}

/** Rescale to unit norm (a zero vector is returned unchanged). */
export function normalize(amplitudes: readonly Complex[]): Complex[] {
  const n = Math.sqrt(normSquared(amplitudes))
  if (n === 0) return amplitudes.slice()
  return amplitudes.map((a) => scale(a, 1 / n))
}

/**
 * The Majorana polynomial's coefficients in ASCENDING order of z, so the array
 * can go straight into polynomialRoots. Index i holds the coefficient of z^i,
 * which belongs to k = 2j − i.
 */
export function majoranaPolynomial(amplitudes: readonly Complex[]): Complex[] {
  const twoJ = amplitudes.length - 1
  const coef: Complex[] = new Array<Complex>(twoJ + 1)
  for (let k = 0; k <= twoJ; k++) {
    const sign = k % 2 === 0 ? 1 : -1
    coef[twoJ - k] = scale(amplitudes[k], sign * Math.sqrt(binomial(twoJ, k)))
  }
  return coef
}

/**
 * The 2j Majorana stars of a spin-j state. Always returns exactly 2j stars;
 * roots at infinity come back as the south pole. A zero state returns 2j
 * south-pole stars rather than throwing.
 */
export function majoranaStars(amplitudes: readonly Complex[]): Star[] {
  const twoJ = amplitudes.length - 1
  if (twoJ < 1) return []
  const { roots, atInfinity } = polynomialRoots(majoranaPolynomial(amplitudes), { degree: twoJ })
  const stars = roots.map(stereographicToStar)
  for (let i = 0; i < atInfinity; i++) stars.push({ ...SOUTH_POLE })
  return stars
}

/**
 * Spin coherent state |θ, φ⟩ = (cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩)^{⊗2j},
 * expressed in the |j, m⟩ basis (m descending). All 2j stars sit at (θ, φ).
 */
export function spinCoherentState(twoJ: number, theta: number, phi: number): Complex[] {
  const c = Math.cos(theta / 2)
  const s = Math.sin(theta / 2)
  const out: Complex[] = []
  for (let k = 0; k <= twoJ; k++) {
    const mag = Math.sqrt(binomial(twoJ, k)) * Math.pow(c, twoJ - k) * Math.pow(s, k)
    out.push(scale(expi(k * phi), mag))
  }
  return out
}

/** |j, m⟩ as a basis vector, m descending. */
export function spinBasisState(twoJ: number, m: number): Complex[] {
  const k = Math.round(twoJ / 2 - m)
  if (k < 0 || k > twoJ) throw new RangeError(`m = ${m} is not in the spin-${twoJ / 2} multiplet`)
  return Array.from({ length: twoJ + 1 }, (_, i) => cx(i === k ? 1 : 0))
}

/**
 * The n-qubit Dicke state with k excitations, as spin-n/2 amplitudes. Dicke
 * states ARE the |j, m = n/2 − k⟩ basis states; the alias exists so multi-qubit
 * callers can think in qubits.
 */
export function dickeState(n: number, k: number): Complex[] {
  return spinBasisState(n, n / 2 - k)
}

/** GHZ_n = (|0…0⟩ + |1…1⟩)/√2, as spin-n/2 amplitudes: a regular n-gon of stars on the equator. */
export function ghzState(n: number): Complex[] {
  const out = Array.from({ length: n + 1 }, () => cx(0))
  out[0] = cx(Math.SQRT1_2)
  out[n] = cx(Math.SQRT1_2)
  return out
}

/** W_n = the Dicke state with one excitation: n−1 stars at the north pole, one at the south. */
export function wState(n: number): Complex[] {
  return dickeState(n, 1)
}

/**
 * Project a 2^n-dimensional statevector (any qubit ordering — the symmetric
 * subspace does not care) onto the Dicke basis. `amplitudes` is the spin-n/2
 * state, normalised; `symmetricWeight` is the fraction of the input's norm
 * that lived in the symmetric subspace (1 for GHZ, W, Dicke and product-of-
 * identical-qubits states; less for anything else, in which case the stars
 * describe only the symmetric part).
 */
export function symmetricProjection(
  statevector: readonly Complex[],
  numQubits: number
): { amplitudes: Complex[]; symmetricWeight: number } {
  const dim = 1 << numQubits
  if (statevector.length !== dim) {
    throw new RangeError(`expected ${dim} amplitudes for ${numQubits} qubits, got ${statevector.length}`)
  }
  const sums: Complex[] = Array.from({ length: numQubits + 1 }, () => cx(0))
  for (let idx = 0; idx < dim; idx++) {
    let k = 0
    for (let b = idx; b > 0; b >>= 1) k += b & 1
    sums[k] = add(sums[k], statevector[idx])
  }
  const amplitudes = sums.map((s, k) => scale(s, 1 / Math.sqrt(binomial(numQubits, k))))
  const total = normSquared(statevector)
  const symmetricWeight = total === 0 ? 0 : normSquared(amplitudes) / total
  return { amplitudes: normalize(amplitudes), symmetricWeight }
}

// ── Spin operators and small-matrix exponentials ──

export type CMatrix = Complex[][]

/** J_z = diag(j, j−1, …, −j). */
export function spinZ(twoJ: number): CMatrix {
  const d = twoJ + 1
  return Array.from({ length: d }, (_, r) =>
    Array.from({ length: d }, (_, c) => cx(r === c ? twoJ / 2 - r : 0))
  )
}

/** J₊ |j,m⟩ = √(j(j+1) − m(m+1)) |j,m+1⟩. Row index r ↔ m = j − r. */
function spinRaise(twoJ: number): CMatrix {
  const d = twoJ + 1
  const j = twoJ / 2
  const out: CMatrix = Array.from({ length: d }, () => Array.from({ length: d }, () => cx(0)))
  for (let c = 1; c < d; c++) {
    const m = j - c
    out[c - 1][c] = cx(Math.sqrt(j * (j + 1) - m * (m + 1)))
  }
  return out
}

function matAdd(a: CMatrix, b: CMatrix, sa = 1, sb = 1): CMatrix {
  return a.map((row, r) => row.map((v, c) => add(scale(v, sa), scale(b[r][c], sb))))
}

function matScale(a: CMatrix, s: Complex): CMatrix {
  return a.map((row) => row.map((v) => mul(v, s)))
}

function matMul(a: CMatrix, b: CMatrix): CMatrix {
  const n = a.length
  const out: CMatrix = Array.from({ length: n }, () => Array.from({ length: n }, () => cx(0)))
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      const ark = a[r][k]
      if (ark.re === 0 && ark.im === 0) continue
      for (let c = 0; c < n; c++) out[r][c] = add(out[r][c], mul(ark, b[k][c]))
    }
  }
  return out
}

function identity(n: number): CMatrix {
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => cx(r === c ? 1 : 0)))
}

/** J_x = (J₊ + J₋)/2. J₋ is the transpose of the real matrix J₊. */
export function spinX(twoJ: number): CMatrix {
  const p = spinRaise(twoJ)
  const m = transpose(p)
  return matAdd(p, m, 0.5, 0.5)
}

/** J_y = (J₊ − J₋)/(2i). */
export function spinY(twoJ: number): CMatrix {
  const p = spinRaise(twoJ)
  const m = transpose(p)
  return matScale(matAdd(p, m, 1, -1), cx(0, -0.5))
}

function transpose(a: CMatrix): CMatrix {
  return a[0].map((_, c) => a.map((row) => row[c]))
}

/** Matrix–vector product. */
export function applyMatrix(m: CMatrix, v: readonly Complex[]): Complex[] {
  return m.map((row) => row.reduce((acc, e, c) => add(acc, mul(e, v[c])), cx(0)))
}

/** Expectation ⟨v| M |v⟩ (real part; M is assumed Hermitian). */
export function expectation(m: CMatrix, v: readonly Complex[]): number {
  const mv = applyMatrix(m, v)
  let s = 0
  for (let i = 0; i < v.length; i++) s += mul(conj(v[i]), mv[i]).re
  return s
}

/**
 * exp(−i t H) for a small Hermitian H, by scaling-and-squaring with a Taylor
 * series. Dimension ≤ 7 here, so this is both cheap and accurate to ~1e-14.
 */
export function expMinusIH(h: CMatrix, t: number): CMatrix {
  const n = h.length
  let norm = 0
  for (const row of h) for (const v of row) norm = Math.max(norm, abs(v))
  const scaleBy = Math.abs(t) * norm * n
  const squarings = scaleBy > 0.5 ? Math.ceil(Math.log2(scaleBy / 0.5)) : 0
  const a = matScale(h, cx(0, -t / Math.pow(2, squarings)))
  // Taylor to order 16.
  let term = identity(n)
  let sum = identity(n)
  for (let k = 1; k <= 16; k++) {
    term = matScale(matMul(term, a), cx(1 / k))
    sum = matAdd(sum, term)
  }
  for (let s = 0; s < squarings; s++) sum = matMul(sum, sum)
  return sum
}

export type Axis = 'x' | 'y' | 'z'

/** exp(−i angle n·J): the SU(2) rotation of a spin-j state about axis n. */
export function rotationMatrix(twoJ: number, axis: Axis | [number, number, number], angle: number): CMatrix {
  let n: [number, number, number]
  if (axis === 'x') n = [1, 0, 0]
  else if (axis === 'y') n = [0, 1, 0]
  else if (axis === 'z') n = [0, 0, 1]
  else {
    const len = Math.hypot(...axis) || 1
    n = [axis[0] / len, axis[1] / len, axis[2] / len]
  }
  const h = matAdd(matAdd(spinX(twoJ), spinY(twoJ), n[0], n[1]), spinZ(twoJ), 1, n[2])
  return expMinusIH(h, angle)
}

/** Rotate a spin-j state about an axis. */
export function rotateState(amplitudes: readonly Complex[], axis: Axis | [number, number, number], angle: number): Complex[] {
  return applyMatrix(rotationMatrix(amplitudes.length - 1, axis, angle), amplitudes)
}

/**
 * One-axis twisting exp(−i χ J_z²) — the simplest non-rotation. Diagonal, so it is
 * applied directly: amp[k] ↦ e^{−iχ m²} amp[k]. On qubits it is (up to a phase)
 * exp(−i χ/2 Σ_{a<b} Z_a Z_b): a pairwise entangling interaction. For spin-1/2
 * it is a global phase, which is the whole point — one qubit has no room to squeeze.
 */
export function oneAxisTwist(amplitudes: readonly Complex[], chi: number): Complex[] {
  const j = spinOf(amplitudes)
  return amplitudes.map((a, k) => {
    const m = j - k
    return mul(a, expi(-chi * m * m))
  })
}

/**
 * Period of the twist e^{−iχJ²} up to a global phase. The relative phases are
 * e^{−iχ(m² − m′²)}: for integer j the differences m² − m′² are integers (period
 * 2π); for half-integer j, with m = (odd)/2, they are (a² − b²)/4 with a, b odd,
 * and a² − b² ≡ 0 (mod 8), so the differences are even integers (period π).
 * Halfway through the integer-j period, χ = π gives e^{−iπm²} = (−1)^m = R_z(π):
 * a squeezed state re-collapses to a rotated coherent state.
 */
export function twistPeriod(twoJ: number): number {
  return twoJ % 2 === 0 ? 2 * Math.PI : Math.PI
}

/** Twisting exp(−i χ J_n²) about any of the three axes. The z case is diagonal. */
export function twistAbout(amplitudes: readonly Complex[], axis: Axis, chi: number): Complex[] {
  if (axis === 'z') return oneAxisTwist(amplitudes, chi)
  const twoJ = amplitudes.length - 1
  const jn = axis === 'x' ? spinX(twoJ) : spinY(twoJ)
  return applyMatrix(expMinusIH(matMul(jn, jn), chi), amplitudes)
}

/** ⟨J⟩ = (⟨J_x⟩, ⟨J_y⟩, ⟨J_z⟩). A coherent state has |⟨J⟩| = j; nothing has more. */
export function meanSpin(amplitudes: readonly Complex[]): { x: number; y: number; z: number } {
  const twoJ = amplitudes.length - 1
  return {
    x: expectation(spinX(twoJ), amplitudes),
    y: expectation(spinY(twoJ), amplitudes),
    z: expectation(spinZ(twoJ), amplitudes),
  }
}

/** Largest pairwise angle between any two stars: 0 for a coherent state. */
export function constellationSpread(stars: readonly Star[]): number {
  let max = 0
  for (let i = 0; i < stars.length; i++) {
    for (let k = i + 1; k < stars.length; k++) max = Math.max(max, angleBetween(stars[i], stars[k]))
  }
  return max
}
