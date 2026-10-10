/**
 * lib/workbench/mitigation.ts — error mitigation on top of lib/quantum/noise.ts.
 *
 * Two techniques, both of which real hardware groups run today, both of which
 * are POST-PROCESSING: nothing here makes the device better, it makes the
 * number you report closer to the ideal one at the cost of more shots.
 *
 * ── (a) Readout mitigation ──────────────────────────────────────────────────────
 *
 * Measure two calibration circuits — the all-zeros state and the all-ones
 * state — and read off, per qubit, how often a 0 is reported as 1 and a 1 as 0.
 * With uncorrelated readout the confusion matrix of the whole register is the
 * tensor product of those 2×2 matrices, A = ⊗ A_q, and a measured distribution
 * p_meas = A · p_true. Invert: p_true = A⁻¹ · p_meas. The inverse is applied as a
 * chain of 2×2 inverses, one per qubit, so it costs n·2^n rather than 4^n and
 * never forms A. The result is a QUASI-probability: entries can go slightly
 * negative and the sum is still 1. That is expected; the expectation value of an
 * observable over it is unbiased. `clipToProbabilities` is the closest proper
 * distribution, for when a histogram needs drawing.
 *
 * Two calibration circuits identify only the tensor-product model. A full
 * 2^n×2^n calibration (one circuit per basis state) is also supported through
 * `invertConfusionMatrix`, which is what the test uses with a deliberately
 * correlated matrix.
 *
 * ── (b) Zero-noise extrapolation ────────────────────────────────────────────────
 *
 * You cannot turn the noise down, but you can turn it up. Replace every gate G
 * by G·G†·G (scale 3) or G·G†·G·G†·G (scale 5): the unitary is unchanged, the
 * gate count — and with it the error — is multiplied. Measure the observable at
 * scales 1, 3, 5, fit a curve, and evaluate the fit at scale 0. Three fits:
 *
 *   linear       least-squares line, evaluated at λ = 0
 *   quadratic    least-squares parabola (exact through three points)
 *   exponential  E(λ) = c + (E₁−c)·e^{−a(λ−1)}, fitted by a 1-D search on `a`,
 *                which is what depolarising noise actually produces
 *   learned      a 3→16→16→1 MLP trained IN THE BROWSER on synthetic curves of
 *                the exponential family with shot noise added, then handed the
 *                three measured values. It is a small, bounded, deterministic
 *                training loop (`LearnedExtrapolator`) — not a black box you
 *                have to trust: `learnedExtrapolator.test.ts` checks it beats
 *                the linear fit on held-out noisy exponentials.
 *
 * ── Error bars ──────────────────────────────────────────────────────────────────
 *
 * Every mitigated number carries a bootstrap standard error: the shot counts at
 * each scale are resampled (multinomial), the whole pipeline is re-run, and the
 * spread of the answers is the bar. This is honest about the one thing every
 * mitigation textbook warns about — the error bar GROWS. Extrapolating a line
 * from λ ∈ {1,3,5} back to 0 amplifies the shot noise on the intercept by ≈1.5×
 * (linear) and much more for the parabola; inverting a readout matrix amplifies
 * it by ≈ 1/(1 − p₀₁ − p₁₀) per qubit. Mitigation does not create information; it
 * trades bias for variance.
 *
 * ── Checked against ─────────────────────────────────────────────────────────────
 *
 *   · readout inversion on a hand-built confusion matrix recovers a known p
 *   · gate folding leaves the ideal unitary unchanged and multiplies gate count
 *   · linear/quadratic ZNE on a synthetic linear curve recovers the intercept
 *     exactly; the exponential fit recovers an exact exponential's intercept
 *   · MLP gradients match finite differences
 */

import {
  gaussian,
  mulberry32,
  simulate,
  type Circuit,
  type GateOp,
} from '@/lib/quantum'
import { adamStep, glorot, param, zeroGrads, type Param } from '@/lib/numerics/nn'
import {
  createNoisySampler,
  expectation,
  type NoiseModel,
  type NoisyRunResult,
  type Observable,
} from '@/lib/quantum/noise'

// ────────────────────────────────────────────────────────────
// (a) Readout mitigation
// ────────────────────────────────────────────────────────────

/** Per-qubit 2×2 confusion matrix, row = reported bit, column = true bit. */
export interface QubitConfusion {
  /** P(report 1 | true 0). */
  p1given0: number
  /** P(report 0 | true 1). */
  p0given1: number
}

export interface ReadoutCalibration {
  numQubits: number
  qubits: QubitConfusion[]
}

/** Any function that turns a circuit into a measured distribution over 2^n indices. */
export type Runner = (circuit: Circuit) => ArrayLike<number>

/**
 * Two calibration circuits: identity (|0…0⟩) and X on every qubit (|1…1⟩).
 * From the first, qubit q's P(1|0) is the marginal of bit q; from the second,
 * P(0|1) is one minus it.
 */
export function calibrateReadout(runner: Runner, numQubits: number): ReadoutCalibration {
  const zeros: Circuit = { numQubits, ops: [] }
  const ones: Circuit = {
    numQubits,
    ops: Array.from({ length: numQubits }, (_, q): GateOp => ({ name: 'X', qubits: [q] })),
  }
  const d0 = runner(zeros)
  const d1 = runner(ones)
  const qubits: QubitConfusion[] = []
  for (let q = 0; q < numQubits; q++) {
    qubits.push({
      p1given0: marginalOne(d0, q),
      p0given1: 1 - marginalOne(d1, q),
    })
  }
  return { numQubits, qubits }
}

function marginalOne(dist: ArrayLike<number>, q: number): number {
  let p = 0
  let total = 0
  for (let i = 0; i < dist.length; i++) {
    total += dist[i]
    if ((i >> q) & 1) p += dist[i]
  }
  return total > 0 ? p / total : 0
}

/**
 * Apply ⊗ A_q⁻¹ to a measured distribution. With e0 = P(1|0), e1 = P(0|1),
 *   A_q = [[1−e0, e1], [e0, 1−e1]]   (rows = reported bit, columns = true bit)
 *   A_q⁻¹ = 1/(1−e0−e1) · [[1−e1, −e1], [−e0, 1−e0]]
 * and each inverse is applied along its qubit's axis, like a gate.
 * Throws if a qubit's matrix is singular (p1given0 + p0given1 = 1: the readout
 * carries no information about that qubit and no inverse exists).
 */
export function mitigateReadout(dist: ArrayLike<number>, cal: ReadoutCalibration): Float64Array {
  const out = Float64Array.from(dist as ArrayLike<number>)
  const dim = 1 << cal.numQubits
  if (out.length !== dim) throw new Error(`distribution has ${out.length} entries, expected ${dim}`)
  for (let q = 0; q < cal.numQubits; q++) {
    const { p1given0: e0, p0given1: e1 } = cal.qubits[q]
    const det = 1 - e0 - e1
    if (Math.abs(det) < 1e-9) throw new Error(`qubit ${q} readout is uninformative (p1|0 + p0|1 = 1)`)
    // A = [[1−e0, e1], [e0, 1−e1]] with rows = reported, cols = true.
    // A⁻¹ = (1/det) [[1−e1, −e1], [−e0, 1−e0]].
    const i00 = (1 - e1) / det, i01 = -e1 / det
    const i10 = -e0 / det, i11 = (1 - e0) / det
    const bit = 1 << q
    for (let i = 0; i < dim; i++) {
      if (i & bit) continue
      const j = i | bit
      const a = out[i], b = out[j]
      out[i] = i00 * a + i01 * b
      out[j] = i10 * a + i11 * b
    }
  }
  return out
}

/**
 * Invert a full confusion matrix (rows = reported index, columns = true index)
 * by Gaussian elimination with partial pivoting. For correlated readout models
 * or tests; the tensor-product path above is what the page uses.
 */
export function invertConfusionMatrix(matrix: number[][], measured: ArrayLike<number>): number[] {
  const n = matrix.length
  if (n === 0 || measured.length !== n) throw new Error('matrix and distribution sizes differ')
  const a = matrix.map((row, i) => {
    if (row.length !== n) throw new Error('confusion matrix must be square')
    return [...row, measured[i]]
  })
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('confusion matrix is singular')
    if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r][col] / a[col][col]
      if (f === 0) continue
      for (let k = col; k <= n; k++) a[r][k] -= f * a[col][k]
    }
  }
  return a.map((row, i) => row[n] / row[i])
}

/** Nearest proper distribution: clip negatives, renormalise. Only for drawing. */
export function clipToProbabilities(quasi: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(quasi as ArrayLike<number>, (v) => Math.max(0, v))
  const s = out.reduce((a, b) => a + b, 0)
  if (s > 0) for (let i = 0; i < out.length; i++) out[i] /= s
  return out
}

// ────────────────────────────────────────────────────────────
// (b) Gate folding
// ────────────────────────────────────────────────────────────

const SELF_INVERSE = new Set<GateOp['name']>(['H', 'X', 'Y', 'Z', 'CX', 'CY', 'CZ', 'SWAP', 'CCX'])

/** G† for every gate the engine knows. */
export function inverseGate(op: GateOp): GateOp {
  if (SELF_INVERSE.has(op.name)) return { ...op }
  switch (op.name) {
    case 'S': return { ...op, name: 'SDG' }
    case 'SDG': return { ...op, name: 'S' }
    case 'T': return { ...op, name: 'TDG' }
    case 'TDG': return { ...op, name: 'T' }
    case 'RX': case 'RY': case 'RZ': case 'P':
      return { ...op, theta: -(op.theta ?? 0) }
    default:
      throw new Error(`${op.name} has no inverse for folding`)
  }
}

/**
 * Local gate folding at an odd integer scale λ = 2k + 1: each unitary gate G
 * becomes G (G† G)^k. MEASURE and BARRIER are left in place, once.
 */
export function foldCircuit(circuit: Circuit, scale: number): Circuit {
  if (!Number.isInteger(scale) || scale < 1 || scale % 2 === 0) {
    throw new Error(`fold scale must be an odd positive integer, got ${scale}`)
  }
  const k = (scale - 1) / 2
  const ops: GateOp[] = []
  for (const op of circuit.ops) {
    ops.push(op)
    if (op.name === 'MEASURE' || op.name === 'BARRIER') continue
    const inv = inverseGate(op)
    for (let i = 0; i < k; i++) ops.push(inv, { ...op })
  }
  return { ...circuit, ops }
}

export const ZNE_SCALES: readonly number[] = [1, 3, 5]

// ────────────────────────────────────────────────────────────
// Extrapolators
// ────────────────────────────────────────────────────────────

export type ExtrapolationMethod = 'linear' | 'quadratic' | 'exponential' | 'learned'

/** Least-squares polynomial of `degree` through (x, y); returns coefficients c0..cd. */
export function polynomialFit(xs: readonly number[], ys: readonly number[], degree: number): number[] {
  const m = degree + 1
  if (xs.length < m) throw new Error(`need at least ${m} points for degree ${degree}`)
  // Normal equations (XᵀX) c = Xᵀy — tiny systems, so plain elimination is fine.
  const ata: number[][] = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0))
  for (let p = 0; p < xs.length; p++) {
    const powers: number[] = []
    for (let i = 0; i < m; i++) powers.push(xs[p] ** i)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) ata[i][j] += powers[i] * powers[j]
      ata[i][m] += powers[i] * ys[p]
    }
  }
  for (let col = 0; col < m; col++) {
    let pivot = col
    for (let r = col + 1; r < m; r++) if (Math.abs(ata[r][col]) > Math.abs(ata[pivot][col])) pivot = r
    if (Math.abs(ata[pivot][col]) < 1e-12) throw new Error('degenerate fit')
    if (pivot !== col) [ata[pivot], ata[col]] = [ata[col], ata[pivot]]
    for (let r = 0; r < m; r++) {
      if (r === col) continue
      const f = ata[r][col] / ata[col][col]
      for (let k = col; k <= m; k++) ata[r][k] -= f * ata[col][k]
    }
  }
  return ata.map((row, i) => row[m] / row[i])
}

export function evalPolynomial(coeffs: readonly number[], x: number): number {
  let y = 0
  for (let i = coeffs.length - 1; i >= 0; i--) y = y * x + coeffs[i]
  return y
}

/**
 * E(λ) = c + (E(λ₀) − c)·e^{−a(λ−λ₀)} with the asymptote c and rate a ≥ 0
 * chosen by least squares: for each a on a fine grid the best c is linear, so
 * the search is one-dimensional. Returns the fitted function.
 */
export function exponentialFit(
  xs: readonly number[],
  ys: readonly number[]
): { evaluate: (x: number) => number; a: number; c: number } {
  const x0 = xs[0]
  const y0 = ys[0]
  let best = { a: 0, c: 0, sse: Infinity }
  for (let i = 0; i <= 400; i++) {
    const a = (i / 400) * 3
    // With a fixed, y = c·(1 − w) + y0·w where w = e^{−a(x−x0)}: linear in c.
    let num = 0, den = 0
    for (let p = 0; p < xs.length; p++) {
      const w = Math.exp(-a * (xs[p] - x0))
      num += (ys[p] - y0 * w) * (1 - w)
      den += (1 - w) * (1 - w)
    }
    const c = den > 1e-12 ? num / den : 0
    let sse = 0
    for (let p = 0; p < xs.length; p++) {
      const w = Math.exp(-a * (xs[p] - x0))
      const pred = c * (1 - w) + y0 * w
      sse += (pred - ys[p]) ** 2
    }
    if (sse < best.sse - 1e-15) best = { a, c, sse }
  }
  const { a, c } = best
  return { a, c, evaluate: (x) => c + (y0 - c) * Math.exp(-a * (x - x0)) }
}

/** Extrapolate a curve to λ = 0 with a closed-form method. */
export function extrapolateToZero(
  scales: readonly number[],
  values: readonly number[],
  method: Exclude<ExtrapolationMethod, 'learned'>
): { value: number; curve: (x: number) => number } {
  switch (method) {
    case 'linear': {
      const c = polynomialFit(scales, values, 1)
      return { value: c[0], curve: (x) => evalPolynomial(c, x) }
    }
    case 'quadratic': {
      const c = polynomialFit(scales, values, Math.min(2, scales.length - 1))
      return { value: c[0], curve: (x) => evalPolynomial(c, x) }
    }
    case 'exponential': {
      const f = exponentialFit(scales, values)
      return { value: f.evaluate(0), curve: f.evaluate }
    }
  }
}

// ────────────────────────────────────────────────────────────
// The learned extrapolator: a 3→H→H→1 MLP trained on synthetic curves
// ────────────────────────────────────────────────────────────

/**
 * MLP with tanh hidden units, Adam, mean-squared error, on the shared
 * parameter/optimiser pieces in lib/numerics/nn (the same Adam and Glorot the
 * surface-code decoders and the QML trainers use). The forward and backward
 * passes are written out by hand — no tensor library ships in this repo — and
 * are small enough that `gradient` is checked against finite differences in
 * the tests.
 */
export class Mlp {
  readonly sizes: number[]
  /** weights[l].value is out×in row-major, biases[l].value is out. */
  readonly weights: Param[]
  readonly biases: Param[]
  private step = 0

  constructor(sizes: number[], rng: () => number) {
    this.sizes = sizes
    this.weights = []
    this.biases = []
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1]
      const w = param(`W${l}`, fanIn * fanOut)
      glorot(w, fanIn, fanOut, rng)
      this.weights.push(w)
      this.biases.push(param(`b${l}`, fanOut))
    }
  }

  /** Forward pass keeping every activation, for backprop. */
  private forwardAll(x: ArrayLike<number>): Float64Array[] {
    const acts: Float64Array[] = [Float64Array.from(x as ArrayLike<number>)]
    for (let l = 0; l < this.weights.length; l++) {
      const inp = acts[l]
      const fanIn = this.sizes[l], fanOut = this.sizes[l + 1]
      const out = new Float64Array(fanOut)
      const w = this.weights[l].value, b = this.biases[l].value
      const last = l === this.weights.length - 1
      for (let o = 0; o < fanOut; o++) {
        let s = b[o]
        for (let i = 0; i < fanIn; i++) s += w[o * fanIn + i] * inp[i]
        out[o] = last ? s : Math.tanh(s)
      }
      acts.push(out)
    }
    return acts
  }

  predict(x: ArrayLike<number>): number {
    const acts = this.forwardAll(x)
    return acts[acts.length - 1][0]
  }

  /** Every parameter tensor, in the order [weights…, biases…]. */
  private params(): Param[] {
    return [...this.weights, ...this.biases]
  }

  /**
   * Mean-squared-error loss over a batch and its gradient w.r.t. every
   * parameter. Accumulated into each Param's `grad` (which Adam reads) and
   * returned as copies, in the same order as `parameters()`, so a caller's
   * snapshot survives the next call.
   */
  gradient(xs: ArrayLike<number>[], ys: ArrayLike<number>): { loss: number; grads: Float64Array[] } {
    const params = this.params()
    zeroGrads(params)
    const gW = this.weights.map((w) => w.grad)
    const gB = this.biases.map((b) => b.grad)
    let loss = 0
    const nB = xs.length
    for (let s = 0; s < nB; s++) {
      const acts = this.forwardAll(xs[s])
      const L = this.weights.length
      const pred = acts[L][0]
      const diff = pred - ys[s]
      loss += (diff * diff) / nB
      // dL/dpred
      let delta = new Float64Array([(2 * diff) / nB])
      for (let l = L - 1; l >= 0; l--) {
        const fanIn = this.sizes[l], fanOut = this.sizes[l + 1]
        const inp = acts[l]
        const w = this.weights[l].value
        const next = new Float64Array(fanIn)
        for (let o = 0; o < fanOut; o++) {
          const d = delta[o]
          gB[l][o] += d
          for (let i = 0; i < fanIn; i++) {
            gW[l][o * fanIn + i] += d * inp[i]
            next[i] += d * w[o * fanIn + i]
          }
        }
        if (l > 0) {
          // tanh' = 1 − tanh²; acts[l] already holds tanh.
          for (let i = 0; i < fanIn; i++) next[i] *= 1 - inp[i] * inp[i]
        }
        delta = next
      }
    }
    return { loss, grads: params.map((p) => Float64Array.from(p.grad)) }
  }

  /** The parameter values, in the order [weights…, biases…]; edits are live. */
  parameters(): Float64Array[] {
    return this.params().map((p) => p.value)
  }

  /** One Adam step. Returns the batch loss before the step. */
  adamStep(xs: ArrayLike<number>[], ys: ArrayLike<number>, lr = 3e-3, beta1 = 0.9, beta2 = 0.999): number {
    const { loss } = this.gradient(xs, ys)
    this.step += 1
    adamStep(this.params(), this.step, { lr, beta1, beta2 })
    return loss
  }
}

/**
 * Synthetic training curve: E(λ) = c + (E₀ − c)·e^{−aλ} sampled at the ZNE
 * scales with Gaussian shot noise of width σ. The intercept E₀ is the target.
 * Ranges: E₀ ∈ [−1, 1] (any Pauli expectation), c ∈ [−0.15, 0.15] (depolarising
 * drives Paulis to 0; a small offset covers projectors and biased readout),
 * a ∈ [0, 0.6] (from noiseless to "gone by scale 5"), σ ∈ [0, 0.06] (a few
 * hundred to a few thousand shots).
 */
export function syntheticCurve(
  rng: () => number,
  scales: readonly number[] = ZNE_SCALES
): { inputs: number[]; target: number } {
  const e0 = 2 * rng() - 1
  const c = (2 * rng() - 1) * 0.15
  const a = rng() * 0.6
  const sigma = rng() * 0.06
  const inputs = scales.map((s) => c + (e0 - c) * Math.exp(-a * s) + sigma * gaussian(rng))
  return { inputs, target: e0 }
}

export interface TrainingStatus {
  step: number
  budget: number
  loss: number
  done: boolean
}

/**
 * The learned extrapolator with a step budget. `trainSteps(k)` runs at most k
 * Adam steps and returns — the page calls it inside requestAnimationFrame
 * slices so the tab never freezes, and a test calls it once with the whole
 * budget. Deterministic for a seed.
 */
export class LearnedExtrapolator {
  readonly net: Mlp
  readonly budget: number
  readonly batchSize: number
  private readonly rng: () => number
  private stepCount = 0
  private lastLoss = NaN

  constructor(opts: { seed?: number; budget?: number; hidden?: number; batchSize?: number } = {}) {
    this.rng = mulberry32(opts.seed ?? 7)
    this.budget = opts.budget ?? 600
    this.batchSize = opts.batchSize ?? 64
    this.net = new Mlp([ZNE_SCALES.length, opts.hidden ?? 16, opts.hidden ?? 16, 1], this.rng)
  }

  status(): TrainingStatus {
    return { step: this.stepCount, budget: this.budget, loss: this.lastLoss, done: this.stepCount >= this.budget }
  }

  /** Run up to `k` steps, stopping at the budget. Returns the status after. */
  trainSteps(k: number): TrainingStatus {
    for (let i = 0; i < k && this.stepCount < this.budget; i++) {
      const xs: number[][] = []
      const ys: number[] = []
      for (let b = 0; b < this.batchSize; b++) {
        const s = syntheticCurve(this.rng)
        xs.push(s.inputs)
        ys.push(s.target)
      }
      this.lastLoss = this.net.adamStep(xs, ys)
      this.stepCount += 1
    }
    return this.status()
  }

  /** The extrapolated zero-noise value for measured values at ZNE_SCALES. */
  predict(values: readonly number[]): number {
    if (values.length !== ZNE_SCALES.length) throw new Error(`expected ${ZNE_SCALES.length} values`)
    return this.net.predict(values)
  }
}

// ────────────────────────────────────────────────────────────
// The full pipeline with bootstrap error bars
// ────────────────────────────────────────────────────────────

export interface ZnePoint {
  scale: number
  /** Raw noisy expectation at this scale. */
  value: number
  /** Readout-mitigated expectation at this scale (what the fit uses). */
  readoutMitigated: number
  /** Bootstrap standard error of `readoutMitigated`. */
  stderr: number
  fidelity: number
  gateCount: number
}

export interface MitigationReport {
  ideal: number
  /** Raw noisy expectation at scale 1. */
  noisy: number
  noisyStderr: number
  readoutMitigated: number
  readoutStderr: number
  zne: number
  zneStderr: number
  method: ExtrapolationMethod
  points: ZnePoint[]
  /** The fitted curve, for drawing. Undefined for the learned method. */
  curve?: (x: number) => number
  calibration: ReadoutCalibration
  /** The measurements behind the numbers, for `postProcess` to refit. */
  raw: RawMeasurements
}

export interface PipelineOptions {
  shots: number
  seed?: number
  method: ExtrapolationMethod
  learned?: LearnedExtrapolator | null
  bootstrap?: number
  scales?: readonly number[]
}

/** Multinomial resample of a count vector, same total. */
export function resampleCounts(counts: ArrayLike<number>, rng: () => number): Float64Array {
  const total = Array.from(counts as ArrayLike<number>).reduce((a, b) => a + b, 0)
  const out = new Float64Array(counts.length)
  const cdf: number[] = []
  let acc = 0
  for (let i = 0; i < counts.length; i++) { acc += counts[i] / total; cdf.push(acc) }
  for (let s = 0; s < total; s++) {
    const u = rng()
    let lo = 0, hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < u) lo = mid + 1
      else hi = mid
    }
    out[lo] += 1
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
}

function fitZero(
  scales: readonly number[],
  values: readonly number[],
  method: ExtrapolationMethod,
  learned: LearnedExtrapolator | null | undefined
): { value: number; curve?: (x: number) => number } {
  if (method === 'learned') {
    if (!learned) throw new Error('the learned method needs a trained LearnedExtrapolator')
    return { value: learned.predict(values) }
  }
  return extrapolateToZero(scales, values, method)
}

export interface JobProgress {
  /** What is running: readout calibration, or the folded circuit at a scale. */
  phase: string
  /** Trajectories finished so far, over the whole job. */
  done: number
  total: number
}

/**
 * Everything the page shows for one circuit + observable + noise model:
 * calibrate readout on the same device, run the folded circuits, mitigate,
 * extrapolate, bootstrap the error bars. Pure and deterministic for a seed.
 *
 * A generator: each `next()` runs one chunk of trajectories and yields the
 * progress, so the page can run it inside requestAnimationFrame slices and
 * cancel it by dropping the iterator. `mitigationPipeline` drains it.
 */
export function* mitigationJob(
  circuit: Circuit,
  obs: Observable,
  model: NoiseModel,
  opts: PipelineOptions,
  chunk = 128
): Generator<JobProgress, MitigationReport, void> {
  const scales = opts.scales ?? ZNE_SCALES
  const seed = opts.seed ?? 1
  const shots = opts.shots
  const nBoot = opts.bootstrap ?? 40
  const n = circuit.numQubits

  const calibrationCircuits: { label: string; circuit: Circuit }[] = [
    { label: 'calibrating |0…0⟩', circuit: { numQubits: n, ops: [] } },
    {
      label: 'calibrating |1…1⟩',
      circuit: { numQubits: n, ops: Array.from({ length: n }, (_, q): GateOp => ({ name: 'X', qubits: [q] })) },
    },
  ]
  const folded = scales.map((s) => ({ label: `running at scale ${s}`, circuit: foldCircuit(circuit, s) }))
  const jobs = [...calibrationCircuits, ...folded]
  const total = jobs.length * shots
  let done = 0
  const results: NoisyRunResult[] = []
  for (let j = 0; j < jobs.length; j++) {
    const sampler = createNoisySampler(jobs[j].circuit, model, shots, seed + 7 * (j + 1))
    while (!sampler.step(chunk)) {
      yield { phase: jobs[j].label, done: done + sampler.done, total }
    }
    done += shots
    results.push(sampler.result())
  }
  const [cal0, cal1, ...runs] = results
  return postProcess(
    { circuit, obs, scales, seed, bootstrap: nBoot, calibrationRuns: [cal0, cal1], runs },
    opts.method,
    opts.learned
  )
}

/** The raw measurements a report was built from, kept so it can be refitted. */
export interface RawMeasurements {
  circuit: Circuit
  obs: Observable
  scales: readonly number[]
  seed: number
  bootstrap: number
  calibrationRuns: [NoisyRunResult, NoisyRunResult]
  runs: NoisyRunResult[]
}

/**
 * Everything after the trajectories: calibrate, mitigate, fit, bootstrap.
 * Pure, and cheap enough that switching the extrapolation method on the page
 * is a refit rather than a re-run — the measured points do not change.
 */
export function postProcess(
  raw: RawMeasurements,
  method: ExtrapolationMethod,
  learned?: LearnedExtrapolator | null
): MitigationReport {
  const { circuit, obs, scales, seed, bootstrap: nBoot, runs } = raw
  const [cal0, cal1] = raw.calibrationRuns
  const n = circuit.numQubits
  const calibrationFrom = (d0: ArrayLike<number>, d1: ArrayLike<number>): ReadoutCalibration => ({
    numQubits: n,
    qubits: Array.from({ length: n }, (_, q) => ({
      p1given0: marginalOne(d0, q),
      p0given1: 1 - marginalOne(d1, q),
    })),
  })
  const calibration = calibrationFrom(cal0.distribution, cal1.distribution)

  const rawValues = runs.map((r) => expectation(r.distribution, obs))
  const mitigated = runs.map((r) => expectation(mitigateReadout(r.distribution, calibration), obs))
  const fit = fitZero(scales, mitigated, method, learned)

  // Bootstrap: resample every scale's counts, re-run the post-processing.
  const boot = mulberry32(seed + 999)
  const rawB: number[][] = scales.map(() => [])
  const mitB: number[][] = scales.map(() => [])
  const zneB: number[] = []
  for (let b = 0; b < nBoot; b++) {
    // The calibration is a measurement too: its shot noise belongs in the bar.
    const calB = calibrationFrom(resampleCounts(cal0.counts, boot), resampleCounts(cal1.counts, boot))
    const vals: number[] = []
    for (let i = 0; i < scales.length; i++) {
      const d = resampleCounts(runs[i].counts, boot)
      rawB[i].push(expectation(d, obs))
      const m = expectation(mitigateReadout(d, calB), obs)
      mitB[i].push(m)
      vals.push(m)
    }
    try {
      zneB.push(fitZero(scales, vals, method, learned).value)
    } catch {
      // A degenerate resample (all shots in one bin) can break a fit; skip it.
    }
  }

  const ideal = expectation(simulate({ ...circuit, ops: circuit.ops.filter((o) => o.name !== 'MEASURE') }).probabilities(), obs)
  const points: ZnePoint[] = scales.map((scale, i) => ({
    scale,
    value: rawValues[i],
    readoutMitigated: mitigated[i],
    stderr: stddev(mitB[i]),
    fidelity: runs[i].fidelity,
    gateCount: foldCircuit(circuit, scale).ops.filter((o) => o.name !== 'BARRIER' && o.name !== 'MEASURE').length,
  }))

  return {
    ideal,
    noisy: rawValues[0],
    noisyStderr: stddev(rawB[0]),
    readoutMitigated: mitigated[0],
    readoutStderr: stddev(mitB[0]),
    zne: fit.value,
    zneStderr: stddev(zneB),
    method,
    points,
    curve: fit.curve,
    calibration,
    raw,
  }
}

/** `mitigationJob`, run to completion. */
export function mitigationPipeline(
  circuit: Circuit,
  obs: Observable,
  model: NoiseModel,
  opts: PipelineOptions
): MitigationReport {
  const job = mitigationJob(circuit, obs, model, opts, opts.shots)
  for (;;) {
    const r = job.next()
    if (r.done) return r.value
  }
}
