/**
 * lib/quantum/noise.ts — Monte-Carlo trajectory noise for the statevector engine.
 *
 * ── What this module is ─────────────────────────────────────────────────────────
 *
 * A wrapper. `lib/quantum.ts` simulates a circuit as one pure statevector; a noisy
 * device produces a MIXED state, which a statevector cannot hold. Rather than
 * rewrite the engine around density matrices, this module runs the same engine
 * many times — one *trajectory* per shot — and inserts random events between the
 * gates. Averaged over trajectories the events reproduce the noise channel
 * exactly (each channel below is written as its own quantum-jump unravelling),
 * and every trajectory is a legal pure state the existing `StateVector` methods
 * can act on. Nothing in `lib/quantum.ts` is modified.
 *
 * ── The noise model ─────────────────────────────────────────────────────────────
 *
 *   depolarising1   After every single-qubit gate, with probability p apply one of
 *                   X, Y, Z chosen uniformly. Averaged, that is the depolarising
 *                   channel ρ → (1−p)ρ + (p/3)(XρX + YρY + ZρZ).
 *   depolarising2   After every multi-qubit gate on k qubits, with probability p
 *                   apply one of the 4^k − 1 non-identity Pauli strings on those
 *                   qubits, uniformly.
 *   t1, t2          Relaxation and dephasing times in units of the idle step. A
 *                   qubit that has no gate in a layer IDLES for one step and gets
 *                   amplitude damping with γ = 1 − e^{−1/T1} and pure dephasing
 *                   with phase-flip probability λ = (1 − e^{−1/Tφ})/2, where
 *                   1/Tφ = 1/T2 − 1/(2·T1). Qubits inside a gate do not decohere
 *                   separately: on real devices the reported gate error already
 *                   includes what happens during the gate, and that is what the
 *                   depolarising rate stands for here. `Infinity` switches a
 *                   channel off. T2 is clamped to 2·T1, the physical ceiling.
 *   readout         After the final measurement each classical bit is flipped:
 *                   a true 0 reads 1 with probability p1given0, a true 1 reads 0
 *                   with probability p0given1.
 *
 * Layers are ASAP-scheduled: an op lands in the first layer after the last layer
 * touching any of its qubits. A BARRIER with no qubits is an explicit idle step
 * for every qubit — it is how a "wait t steps" experiment is written, and how
 * the T1 test below measures e^{−t/T1}. A BARRIER that names qubits idles only
 * those. MEASURE ops are ignored during the trajectory; every qubit is read out
 * at the end.
 *
 * ── Why quantum jumps and not Kraus-averaged density matrices ───────────────────
 *
 * Two reasons. The workbench page runs at 1–5 qubits, where either would do; but
 * the existing engine, its gate table, its QASM importer and its 16-qubit limit
 * are all statevector code, and trajectories reuse every line of it. And the
 * shot-to-shot scatter a trajectory method produces IS the scatter a real device
 * produces — which is the thing error mitigation has to survive, and the thing
 * this page exists to show.
 *
 * ── Checked against ─────────────────────────────────────────────────────────────
 *
 *   · zero noise → bit-identical statevector and distribution to `simulate()`
 *   · X then depolarising p on one qubit → P(1) = 1 − 2p/3 (two of the three
 *     Paulis flip the bit)
 *   · |1⟩ idled t steps → P(1) = e^{−t/T1}, both as the exact per-step jump
 *     probability and as a trajectory average
 *   · |+⟩ idled t steps with T1 = ∞ → ⟨X⟩ = e^{−t/T2}
 *   · readout confusion applied to a known distribution
 */

import {
  StateVector,
  mulberry32,
  simulate,
  type Circuit,
  type Complex,
  type GateName,
  type GateOp,
} from '../quantum'

// ────────────────────────────────────────────────────────────
// Model
// ────────────────────────────────────────────────────────────

export interface ReadoutError {
  /** Probability a true 0 is reported as 1. */
  p1given0: number
  /** Probability a true 1 is reported as 0. */
  p0given1: number
}

export interface NoiseModel {
  /** Depolarising probability after each single-qubit gate, in [0, 1]. */
  depolarising1: number
  /** Depolarising probability after each multi-qubit gate, in [0, 1]. */
  depolarising2: number
  /** Relaxation time in idle steps. Infinity disables amplitude damping. */
  t1: number
  /** Dephasing time in idle steps. Infinity disables dephasing. Clamped to 2·t1. */
  t2: number
  readout: ReadoutError
}

export const NOISELESS: NoiseModel = Object.freeze({
  depolarising1: 0,
  depolarising2: 0,
  t1: Infinity,
  t2: Infinity,
  readout: { p1given0: 0, p0given1: 0 },
})

function assertProbability(name: string, p: number): void {
  if (!(p >= 0 && p <= 1)) throw new Error(`${name} must be in [0, 1], got ${p}`)
}

function assertTime(name: string, t: number): void {
  if (Number.isNaN(t) || t <= 0) throw new Error(`${name} must be positive (or Infinity), got ${t}`)
}

/** Throws on an unphysical model; returns it with T2 clamped to 2·T1. */
export function validateNoiseModel(model: NoiseModel): NoiseModel {
  assertProbability('depolarising1', model.depolarising1)
  assertProbability('depolarising2', model.depolarising2)
  assertTime('t1', model.t1)
  assertTime('t2', model.t2)
  assertProbability('readout.p1given0', model.readout.p1given0)
  assertProbability('readout.p0given1', model.readout.p0given1)
  const t2 = Math.min(model.t2, 2 * model.t1)
  return t2 === model.t2 ? model : { ...model, t2 }
}

export function isNoiseless(model: NoiseModel): boolean {
  return (
    model.depolarising1 === 0 &&
    model.depolarising2 === 0 &&
    model.t1 === Infinity &&
    model.t2 === Infinity &&
    model.readout.p1given0 === 0 &&
    model.readout.p0given1 === 0
  )
}

// ────────────────────────────────────────────────────────────
// Single-qubit Kraus operators on a statevector
// ────────────────────────────────────────────────────────────

/** 2×2 complex matrix, row-major [a, b, c, d]. Need not be unitary. */
export type Matrix2 = [Complex, Complex, Complex, Complex]

const ZERO: Complex = { re: 0, im: 0 }
const ONE: Complex = { re: 1, im: 0 }

/** Amplitude damping with decay probability γ: |1⟩ → |0⟩ with probability γ. */
export function amplitudeDampingKraus(gamma: number): Matrix2[] {
  assertProbability('gamma', gamma)
  return [
    [ONE, ZERO, ZERO, { re: Math.sqrt(1 - gamma), im: 0 }],
    [ZERO, { re: Math.sqrt(gamma), im: 0 }, ZERO, ZERO],
  ]
}

/** Phase flip with probability λ: ρ → (1−λ)ρ + λ ZρZ. */
export function dephasingKraus(lambda: number): Matrix2[] {
  assertProbability('lambda', lambda)
  const a = Math.sqrt(1 - lambda)
  const b = Math.sqrt(lambda)
  return [
    [{ re: a, im: 0 }, ZERO, ZERO, { re: a, im: 0 }],
    [{ re: b, im: 0 }, ZERO, ZERO, { re: -b, im: 0 }],
  ]
}

/**
 * Apply a (possibly non-unitary) 2×2 matrix to qubit q of `sv` WITHOUT
 * renormalising, writing into `out`. Returns the squared norm of the result,
 * which for a Kraus operator is the probability of that branch.
 */
function applyMatrix2Into(sv: StateVector, q: number, m: Matrix2, out: Float64Array): number {
  const [m00, m01, m10, m11] = m
  const bit = 1 << q
  const d = sv.data
  let norm2 = 0
  for (let i = 0; i < sv.dim; i++) {
    if (i & bit) continue
    const j = i | bit
    const aRe = d[2 * i], aIm = d[2 * i + 1]
    const bRe = d[2 * j], bIm = d[2 * j + 1]
    const naRe = m00.re * aRe - m00.im * aIm + m01.re * bRe - m01.im * bIm
    const naIm = m00.re * aIm + m00.im * aRe + m01.re * bIm + m01.im * bRe
    const nbRe = m10.re * aRe - m10.im * aIm + m11.re * bRe - m11.im * bIm
    const nbIm = m10.re * aIm + m10.im * aRe + m11.re * bIm + m11.im * bRe
    out[2 * i] = naRe; out[2 * i + 1] = naIm
    out[2 * j] = nbRe; out[2 * j + 1] = nbIm
    norm2 += naRe * naRe + naIm * naIm + nbRe * nbRe + nbIm * nbIm
  }
  return norm2
}

/**
 * The probability of each Kraus branch on the current state: ⟨ψ|K†K|ψ⟩.
 * For a complete set these sum to 1. Exposed so a test can check the per-step
 * jump probability against 1 − e^{−1/T1} without any sampling.
 */
export function krausBranchProbabilities(sv: StateVector, q: number, kraus: Matrix2[]): number[] {
  const scratch = new Float64Array(sv.data.length)
  return kraus.map((k) => applyMatrix2Into(sv, q, k, scratch))
}

/**
 * One quantum jump: pick a Kraus branch with its Born probability, apply it and
 * renormalise. Mutates `sv`. Returns the index of the branch taken.
 */
export function applyKrausTrajectory(
  sv: StateVector,
  q: number,
  kraus: Matrix2[],
  rng: () => number
): number {
  const scratch = new Float64Array(sv.data.length)
  const probs = kraus.map((k) => applyMatrix2Into(sv, q, k, scratch))
  const total = probs.reduce((s, p) => s + p, 0)
  const u = rng() * total
  let acc = 0
  let chosen = probs.length - 1
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]
    if (u < acc) { chosen = i; break }
  }
  const p = applyMatrix2Into(sv, q, kraus[chosen], scratch)
  const inv = 1 / Math.sqrt(p)
  for (let i = 0; i < scratch.length; i++) sv.data[i] = scratch[i] * inv
  return chosen
}

/**
 * Amplitude damping as an in-place quantum jump, no scratch buffer. The jump
 * probability is γ·P(q = 1); the jump moves every |…1_q…⟩ amplitude onto
 * |…0_q…⟩ (that is K₁ up to normalisation); no jump scales the |1⟩ amplitudes
 * by √(1−γ) and renormalises (K₀). Same channel as the Kraus path — the tests
 * check both — but this is the one the trajectory loop calls, because an idle
 * step on every qubit of every layer is the hot path.
 */
export function applyAmplitudeDampingJump(sv: StateVector, q: number, gamma: number, rng: () => number): boolean {
  const bit = 1 << q
  const d = sv.data
  let p1 = 0
  for (let i = 0; i < sv.dim; i++) {
    if (!(i & bit)) continue
    p1 += d[2 * i] * d[2 * i] + d[2 * i + 1] * d[2 * i + 1]
  }
  const pJump = gamma * p1
  if (pJump > 0 && rng() < pJump) {
    const inv = 1 / Math.sqrt(p1)
    for (let i = 0; i < sv.dim; i++) {
      if (!(i & bit)) continue
      const j = i ^ bit
      d[2 * j] = d[2 * i] * inv
      d[2 * j + 1] = d[2 * i + 1] * inv
      d[2 * i] = 0
      d[2 * i + 1] = 0
    }
    return true
  }
  // K₀: |1⟩ amplitudes shrink by √(1−γ); renormalise by √(1 − γ·p1).
  const shrink = Math.sqrt(1 - gamma)
  const inv = 1 / Math.sqrt(1 - pJump)
  for (let i = 0; i < sv.dim; i++) {
    const f = i & bit ? shrink * inv : inv
    d[2 * i] *= f
    d[2 * i + 1] *= f
  }
  return false
}

/** Phase flip with probability λ, in place: the jump is a Z on qubit q. */
export function applyDephasingJump(sv: StateVector, q: number, lambda: number, rng: () => number): boolean {
  if (!(lambda > 0) || rng() >= lambda) return false
  const bit = 1 << q
  const d = sv.data
  for (let i = 0; i < sv.dim; i++) {
    if (!(i & bit)) continue
    d[2 * i] = -d[2 * i]
    d[2 * i + 1] = -d[2 * i + 1]
  }
  return true
}

// ────────────────────────────────────────────────────────────
// Pauli errors
// ────────────────────────────────────────────────────────────

const PAULIS: readonly GateName[] = ['X', 'Y', 'Z']

/**
 * With probability p apply a uniformly random NON-identity Pauli string on
 * `qubits` (4^k − 1 choices). Returns the string applied, as a label like
 * 'XI' (qubit order as given), or null when nothing happened.
 */
export function applyDepolarising(
  sv: StateVector,
  qubits: readonly number[],
  p: number,
  rng: () => number
): string | null {
  if (p <= 0 || rng() >= p) return null
  const k = qubits.length
  const choices = 4 ** k - 1
  // 1..choices; digit d in base 4 for each qubit, 0 = I, 1 = X, 2 = Y, 3 = Z.
  const pick = 1 + Math.floor(rng() * choices)
  let code = pick
  let label = ''
  for (let i = 0; i < k; i++) {
    const digit = code % 4
    code = Math.floor(code / 4)
    if (digit === 0) {
      label += 'I'
    } else {
      sv.applySingle(PAULIS[digit - 1], qubits[i])
      label += PAULIS[digit - 1]
    }
  }
  return label
}

// ────────────────────────────────────────────────────────────
// Scheduling
// ────────────────────────────────────────────────────────────

export interface Layer {
  ops: GateOp[]
  /** Qubits that idle during this layer (no gate touches them). */
  idle: number[]
}

/**
 * ASAP layering. Each op goes in the first layer after the last one that used
 * any of its qubits. MEASURE ops are dropped (readout happens at the end).
 * A BARRIER with no qubits is a full idle layer; with qubits it idles those.
 */
export function scheduleLayers(circuit: Circuit): Layer[] {
  const n = circuit.numQubits
  const last = new Array<number>(n).fill(-1)
  const layers: GateOp[][] = []
  for (const op of circuit.ops) {
    if (op.name === 'MEASURE') continue
    const touched = op.name === 'BARRIER' && op.qubits.length === 0
      ? Array.from({ length: n }, (_, i) => i)
      : op.qubits
    let at = 0
    for (const q of touched) at = Math.max(at, last[q] + 1)
    while (layers.length <= at) layers.push([])
    layers[at].push(op)
    for (const q of touched) last[q] = at
  }
  return layers.map((ops) => {
    const busy = new Set<number>()
    for (const op of ops) {
      if (op.name === 'BARRIER') continue
      for (const q of op.qubits) busy.add(q)
    }
    const idle: number[] = []
    for (let q = 0; q < n; q++) if (!busy.has(q)) idle.push(q)
    return { ops, idle }
  })
}

/**
 * The same schedule, as a layer index per op (−1 for MEASURE). This is what
 * the trajectory uses: it walks the ops in CIRCUIT order — so that with zero
 * noise the arithmetic is bit-identical to `simulate()` — and applies each
 * qubit's accumulated idle steps lazily, just before its next gate. Idle
 * channels on qubit q commute with gates on other qubits, so the averaged
 * channel is the same as applying them layer by layer.
 */
export interface Schedule {
  layerOf: number[]
  depth: number
}

export function scheduleOps(circuit: Circuit): Schedule {
  const n = circuit.numQubits
  const last = new Array<number>(n).fill(-1)
  const layerOf: number[] = []
  let depth = 0
  for (const op of circuit.ops) {
    if (op.name === 'MEASURE') { layerOf.push(-1); continue }
    const touched = op.name === 'BARRIER' && op.qubits.length === 0
      ? Array.from({ length: n }, (_, i) => i)
      : op.qubits
    let at = 0
    for (const q of touched) at = Math.max(at, last[q] + 1)
    layerOf.push(at)
    for (const q of touched) last[q] = at
    depth = Math.max(depth, at + 1)
  }
  return { layerOf, depth }
}

/** Depth of the circuit in layers, the x-axis of "fidelity vs depth". */
export function circuitDepth(circuit: Circuit): number {
  return scheduleOps(circuit).depth
}

/** `steps` explicit idle steps appended to a circuit (BARRIER with no qubits). */
export function withIdleSteps(circuit: Circuit, steps: number): Circuit {
  const ops = circuit.ops.slice()
  for (let i = 0; i < steps; i++) ops.push({ name: 'BARRIER', qubits: [] })
  return { ...circuit, ops }
}

// ────────────────────────────────────────────────────────────
// One trajectory
// ────────────────────────────────────────────────────────────

/**
 * Per-idle-step rates for a model: γ = 1 − e^{−1/T1} and the pure-dephasing
 * phase-flip probability λ = (1 − e^{−1/Tφ})/2 with 1/Tφ = 1/T2 − 1/(2·T1) —
 * what T2 says beyond the dephasing T1 already implies. Zero when off.
 */
export function idleRates(model: NoiseModel): { gamma: number; lambda: number } {
  const gamma = model.t1 === Infinity ? 0 : 1 - Math.exp(-1 / model.t1)
  const invTphi = (model.t2 === Infinity ? 0 : 1 / model.t2) - (model.t1 === Infinity ? 0 : 1 / (2 * model.t1))
  const lambda = invTphi <= 0 ? 0 : (1 - Math.exp(-invTphi)) / 2
  return { gamma, lambda }
}

export interface Trajectory {
  state: StateVector
  /** Number of Pauli errors and idle jumps that actually fired. */
  events: number
}

/**
 * Run one noisy trajectory of `circuit`. Classical control is not supported
 * here (the workbench circuits have none); a conditioned op throws.
 */
export function runTrajectory(
  circuit: Circuit,
  model: NoiseModel,
  rng: () => number,
  schedule: Schedule = scheduleOps(circuit)
): Trajectory {
  const m = validateNoiseModel(model)
  const { gamma, lambda } = idleRates(m)
  const n = circuit.numQubits
  const sv = new StateVector(n)
  let events = 0
  // Layer index of the last gate on each qubit; idle steps accrue after it.
  const last = new Array<number>(n).fill(-1)

  const idle = (q: number, steps: number): void => {
    if (!(gamma > 0 || lambda > 0) || steps <= 0) return
    for (let s = 0; s < steps; s++) {
      if (gamma > 0 && applyAmplitudeDampingJump(sv, q, gamma, rng)) events += 1
      if (lambda > 0 && applyDephasingJump(sv, q, lambda, rng)) events += 1
    }
  }

  circuit.ops.forEach((op, i) => {
    const layer = schedule.layerOf[i]
    if (layer < 0) return // MEASURE: read out at the end
    if (op.name === 'BARRIER') {
      // Occupies the layer; the idle it represents is charged when the
      // qubit's next gate (or the end of the circuit) comes around.
      return
    }
    for (const q of op.qubits) {
      idle(q, layer - last[q] - 1)
      last[q] = layer
    }
    sv.apply(op)
    const p = op.qubits.length === 1 ? m.depolarising1 : m.depolarising2
    if (applyDepolarising(sv, op.qubits, p, rng) !== null) events += 1
  })
  for (let q = 0; q < n; q++) idle(q, schedule.depth - last[q] - 1)
  return { state: sv.normalize(), events }
}

// ────────────────────────────────────────────────────────────
// Readout
// ────────────────────────────────────────────────────────────

/** Flip each bit of basis index `idx` with the model's readout probabilities. */
export function applyReadoutError(
  idx: number,
  numQubits: number,
  readout: ReadoutError,
  rng: () => number
): number {
  if (readout.p1given0 === 0 && readout.p0given1 === 0) return idx
  let out = idx
  for (let q = 0; q < numQubits; q++) {
    const bit = (idx >> q) & 1
    const pFlip = bit === 1 ? readout.p0given1 : readout.p1given0
    if (pFlip > 0 && rng() < pFlip) out ^= 1 << q
  }
  return out
}

/** Sample one basis index from a probability vector (inverse-transform). */
function sampleIndex(probs: Float64Array | number[], rng: () => number): number {
  const u = rng()
  let acc = 0
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]
    if (u < acc) return i
  }
  return probs.length - 1
}

// ────────────────────────────────────────────────────────────
// N trajectories, aggregated
// ────────────────────────────────────────────────────────────

export interface NoisyRunResult {
  numQubits: number
  shots: number
  /** Readout-corrupted counts by basis index (length 2^n). */
  counts: Uint32Array
  /** counts / shots. */
  distribution: Float64Array
  /**
   * Average over trajectories of |⟨ψ_ideal|ψ_traj⟩|² — exactly the fidelity
   * ⟨ψ_ideal|ρ|ψ_ideal⟩ of the noisy mixed state with the ideal pure state.
   * Readout error is not included (it is not a property of the state).
   */
  fidelity: number
  /** Mean number of noise events per trajectory. */
  meanEvents: number
  depth: number
}

/**
 * A resumable run of `shots` trajectories. `step(k)` runs up to k more shots
 * and returns true when all are done; `result()` aggregates whatever has run
 * so far. The workbench page drives this from requestAnimationFrame slices so
 * a 4096-shot, 300-gate folded circuit never freezes the tab; `runNoisy`
 * drains it in one go for tests and non-interactive callers.
 */
export interface NoisySampler {
  step(k: number): boolean
  result(): NoisyRunResult
  readonly shots: number
  readonly done: number
}

export function createNoisySampler(
  circuit: Circuit,
  model: NoiseModel,
  shots: number,
  seed = 1
): NoisySampler {
  if (!Number.isInteger(shots) || shots < 1) throw new Error(`shots must be a positive integer, got ${shots}`)
  const m = validateNoiseModel(model)
  const rng = mulberry32(seed)
  const n = circuit.numQubits
  const dim = 1 << n
  const schedule = scheduleOps(circuit)
  const ideal = simulate(stripMeasurements(circuit))
  const idealProbs = ideal.probabilities()
  const noiseless = isNoiseless(m)
  const counts = new Uint32Array(dim)
  let fidelitySum = 0
  let eventSum = 0
  let done = 0

  return {
    shots,
    get done() { return done },
    step(k: number): boolean {
      const stop = Math.min(shots, done + k)
      for (; done < stop; done++) {
        if (noiseless) {
          // No point re-running a deterministic unitary `shots` times.
          counts[sampleIndex(idealProbs, rng)] += 1
          fidelitySum += 1
          continue
        }
        const { state, events } = runTrajectory(circuit, m, rng, schedule)
        fidelitySum += overlap2(ideal, state)
        eventSum += events
        const true_ = sampleIndex(state.probabilities(), rng)
        counts[applyReadoutError(true_, n, m.readout, rng)] += 1
      }
      return done >= shots
    },
    result(): NoisyRunResult {
      const ran = Math.max(done, 1)
      return {
        numQubits: n,
        shots: done,
        counts: counts.slice(),
        distribution: Float64Array.from(counts, (c) => c / ran),
        fidelity: done > 0 ? fidelitySum / done : 1,
        meanEvents: done > 0 ? eventSum / done : 0,
        depth: schedule.depth,
      }
    },
  }
}

/**
 * Run `shots` trajectories, read every qubit out through the confusion model
 * and aggregate. Deterministic for a given seed. With `NOISELESS` this returns
 * the ideal engine's distribution sampled with the same PRNG.
 */
export function runNoisy(
  circuit: Circuit,
  model: NoiseModel,
  shots: number,
  seed = 1
): NoisyRunResult {
  const sampler = createNoisySampler(circuit, model, shots, seed)
  sampler.step(shots)
  return sampler.result()
}

/** |⟨a|b⟩|². */
export function overlap2(a: StateVector, b: StateVector): number {
  let re = 0, im = 0
  for (let i = 0; i < a.dim; i++) {
    const ar = a.data[2 * i], ai = a.data[2 * i + 1]
    const br = b.data[2 * i], bi = b.data[2 * i + 1]
    re += ar * br + ai * bi
    im += ar * bi - ai * br
  }
  return re * re + im * im
}

function stripMeasurements(circuit: Circuit): Circuit {
  return { ...circuit, ops: circuit.ops.filter((op) => op.name !== 'MEASURE') }
}

// ────────────────────────────────────────────────────────────
// Observables
// ────────────────────────────────────────────────────────────

/**
 * What the page measures. `pauliZ` is the parity ⟨Z_{q1} Z_{q2} …⟩ read off
 * the bitstrings; `projector` is the probability of one basis state. Both are
 * functions of the measured distribution, so readout mitigation and ZNE act
 * on them the same way.
 */
export type Observable =
  | { type: 'pauliZ'; qubits: number[] }
  | { type: 'projector'; index: number }

/** Expectation of an observable over a distribution (quasi-probabilities allowed). */
export function expectation(dist: ArrayLike<number>, obs: Observable): number {
  if (obs.type === 'projector') return dist[obs.index] ?? 0
  let mask = 0
  for (const q of obs.qubits) mask |= 1 << q
  let e = 0
  for (let i = 0; i < dist.length; i++) {
    const parity = popcount(i & mask) & 1
    e += parity ? -dist[i] : dist[i]
  }
  return e
}

function popcount(x: number): number {
  let c = 0
  while (x) { x &= x - 1; c += 1 }
  return c
}

/** The exact ideal value, from the statevector, no sampling. */
export function idealExpectation(circuit: Circuit, obs: Observable): number {
  return expectation(simulate(stripMeasurements(circuit)).probabilities(), obs)
}

export function observableLabel(obs: Observable, numQubits: number): string {
  if (obs.type === 'projector') {
    return `P(|${obs.index.toString(2).padStart(numQubits, '0')}⟩)`
  }
  return `⟨${obs.qubits.map((q) => `Z${q}`).join('')}⟩`
}
