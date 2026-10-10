/**
 * VQE: a real ansatz on a transverse-field Ising chain, its energy landscape, an
 * optimiser that walks it, and the barren-plateau measurement.
 *
 * ── The model ───────────────────────────────────────────────────────────────────
 *
 *     H = −J Σ Z_i Z_{i+1} − h Σ X_i          (open chain, n sites)
 *
 * Not a toy: this is the standard 1D transverse-field Ising model, the same
 * Hamiltonian every VQE tutorial starts from, and its ground state is a genuinely
 * entangled state for h comparable to J. `groundStateEnergy` finds the true minimum
 * by Lanczos so the page can show how far the variational answer actually is —
 * without that number, "the optimiser went down" says nothing.
 *
 * ── The ansatz ──────────────────────────────────────────────────────────────────
 *
 * L layers of: RY(θ) on every qubit, a ring of CZ, RX(φ) on every qubit. Both angles
 * are SHARED across all gates in all layers, which is what makes the landscape
 * two-dimensional and therefore drawable. A real VQE gives every gate its own
 * parameter; this restriction is a visualization choice and is stated on the page.
 *
 * One consequence worth knowing: because θ is shared, the parameter-shift rule does
 * not apply to it in its simple two-term form, so `gradientAt` uses central finite
 * differences. The barren-plateau measurement below uses a fully independent-parameter
 * ansatz precisely so that it CAN use parameter shift, which is exact — the whole
 * point of that panel is a number, and a finite-difference number would be dominated
 * by its own truncation error exactly where the gradient gets small.
 *
 * ── Statevector kernels ─────────────────────────────────────────────────────────
 *
 * Interleaved-free Float64Array pairs rather than lib/quantum's Complex objects: this
 * module runs a few million gate applications per landscape, and cMul allocating two
 * objects per amplitude is the difference between interactive and not.
 * `landscape.test.ts` cross-checks these kernels against `StateVector` so the speed
 * cannot come at the price of a different gate.
 */

import { StateVector } from '@/lib/quantum'

export type Wave = { re: Float64Array; im: Float64Array }

export function zeroState(n: number): Wave {
  const dim = 1 << n
  const re = new Float64Array(dim)
  const im = new Float64Array(dim)
  re[0] = 1
  return { re, im }
}

/** RY(θ): [[cos, −sin], [sin, cos]] with half-angles. Real matrix, so no im mixing. */
export function applyRY(w: Wave, q: number, theta: number): void {
  const c = Math.cos(theta / 2)
  const s = Math.sin(theta / 2)
  const bit = 1 << q
  const { re, im } = w
  for (let i = 0; i < re.length; i++) {
    if (i & bit) continue
    const j = i | bit
    const ar = re[i]
    const ai = im[i]
    const br = re[j]
    const bi = im[j]
    re[i] = c * ar - s * br
    im[i] = c * ai - s * bi
    re[j] = s * ar + c * br
    im[j] = s * ai + c * bi
  }
}

/** RX(θ): [[cos, −i sin], [−i sin, cos]] with half-angles. */
export function applyRX(w: Wave, q: number, theta: number): void {
  const c = Math.cos(theta / 2)
  const s = Math.sin(theta / 2)
  const bit = 1 << q
  const { re, im } = w
  for (let i = 0; i < re.length; i++) {
    if (i & bit) continue
    const j = i | bit
    const ar = re[i]
    const ai = im[i]
    const br = re[j]
    const bi = im[j]
    re[i] = c * ar + s * bi
    im[i] = c * ai - s * br
    re[j] = c * br + s * ai
    im[j] = c * bi - s * ar
  }
}

/** CZ: a sign flip on the amplitudes where both qubits read 1. */
export function applyCZ(w: Wave, q1: number, q2: number): void {
  if (q1 === q2) return
  const mask = (1 << q1) | (1 << q2)
  const { re, im } = w
  for (let i = 0; i < re.length; i++) {
    if ((i & mask) !== mask) continue
    re[i] = -re[i]
    im[i] = -im[i]
  }
}

export type Ising = {
  n: number
  /** Coupling. Positive J favours aligned neighbours. */
  J: number
  /** Transverse field. */
  h: number
}

/** ±1 spin of qubit q in basis state k. */
function spin(k: number, q: number): number {
  return 1 - 2 * ((k >> q) & 1)
}

/** ⟨ψ|H|ψ⟩ for the open-chain transverse-field Ising model. */
export function energyOf(w: Wave, model: Ising): number {
  const { n, J, h } = model
  const { re, im } = w
  const dim = re.length

  let zz = 0
  for (let k = 0; k < dim; k++) {
    const p = re[k] * re[k] + im[k] * im[k]
    if (p === 0) continue
    let acc = 0
    for (let i = 0; i < n - 1; i++) acc += spin(k, i) * spin(k, i + 1)
    zz += p * acc
  }

  // ⟨X_i⟩ = Σ_k Re(conj(ψ_k) ψ_{k⊕bit}). Summed over all k, so each pair is counted
  // twice — which is correct, the two orderings are the two off-diagonal terms.
  let x = 0
  for (let i = 0; i < n; i++) {
    const bit = 1 << i
    for (let k = 0; k < dim; k++) {
      const j = k ^ bit
      x += re[k] * re[j] + im[k] * im[j]
    }
  }

  return -J * zz - h * x
}

/**
 * The shared-parameter ansatz. L layers of RY(θ) everywhere, a CZ ring, RX(φ)
 * everywhere.
 *
 * The CZ ring is what makes this able to represent an entangled state at all — take
 * it out and every qubit stays in a product state, the landscape becomes separable,
 * and the whole thing reduces to a single-qubit optimisation that cannot reach the
 * ground state of a coupled model.
 */
export function ansatzState(model: Ising, layers: number, theta: number, phi: number): Wave {
  const { n } = model
  const w = zeroState(n)
  for (let l = 0; l < layers; l++) {
    for (let q = 0; q < n; q++) applyRY(w, q, theta)
    if (n === 2) {
      applyCZ(w, 0, 1)
    } else {
      for (let q = 0; q < n; q++) applyCZ(w, q, (q + 1) % n)
    }
    for (let q = 0; q < n; q++) applyRX(w, q, phi)
  }
  return w
}

export function energyAt(model: Ising, layers: number, theta: number, phi: number): number {
  return energyOf(ansatzState(model, layers, theta, phi), model)
}

/**
 * ∇E by central finite differences.
 *
 * EPS = 1e-4 was chosen, not guessed: with f'' of order 1 the truncation error is
 * ~EPS²/6 ≈ 2e-9 and the float64 cancellation error is ~1e-16/EPS ≈ 1e-12, so the
 * total sits near 1e-9 — small next to the gradients this landscape actually has
 * (order 0.1 to 10). Shrink it and cancellation wins; grow it and truncation does.
 */
const FD_EPS = 1e-4

export function gradientAt(
  model: Ising,
  layers: number,
  theta: number,
  phi: number
): { dTheta: number; dPhi: number } {
  const f = (t: number, p: number) => energyAt(model, layers, t, p)
  return {
    dTheta: (f(theta + FD_EPS, phi) - f(theta - FD_EPS, phi)) / (2 * FD_EPS),
    dPhi: (f(theta, phi + FD_EPS) - f(theta, phi - FD_EPS)) / (2 * FD_EPS),
  }
}

export type OptimiserState = {
  theta: number
  phi: number
  energy: number
  step: number
  /** The trail, for drawing. */
  path: { theta: number; phi: number; energy: number }[]
  /** Set once the step size has stopped moving the parameters. */
  converged: boolean
}

export function startOptimiser(
  model: Ising,
  layers: number,
  theta: number,
  phi: number
): OptimiserState {
  const energy = energyAt(model, layers, theta, phi)
  return { theta, phi, energy, step: 0, path: [{ theta, phi, energy }], converged: false }
}

/**
 * One gradient-descent step with a backtracking line search.
 *
 * Plain fixed-rate descent either crawls across the flat regions or overshoots the
 * narrow minima of this landscape depending on the rate; halving the step until the
 * energy actually decreases handles both without a rate slider that the learner would
 * have to tune before the demo does anything. `converged` is set when even a very
 * small step fails to improve — which is a real stopping condition, not a step count.
 */
export function optimiserStep(
  state: OptimiserState,
  model: Ising,
  layers: number,
  rate = 0.35
): OptimiserState {
  if (state.converged) return state
  const g = gradientAt(model, layers, state.theta, state.phi)
  const norm = Math.hypot(g.dTheta, g.dPhi)
  if (norm < 1e-7) {
    return { ...state, converged: true }
  }

  let alpha = rate
  for (let attempt = 0; attempt < 12; attempt++) {
    const theta = state.theta - alpha * g.dTheta
    const phi = state.phi - alpha * g.dPhi
    const energy = energyAt(model, layers, theta, phi)
    if (energy < state.energy - 1e-12) {
      const path = state.path.concat({ theta, phi, energy })
      // The trail is drawn; an unbounded one would grow without limit in a loop
      // that can run for minutes.
      if (path.length > 400) path.splice(0, path.length - 400)
      return { theta, phi, energy, step: state.step + 1, path, converged: false }
    }
    alpha /= 2
  }
  return { ...state, converged: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// The exact answer, for comparison
// ─────────────────────────────────────────────────────────────────────────────

/** H|v⟩ for the Ising model, on a real vector. H is real symmetric, so this suffices. */
function applyHamiltonian(v: Float64Array, out: Float64Array, model: Ising): void {
  const { n, J, h } = model
  const dim = v.length
  out.fill(0)
  for (let k = 0; k < dim; k++) {
    let zz = 0
    for (let i = 0; i < n - 1; i++) zz += spin(k, i) * spin(k, i + 1)
    out[k] += -J * zz * v[k]
  }
  for (let i = 0; i < n; i++) {
    const bit = 1 << i
    for (let k = 0; k < dim; k++) out[k] += -h * v[k ^ bit]
  }
}

/**
 * Lowest eigenvalue of H by Lanczos with full reorthogonalisation, then bisection on
 * the Sturm sequence of the resulting tridiagonal matrix.
 *
 * Full reorthogonalisation because without it the Lanczos vectors lose orthogonality
 * after ~20 steps in float64 and the method starts reporting spurious duplicate
 * eigenvalues — for a 1024-dimensional problem the O(m²·dim) cost of doing it
 * properly is a few million operations, computed once per (n, J, h).
 */
export function groundStateEnergy(model: Ising, maxIter = 80): number {
  const dim = 1 << model.n
  const m = Math.min(maxIter, dim)

  const basis: Float64Array[] = []
  let v = new Float64Array(dim)
  // A deterministic non-uniform start: a uniform vector is orthogonal to many
  // eigenvectors of this Hamiltonian and Lanczos would miss them entirely.
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i * 1.2345 + 0.7)
  normalise(v)

  const alpha: number[] = []
  const beta: number[] = []
  const w = new Float64Array(dim)
  let prevBeta = 0
  let prev: Float64Array | null = null

  for (let j = 0; j < m; j++) {
    basis.push(v)
    applyHamiltonian(v, w, model)
    let a = 0
    for (let i = 0; i < dim; i++) a += w[i] * v[i]
    alpha.push(a)
    for (let i = 0; i < dim; i++) w[i] -= a * v[i] + (prev ? prevBeta * prev[i] : 0)
    // Full reorthogonalisation against everything built so far.
    for (const b of basis) {
      let dot = 0
      for (let i = 0; i < dim; i++) dot += w[i] * b[i]
      for (let i = 0; i < dim; i++) w[i] -= dot * b[i]
    }
    let nrm = 0
    for (let i = 0; i < dim; i++) nrm += w[i] * w[i]
    nrm = Math.sqrt(nrm)
    if (nrm < 1e-10) break
    beta.push(nrm)
    prevBeta = nrm
    prev = v
    v = new Float64Array(dim)
    for (let i = 0; i < dim; i++) v[i] = w[i] / nrm
  }

  return smallestTridiagonalEigenvalue(alpha, beta)
}

function normalise(v: Float64Array): void {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  for (let i = 0; i < v.length; i++) v[i] /= n
}

/**
 * Smallest eigenvalue of a symmetric tridiagonal matrix, by bisection on the Sturm
 * sequence. `count(x)` is the number of eigenvalues below x; bisect until the bracket
 * is tighter than 1e-12.
 */
function smallestTridiagonalEigenvalue(alpha: number[], beta: number[]): number {
  const n = alpha.length
  if (n === 0) return 0

  // Gershgorin bounds.
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    const radius = (i > 0 ? Math.abs(beta[i - 1]) : 0) + (i < n - 1 ? Math.abs(beta[i]) : 0)
    lo = Math.min(lo, alpha[i] - radius)
    hi = Math.max(hi, alpha[i] + radius)
  }

  // Sturm count via the LDLᵀ recurrence: the number of negative pivots of (T − xI) is
  // the number of eigenvalues below x. The determinant-ratio form used here does not
  // overflow the way the raw leading-principal-minor recurrence does at m ≈ 80.
  const countBelow = (x: number): number => {
    let d = alpha[0] - x
    let count = d < 0 ? 1 : 0
    for (let i = 1; i < n; i++) {
      if (d === 0) d = Number.EPSILON
      d = alpha[i] - x - (beta[i - 1] * beta[i - 1]) / d
      if (d < 0) count++
    }
    return count
  }

  for (let iter = 0; iter < 200 && hi - lo > 1e-12 * (1 + Math.abs(lo)); iter++) {
    const mid = (lo + hi) / 2
    if (countBelow(mid) > 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// ─────────────────────────────────────────────────────────────────────────────
// Barren plateaus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Layers in the barren-plateau ansatz, as a function of qubit count.
 *
 * The plateau is a statement about ansatz *depth* as well as width: a shallow circuit
 * on many qubits is not a 2-design and does not flatten. Scaling depth with n is the
 * regime the original result is about, and is what makes the variance decay show up
 * over the handful of qubits a browser can simulate.
 */
export const barrenLayers = (n: number): number => 2 * n

/** Independent parameters per layer of the barren-plateau ansatz: RY on every qubit, then RX on every qubit. */
export const BARREN_PARAMS_PER_LAYER = (n: number): number => 2 * n

/**
 * One sample of ∂(E/n)/∂θ for a random parameter vector of an independent-parameter
 * hardware-efficient ansatz.
 *
 * The derivative is taken with respect to the RY angle on qubit 0 in the middle
 * layer, by the PARAMETER-SHIFT RULE — exact, two circuit evaluations, no step size.
 * That matters: the whole claim being demonstrated is that this number gets very
 * small, and a finite-difference estimate would eventually be measuring its own
 * truncation error instead.
 *
 * THE ANSATZ MUST INCLUDE THE RX SUBLAYER. It did not until it was measured: this
 * function built RY + CZ only, mirroring `ansatzState` with a third of it missing.
 * A circuit of RY and CZ starting from |0…0⟩ produces only REAL amplitudes, so the
 * ensemble it samples lives in SO(2ⁿ) and cannot approach a unitary 2-design at any
 * depth — the very hypothesis the barren-plateau result rests on. Measured, 2500
 * samples per width, Var[∂E/∂θ] (no per-site division), n = 2 → 10:
 *
 *   RY + CZ only          5.09e-1 → 1.19e-1   ×0.81 per qubit   ≈ n^-1.04, A POWER LAW
 *   RY + CZ + RX (now)    2.29e-1 → 9.36e-3   ×0.65 per qubit   exponential
 *
 * With the sublayer missing, essentially the whole visible collapse in the panel was
 * the 1/n² of the per-site division, not concentration: the intensive number fell 99×
 * from n = 2 to n = 10 while the physics contributed 4.3× of it. The panel showed a
 * plateau that was not there.
 *
 * PER SITE, and that division is not cosmetic — but it is no longer load-bearing.
 * H = −J Σ ZZ − h Σ X is extensive, so ∂E/∂θ carries a factor of n that has nothing
 * to do with the plateau; dividing by n gives the intensive quantity. With the ansatz
 * fixed both readings are exponential — raw ×0.65 per qubit, per-site ×0.44 — so the
 * normalisation moves the number without inventing the effect.
 */
export function barrenGradientSample(model: Ising, rand: () => number): number {
  const { n } = model
  const layers = barrenLayers(n)
  const perLayer = BARREN_PARAMS_PER_LAYER(n)
  const params: number[] = []
  for (let i = 0; i < layers * perLayer; i++) params.push(rand() * 2 * Math.PI)
  const target = Math.floor(layers / 2) * perLayer // RY on qubit 0 of the middle layer

  const evaluate = (shift: number): number => {
    const w = zeroState(n)
    for (let l = 0; l < layers; l++) {
      for (let q = 0; q < n; q++) {
        const idx = l * perLayer + q
        applyRY(w, q, params[idx] + (idx === target ? shift : 0))
      }
      if (n === 2) applyCZ(w, 0, 1)
      else for (let q = 0; q < n; q++) applyCZ(w, q, (q + 1) % n)
      for (let q = 0; q < n; q++) applyRX(w, q, params[l * perLayer + n + q])
    }
    return energyOf(w, model)
  }

  return (evaluate(Math.PI / 2) - evaluate(-Math.PI / 2)) / 2 / n
}

export type BarrenAccumulator = {
  n: number
  samples: number
  sum: number
  sumSquares: number
}

export function newBarrenAccumulator(n: number): BarrenAccumulator {
  return { n, samples: 0, sum: 0, sumSquares: 0 }
}

export function addBarrenSample(acc: BarrenAccumulator, g: number): void {
  acc.samples += 1
  acc.sum += g
  acc.sumSquares += g * g
}

/**
 * Var[∂(E/n)/∂θ] over the sampled parameter vectors.
 *
 * The MEAN is essentially zero by symmetry — it is the variance that collapses, and
 * quoting the mean instead would show nothing at all. Returns 0 for fewer than two
 * samples rather than NaN, so a partially-filled column draws as empty.
 */
export function barrenVariance(acc: BarrenAccumulator): number {
  if (acc.samples < 2) return 0
  const mean = acc.sum / acc.samples
  return Math.max(0, acc.sumSquares / acc.samples - mean * mean)
}

// ─────────────────────────────────────────────────────────────────────────────
// The landscape, computed incrementally
// ─────────────────────────────────────────────────────────────────────────────

export type LandscapeJob = {
  model: Ising
  layers: number
  /** Grid resolution per axis. */
  size: number
  /** Row-major energies, length size*size. NaN until that row is computed. */
  values: Float64Array
  /** Rows completed so far. */
  rowsDone: number
  min: number
  max: number
}

export function newLandscapeJob(model: Ising, layers: number, size: number): LandscapeJob {
  const values = new Float64Array(size * size).fill(NaN)
  return { model, layers, size, values, rowsDone: 0, min: Infinity, max: -Infinity }
}

/** θ and φ both sweep [0, 2π) — the ansatz is 2π-periodic in each. */
export function landscapeAngle(index: number, size: number): number {
  return (index / size) * 2 * Math.PI
}

/**
 * Compute up to `rows` more rows. Returns true while work remains.
 *
 * The landscape is built a few rows per animation frame rather than all at once
 * because at n = 8 with a 48 × 48 grid it is 2,304 statevector simulations; doing
 * them in one synchronous pass locks the tab for roughly a second, which is exactly
 * the sort of jank the rest of this site's labs avoid.
 */
export function stepLandscape(job: LandscapeJob, rows: number): boolean {
  const { size, model, layers } = job
  const end = Math.min(size, job.rowsDone + rows)
  for (let row = job.rowsDone; row < end; row++) {
    const phi = landscapeAngle(row, size)
    for (let col = 0; col < size; col++) {
      const theta = landscapeAngle(col, size)
      const e = energyAt(model, layers, theta, phi)
      job.values[row * size + col] = e
      if (e < job.min) job.min = e
      if (e > job.max) job.max = e
    }
  }
  job.rowsDone = end
  return job.rowsDone < size
}

/**
 * The same ansatz built on lib/quantum's StateVector. Used by the tests to prove the
 * fast kernels above agree with the product's own simulator; not used at runtime,
 * because it is roughly 30× slower.
 */
export function ansatzStateReference(
  model: Ising,
  layers: number,
  theta: number,
  phi: number
): StateVector {
  const sv = new StateVector(model.n)
  for (let l = 0; l < layers; l++) {
    for (let q = 0; q < model.n; q++) sv.applySingle('RY', q, theta)
    if (model.n === 2) sv.apply({ name: 'CZ', qubits: [0, 1] })
    else for (let q = 0; q < model.n; q++) sv.apply({ name: 'CZ', qubits: [q, (q + 1) % model.n] })
    for (let q = 0; q < model.n; q++) sv.applySingle('RX', q, phi)
  }
  return sv
}
