/**
 * lib/quantum/phasespace.ts — states of one bosonic mode in a truncated Fock
 * basis, and their Wigner and Husimi quasi-probability distributions on a grid.
 *
 * This is the engine behind /visualizations/wigner-function. It is plain
 * TypeScript with no DOM dependency so its numbers can be checked in node
 * against closed forms (see phasespace.test.ts).
 *
 * CONVENTIONS (ħ = 1, dimensionless quadratures)
 *
 *   x = (a + a†) / √2,   p = (a − a†) / (i√2),   [x, p] = i,   α = (x + i p) / √2
 *
 *   so a coherent state |α⟩ sits at ⟨x⟩ = √2 Re α, ⟨p⟩ = √2 Im α, and the vacuum
 *   has Δx² = Δp² = ½. Both distributions are normalised over the (x, p) plane:
 *
 *       ∫∫ W(x, p) dx dp = 1,       ∫∫ Q(x, p) dx dp = 1.
 *
 *   The vacuum is then W₀(x, p) = (1/π) exp(−x² − p²), with W₀(0, 0) = 1/π, and
 *   Q₀(x, p) = (1/2π) exp(−(x² + p²)/2). Note Q is often quoted per unit d²α;
 *   d²α = dx dp / 2, which is where the extra ½ comes from.
 *
 * WIGNER FUNCTION IN THE FOCK BASIS
 *
 *   For ρ = Σ ρ_mn |m⟩⟨n| the Wigner function is a finite sum of generalised
 *   Laguerre polynomials (Cahill & Glauber, Phys. Rev. 177, 1882 (1969), eq. 6.35;
 *   the same expansion QuTiP's `wigner(..., method='laguerre')` implements):
 *
 *     W(α) = (2/π) Σ_{m,n} ρ_mn ⟨n| D(α) Π D†(α) |m⟩
 *
 *   where Π = (−1)^{a†a} is the parity operator, and the matrix element for
 *   n ≥ m is
 *
 *     ⟨n| D Π D† |m⟩ = (−1)^m e^{−2|α|²} √(m!/n!) (2α)^{n−m} L_m^{(n−m)}(4|α|²)   … (1)
 *
 *   with L_m^{(k)} the generalised Laguerre polynomial. The n < m elements are
 *   the complex conjugates, so for Hermitian ρ the sum collapses to the
 *   diagonal plus twice the real part of the upper triangle. With 4|α|² =
 *   2(x² + p²) and 2α = √2 (x + i p) this gives, per (x, p) point,
 *
 *     W(x, p) = (1/π) e^{−(x² + p²)} [ Σ_m ρ_mm (−1)^m L_m(2r²)
 *                + 2 Re Σ_{n>m} ρ_mn (−1)^m √(m!/n!) (√2 (x + i p))^{n−m} L_m^{(n−m)}(2r²) ]
 *
 *   with r² = x² + p². Two checks that fall straight out of (1): the vacuum is
 *   the Gaussian above, and W(0, 0) = (1/π) Σ_n (−1)^n ρ_nn = ⟨Π⟩/π — the value
 *   at the origin is the mean parity, so any Fock state |n⟩ gives (−1)^n/π.
 *
 * HUSIMI Q FUNCTION
 *
 *     Q(α) = ⟨α|ρ|α⟩/π  (per d²α)  ⇒  Q(x, p) = ⟨α|ρ|α⟩/(2π)  (per dx dp),
 *     ⟨n|α⟩ = e^{−|α|²/2} αⁿ/√n!.
 *
 *   Q is a Gaussian smoothing of W (a convolution with the vacuum Wigner
 *   function), which is why it is non-negative everywhere while W need not be.
 *
 * TRUNCATION
 *
 *   Everything lives in the first `dim` Fock states. `truncatedNorm` reports
 *   how much of a state survived truncation; states here are built with a
 *   `dim` large enough that the loss is below 2e-6 for the parameter ranges
 *   the page exposes, and the integral tests guard that.
 */

// ── Complex helpers (arrays of re/im, no allocation in inner loops) ──────────

/** A pure state Σ c_n |n⟩ with c_n = re[n] + i im[n]. */
export type FockState = {
  dim: number
  re: Float64Array
  im: Float64Array
}

/** A density matrix ρ_mn = re[m·dim + n] + i im[m·dim + n], row-major. */
export type DensityMatrix = {
  dim: number
  re: Float64Array
  im: Float64Array
}

/** A scalar field sampled on a square (x, p) grid. `values[ip * n + ix]`. */
export type PhaseSpaceField = {
  /** Grid points per axis. */
  n: number
  /** Quadrature coordinates, both of length n, ascending, symmetric about 0. */
  xs: Float64Array
  ps: Float64Array
  /** Field value at (xs[ix], ps[ip]) is `values[ip * n + ix]`. */
  values: Float64Array
  /** Grid spacing (identical on both axes). */
  step: number
}

/** log(n!) for n up to the largest truncation this module allows. */
const MAX_DIM = 128
const LOG_FACT = new Float64Array(MAX_DIM + 1)
for (let n = 1; n <= MAX_DIM; n++) LOG_FACT[n] = LOG_FACT[n - 1] + Math.log(n)

/** √(m!/n!) for m ≤ n, computed in log space to avoid factorial overflow. */
export function sqrtFactorialRatio(m: number, n: number): number {
  return Math.exp(0.5 * (LOG_FACT[m] - LOG_FACT[n]))
}

function assertDim(dim: number): void {
  if (!Number.isInteger(dim) || dim < 1 || dim > MAX_DIM) {
    throw new RangeError(`Fock dimension must be an integer in [1, ${MAX_DIM}], got ${dim}`)
  }
}

function emptyState(dim: number): FockState {
  assertDim(dim)
  return { dim, re: new Float64Array(dim), im: new Float64Array(dim) }
}

/** Σ |c_n|² — 1 for a state that fits in the truncation, less if it does not. */
export function truncatedNorm(state: FockState): number {
  let s = 0
  for (let n = 0; n < state.dim; n++) s += state.re[n] ** 2 + state.im[n] ** 2
  return s
}

/** Rescale to unit norm in place (a no-op on a null vector). Returns the state. */
export function normalize(state: FockState): FockState {
  const norm = Math.sqrt(truncatedNorm(state))
  if (norm > 0) {
    for (let n = 0; n < state.dim; n++) {
      state.re[n] /= norm
      state.im[n] /= norm
    }
  }
  return state
}

/** Mean photon number ⟨a†a⟩ = Σ n |c_n|² of a pure state. */
export function meanPhotonNumber(state: FockState): number {
  let s = 0
  for (let n = 0; n < state.dim; n++) s += n * (state.re[n] ** 2 + state.im[n] ** 2)
  return s
}

// ── States ───────────────────────────────────────────────────────────────────

/** The number state |n⟩. */
export function fockState(n: number, dim: number): FockState {
  const s = emptyState(dim)
  if (!Number.isInteger(n) || n < 0 || n >= dim) {
    throw new RangeError(`Fock state |${n}⟩ does not fit in dimension ${dim}`)
  }
  s.re[n] = 1
  return s
}

/**
 * The coherent state |α⟩ = e^{−|α|²/2} Σ αⁿ/√n! |n⟩, exactly as truncated —
 * NOT renormalised, so `truncatedNorm` reports how much was lost.
 */
export function coherentState(alphaRe: number, alphaIm: number, dim: number): FockState {
  const s = emptyState(dim)
  const mag2 = alphaRe * alphaRe + alphaIm * alphaIm
  const pre = Math.exp(-mag2 / 2)
  // Build αⁿ/√n! by recurrence: term_{n} = term_{n−1} · α / √n.
  let re = pre
  let im = 0
  for (let n = 0; n < dim; n++) {
    s.re[n] = re
    s.im[n] = im
    const k = 1 / Math.sqrt(n + 1)
    const nre = (re * alphaRe - im * alphaIm) * k
    const nim = (re * alphaIm + im * alphaRe) * k
    re = nre
    im = nim
  }
  return s
}

/**
 * A Schrödinger cat state N(|α⟩ ± |−α⟩), with the exact normalisation
 * N = 1/√(2(1 ± e^{−2|α|²})). Even cats contain only even photon numbers,
 * odd cats only odd — that is what makes their Wigner functions carry
 * interference fringes between the two coherent lobes.
 */
export function catState(
  alphaRe: number,
  alphaIm: number,
  parity: 'even' | 'odd',
  dim: number
): FockState {
  const plus = coherentState(alphaRe, alphaIm, dim)
  const minus = coherentState(-alphaRe, -alphaIm, dim)
  const sign = parity === 'even' ? 1 : -1
  const mag2 = alphaRe * alphaRe + alphaIm * alphaIm
  const norm = 1 / Math.sqrt(2 * (1 + sign * Math.exp(-2 * mag2)))
  const s = emptyState(dim)
  for (let n = 0; n < dim; n++) {
    s.re[n] = norm * (plus.re[n] + sign * minus.re[n])
    s.im[n] = norm * (plus.im[n] + sign * minus.im[n])
  }
  return s
}

/**
 * Squeezed vacuum S(ξ)|0⟩ with ξ = r e^{iθ} (Gerry & Knight eq. 7.71):
 *
 *   S(ξ)|0⟩ = (1/√cosh r) Σ_k (−e^{iθ} tanh r)^k √((2k)!) / (2^k k!) |2k⟩.
 *
 * With θ = 0 the x quadrature is squeezed: Δx² = e^{−2r}/2, Δp² = e^{2r}/2, and
 * the Wigner function is the Gaussian (1/π) exp(−e^{2r} x² − e^{−2r} p²). The
 * photon-number tail decays only like (tanh r)^{2k}, so the truncation needs
 * to be generous — r = 1.2 keeps 1 − norm below 2e-6 at dim = 64.
 */
export function squeezedVacuum(r: number, theta: number, dim: number): FockState {
  const s = emptyState(dim)
  const t = Math.tanh(r)
  const pre = 1 / Math.sqrt(Math.cosh(r))
  // (−e^{iθ} t)^k · √((2k)!)/(2^k k!), by recurrence on k:
  //   ratio_k / ratio_{k−1} = √((2k)(2k−1)) / (2k) = √((2k − 1) / (2k)).
  let re = pre
  let im = 0
  const fre = -t * Math.cos(theta)
  const fim = -t * Math.sin(theta)
  for (let k = 0; 2 * k < dim; k++) {
    s.re[2 * k] = re
    s.im[2 * k] = im
    const kk = k + 1
    const ratio = Math.sqrt((2 * kk - 1) / (2 * kk))
    const nre = (re * fre - im * fim) * ratio
    const nim = (re * fim + im * fre) * ratio
    re = nre
    im = nim
  }
  return s
}

/** ρ = |ψ⟩⟨ψ|. */
export function pureDensityMatrix(state: FockState): DensityMatrix {
  const { dim } = state
  const re = new Float64Array(dim * dim)
  const im = new Float64Array(dim * dim)
  for (let m = 0; m < dim; m++) {
    for (let n = 0; n < dim; n++) {
      // ρ_mn = c_m c_n*
      re[m * dim + n] = state.re[m] * state.re[n] + state.im[m] * state.im[n]
      im[m * dim + n] = state.im[m] * state.re[n] - state.re[m] * state.im[n]
    }
  }
  return { dim, re, im }
}

/**
 * A thermal state with mean photon number n̄: ρ_nn = n̄ⁿ / (1 + n̄)^{n+1},
 * diagonal in the Fock basis. Its Wigner function is the broadened Gaussian
 * (1/(π(2n̄ + 1))) exp(−(x² + p²)/(2n̄ + 1)) — classical noise, never negative.
 */
export function thermalState(nbar: number, dim: number): DensityMatrix {
  assertDim(dim)
  if (!(nbar >= 0)) throw new RangeError(`thermal n̄ must be ≥ 0, got ${nbar}`)
  const re = new Float64Array(dim * dim)
  const im = new Float64Array(dim * dim)
  const ratio = nbar / (1 + nbar)
  let p = 1 / (1 + nbar)
  for (let n = 0; n < dim; n++) {
    re[n * dim + n] = p
    p *= ratio
  }
  return { dim, re, im }
}

/** Tr ρ — below 1 by exactly the weight the truncation dropped. */
export function trace(rho: DensityMatrix): number {
  let s = 0
  for (let n = 0; n < rho.dim; n++) s += rho.re[n * rho.dim + n]
  return s
}

/** ⟨a†a⟩ = Σ n ρ_nn for a density matrix. */
export function meanPhotonNumberOf(rho: DensityMatrix): number {
  let s = 0
  for (let n = 0; n < rho.dim; n++) s += n * rho.re[n * rho.dim + n]
  return s
}

/** ⟨Π⟩ = Σ (−1)ⁿ ρ_nn, the mean parity. Equals π · W(0, 0). */
export function meanParity(rho: DensityMatrix): number {
  let s = 0
  for (let n = 0; n < rho.dim; n++) s += (n % 2 === 0 ? 1 : -1) * rho.re[n * rho.dim + n]
  return s
}

// ── Grid ─────────────────────────────────────────────────────────────────────

/** An n × n grid covering [−extent, extent] on both quadratures. */
export function phaseSpaceGrid(n: number, extent: number): Pick<PhaseSpaceField, 'n' | 'xs' | 'ps' | 'step'> {
  if (!Number.isInteger(n) || n < 2) throw new RangeError(`grid size must be an integer ≥ 2, got ${n}`)
  if (!(extent > 0)) throw new RangeError(`grid extent must be > 0, got ${extent}`)
  const xs = new Float64Array(n)
  const step = (2 * extent) / (n - 1)
  for (let i = 0; i < n; i++) xs[i] = -extent + i * step
  return { n, xs, ps: xs.slice(), step }
}

// ── Wigner ───────────────────────────────────────────────────────────────────

/**
 * Fill `out[k]` with L_m^{(k)}(z) for m = 0..count−1 by the three-term recurrence
 *   L_0 = 1,  L_1 = 1 + k − z,
 *   (m+1) L_{m+1} = (2m + 1 + k − z) L_m − (m + k) L_{m−1}.
 */
export function laguerreColumn(k: number, z: number, count: number, out: Float64Array): void {
  if (count <= 0) return
  out[0] = 1
  if (count === 1) return
  out[1] = 1 + k - z
  for (let m = 1; m + 1 < count; m++) {
    out[m + 1] = ((2 * m + 1 + k - z) * out[m] - (m + k) * out[m - 1]) / (m + 1)
  }
}

/** Generalised Laguerre L_n^{(k)}(z), for tests and one-off use. */
export function laguerre(n: number, k: number, z: number): number {
  const col = new Float64Array(n + 1)
  laguerreColumn(k, z, n + 1, col)
  return col[n]
}

/**
 * The Wigner function of ρ on a grid, normalised so ∫∫ W dx dp = 1.
 *
 * Cost per grid point is O(dim²): every Laguerre column L_·^{(k)} is generated
 * by recurrence once, then the double sum is read off. Matrix elements below
 * `eps` in magnitude are skipped, which turns a diagonal (thermal) ρ into an
 * O(dim) sum and a sparse cat state into a fraction of the full work.
 */
export function wignerFunction(
  rho: DensityMatrix,
  grid: Pick<PhaseSpaceField, 'n' | 'xs' | 'ps' | 'step'>,
  eps = 1e-14
): PhaseSpaceField {
  const { dim } = rho
  const { n, xs, ps, step } = grid
  const values = new Float64Array(n * n)

  // Which (m, n≥m) pairs actually contribute, with their prefactors folded in:
  //   diag:   c = ρ_mm (−1)^m
  //   upper:  c = 2 ρ_mn (−1)^m √(m!/n!)           (complex)
  const diagIdx: number[] = []
  const diagCoef: number[] = []
  const upM: number[] = []
  const upK: number[] = []
  const upRe: number[] = []
  const upIm: number[] = []
  for (let m = 0; m < dim; m++) {
    const sign = m % 2 === 0 ? 1 : -1
    const d = rho.re[m * dim + m]
    if (Math.abs(d) > eps) {
      diagIdx.push(m)
      diagCoef.push(sign * d)
    }
    for (let nn = m + 1; nn < dim; nn++) {
      const r = rho.re[m * dim + nn]
      const i = rho.im[m * dim + nn]
      if (Math.abs(r) > eps || Math.abs(i) > eps) {
        const f = 2 * sign * sqrtFactorialRatio(m, nn)
        upM.push(m)
        upK.push(nn - m)
        upRe.push(r * f)
        upIm.push(i * f)
      }
    }
  }
  // Which off-diagonal orders k = n − m occur at all, and how many m's each needs.
  const kNeeded = new Int32Array(dim) // max m+1 per k, 0 if unused
  for (let j = 0; j < upM.length; j++) {
    kNeeded[upK[j]] = Math.max(kNeeded[upK[j]], upM[j] + 1)
  }
  let diagCount = 0
  for (const m of diagIdx) diagCount = Math.max(diagCount, m + 1)

  // Scratch: Laguerre columns for k = 0..dim−1, and powers of 2α = √2(x + ip).
  const lag = new Float64Array(dim * dim)
  const powRe = new Float64Array(dim)
  const powIm = new Float64Array(dim)
  const SQ2 = Math.SQRT2

  for (let ip = 0; ip < n; ip++) {
    const p = ps[ip]
    for (let ix = 0; ix < n; ix++) {
      const x = xs[ix]
      const r2 = x * x + p * p
      const z = 2 * r2 // 4|α|²
      const envelope = Math.exp(-r2) / Math.PI

      // L_m^{(0)} for the diagonal.
      laguerreColumn(0, z, Math.max(diagCount, kNeeded[0]), lag)
      let sum = 0
      for (let j = 0; j < diagIdx.length; j++) sum += diagCoef[j] * lag[diagIdx[j]]

      if (upM.length > 0) {
        // (2α)^k by repeated multiplication.
        const bre = SQ2 * x
        const bim = SQ2 * p
        powRe[0] = 1
        powIm[0] = 0
        for (let k = 1; k < dim; k++) {
          powRe[k] = powRe[k - 1] * bre - powIm[k - 1] * bim
          powIm[k] = powRe[k - 1] * bim + powIm[k - 1] * bre
        }
        for (let k = 1; k < dim; k++) {
          if (kNeeded[k] > 0) laguerreColumn(k, z, kNeeded[k], lag.subarray(k * dim))
        }
        for (let j = 0; j < upM.length; j++) {
          const k = upK[j]
          const L = lag[k * dim + upM[j]]
          // Re[ c · (2α)^k ] · L
          sum += (upRe[j] * powRe[k] - upIm[j] * powIm[k]) * L
        }
      }
      values[ip * n + ix] = envelope * sum
    }
  }
  return { n, xs: xs, ps: ps, values, step }
}

/** Wigner function of a pure state — builds ρ = |ψ⟩⟨ψ| and calls `wignerFunction`. */
export function wignerOfState(
  state: FockState,
  grid: Pick<PhaseSpaceField, 'n' | 'xs' | 'ps' | 'step'>
): PhaseSpaceField {
  return wignerFunction(pureDensityMatrix(state), grid)
}

// ── Husimi Q ─────────────────────────────────────────────────────────────────

/**
 * The Husimi function Q(x, p) = ⟨α|ρ|α⟩ / (2π), α = (x + ip)/√2, normalised
 * so ∫∫ Q dx dp = 1. Evaluated as Q = (1/2π) e^{−|α|²} v† ρ v with
 * v_n = αⁿ/√n!, which is O(dim²) per point for a general ρ.
 */
export function husimiFunction(
  rho: DensityMatrix,
  grid: Pick<PhaseSpaceField, 'n' | 'xs' | 'ps' | 'step'>
): PhaseSpaceField {
  const { dim } = rho
  const { n, xs, ps, step } = grid
  const values = new Float64Array(n * n)
  const vRe = new Float64Array(dim)
  const vIm = new Float64Array(dim)
  const wRe = new Float64Array(dim)
  const wIm = new Float64Array(dim)

  for (let ip = 0; ip < n; ip++) {
    const aim = ps[ip] / Math.SQRT2
    for (let ix = 0; ix < n; ix++) {
      const are = xs[ix] / Math.SQRT2
      const mag2 = are * are + aim * aim
      // v_n = αⁿ/√n!
      vRe[0] = 1
      vIm[0] = 0
      for (let k = 1; k < dim; k++) {
        const inv = 1 / Math.sqrt(k)
        vRe[k] = (vRe[k - 1] * are - vIm[k - 1] * aim) * inv
        vIm[k] = (vRe[k - 1] * aim + vIm[k - 1] * are) * inv
      }
      // w = ρ v
      for (let m = 0; m < dim; m++) {
        let sr = 0
        let si = 0
        const row = m * dim
        for (let k = 0; k < dim; k++) {
          const rr = rho.re[row + k]
          const ri = rho.im[row + k]
          if (rr === 0 && ri === 0) continue
          sr += rr * vRe[k] - ri * vIm[k]
          si += rr * vIm[k] + ri * vRe[k]
        }
        wRe[m] = sr
        wIm[m] = si
      }
      // v† w  (real for Hermitian ρ; the imaginary part is round-off)
      let dot = 0
      for (let m = 0; m < dim; m++) dot += vRe[m] * wRe[m] + vIm[m] * wIm[m]
      values[ip * n + ix] = (Math.exp(-mag2) * dot) / (2 * Math.PI)
    }
  }
  return { n, xs, ps, values, step }
}

/** Husimi function of a pure state. */
export function husimiOfState(
  state: FockState,
  grid: Pick<PhaseSpaceField, 'n' | 'xs' | 'ps' | 'step'>
): PhaseSpaceField {
  return husimiFunction(pureDensityMatrix(state), grid)
}

// ── Field statistics ─────────────────────────────────────────────────────────

export type FieldStats = {
  min: number
  max: number
  /** Riemann sum ∫∫ f dx dp on the grid. */
  integral: number
  /** ∫∫ |f| dx dp − ∫∫ f dx dp = twice the negative volume. Zero iff f ≥ 0. */
  negativeVolume: number
  /** Value at the grid point nearest the origin. */
  origin: number
}

export function fieldStats(field: PhaseSpaceField): FieldStats {
  const { n, values, step } = field
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let abs = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    abs += Math.abs(v)
  }
  const area = step * step
  const c = Math.floor(n / 2)
  return {
    min,
    max,
    integral: sum * area,
    negativeVolume: (abs - sum) * area,
    origin: values[c * n + c],
  }
}

/** Sample a field at an arbitrary (x, p) by bilinear interpolation; NaN outside. */
export function sampleField(field: PhaseSpaceField, x: number, p: number): number {
  const { n, xs, ps, values, step } = field
  const fx = (x - xs[0]) / step
  const fp = (p - ps[0]) / step
  if (!(fx >= 0 && fx <= n - 1 && fp >= 0 && fp <= n - 1)) return NaN
  const ix = Math.min(n - 2, Math.floor(fx))
  const ip = Math.min(n - 2, Math.floor(fp))
  const tx = fx - ix
  const tp = fp - ip
  const v00 = values[ip * n + ix]
  const v01 = values[ip * n + ix + 1]
  const v10 = values[(ip + 1) * n + ix]
  const v11 = values[(ip + 1) * n + ix + 1]
  return (1 - tp) * ((1 - tx) * v00 + tx * v01) + tp * ((1 - tx) * v10 + tx * v11)
}

// ── The catalogue of states the page offers ──────────────────────────────────

export type PhaseSpaceStateKind = 'vacuum' | 'coherent' | 'fock' | 'cat' | 'squeezed' | 'thermal'

export type PhaseSpaceStateSpec =
  | { kind: 'vacuum' }
  | { kind: 'coherent'; alpha: number; phase: number }
  | { kind: 'fock'; n: number }
  | { kind: 'cat'; alpha: number; parity: 'even' | 'odd' }
  | { kind: 'squeezed'; r: number; theta: number }
  | { kind: 'thermal'; nbar: number }

/** Truncation that keeps every state the page offers to better than 1e-6. */
export const DEFAULT_FOCK_DIM = 64

/** Build the density matrix for a catalogue entry. */
export function densityMatrixFor(spec: PhaseSpaceStateSpec, dim = DEFAULT_FOCK_DIM): DensityMatrix {
  switch (spec.kind) {
    case 'vacuum':
      return pureDensityMatrix(fockState(0, dim))
    case 'coherent':
      return pureDensityMatrix(
        coherentState(spec.alpha * Math.cos(spec.phase), spec.alpha * Math.sin(spec.phase), dim)
      )
    case 'fock':
      return pureDensityMatrix(fockState(spec.n, dim))
    case 'cat':
      return pureDensityMatrix(catState(spec.alpha, 0, spec.parity, dim))
    case 'squeezed':
      return pureDensityMatrix(squeezedVacuum(spec.r, spec.theta, dim))
    case 'thermal':
      return thermalState(spec.nbar, dim)
  }
}

/**
 * The smallest truncation that keeps the state to better than 2e-6, so the
 * O(dim²) per-point cost is paid only where the photon-number tail needs it.
 * Poisson tails (coherent, cat) are cut at |α|² + 9|α| + 12; squeezed and
 * thermal tails are geometric and need the full default.
 */
export function suggestedDim(spec: PhaseSpaceStateSpec): number {
  const clamp = (d: number) => Math.max(2, Math.min(DEFAULT_FOCK_DIM, Math.ceil(d)))
  switch (spec.kind) {
    case 'vacuum':
      return 2
    case 'fock':
      return clamp(spec.n + 2)
    case 'coherent':
    case 'cat': {
      const a = Math.abs(spec.alpha)
      return clamp(a * a + 9 * a + 12)
    }
    case 'squeezed':
    case 'thermal':
      return DEFAULT_FOCK_DIM
  }
}

/** Half-width of a grid that comfortably contains the state's support. */
export function suggestedExtent(spec: PhaseSpaceStateSpec): number {
  // Sized for Q, the wider of the two: four standard deviations of the
  // broadest quadrature beyond the state's centre keeps ∫Q above 0.9995.
  const pad = 4
  switch (spec.kind) {
    case 'vacuum':
      return pad
    case 'coherent':
      return Math.SQRT2 * spec.alpha + pad
    case 'fock':
      return Math.sqrt(2 * spec.n) + pad
    case 'cat':
      return Math.SQRT2 * spec.alpha + pad
    case 'squeezed':
      return pad * Math.sqrt((Math.exp(2 * spec.r) + 1) / 2)
    case 'thermal':
      return pad * Math.sqrt(spec.nbar + 1)
  }
}
