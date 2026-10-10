/**
 * lib/workbench/verify.ts — "does this circuit do what the spec says?"
 *
 * A SPEC is the developer's claim about a circuit: the measurement histogram
 * it should produce, the state it should prepare, or the unitary it should
 * implement, plus optional resource constraints. `verify()` runs the circuit
 * through the SAME simulator every visualization uses (lib/quantum.ts) and
 * returns a verdict whose diagnostics name the basis states, matrix entries
 * and gates that are wrong — the text the generate → verify → repair loop in
 * ./generate.ts hands back to the model.
 *
 * Conventions match lib/quantum.ts exactly: qubit 0 is the least significant
 * bit, basis index i has qubit q set when (i >> q) & 1, and labels are printed
 * MSB-first ("q_{n-1} … q_0"), so "01" on two qubits means q0 = 1. Matrices
 * are row-major with the same index for rows and columns.
 *
 * Every comparison that involves amplitudes is GLOBAL-PHASE BLIND: a state
 * and e^{iφ} times that state are the same state, and a unitary and e^{iφ}
 * times that unitary are the same gate. The fidelities below are the standard
 * phase-invariant ones — |⟨t|ψ⟩|² for states, |Tr(V†U)|²/d² for unitaries —
 * and the entry-level diagnostics are computed AFTER aligning the global
 * phase, so they name a real discrepancy and never the phase convention.
 *
 * No network, no model, no randomness. Deterministic in, deterministic out.
 */

import {
  GATE_BY_NAME,
  GATE_LIBRARY,
  StateVector,
  cAbs,
  cAbs2,
  cConj,
  cMul,
  hasClassicalControl,
  outcomeProbabilities,
  simulate,
  type Circuit,
  type Complex,
  type GateName,
  type GateOp,
} from '@/lib/quantum'

// ────────────────────────────────────────────────────────────
// Spec types
// ────────────────────────────────────────────────────────────

/** A real number, or a complex one written out. */
export type SpecNumber = number | { re: number; im: number }

export interface DistributionTarget {
  kind: 'distribution'
  /**
   * Probability per basis-state label (MSB-first, width numQubits). Labels
   * that are absent mean 0. Must sum to 1 within 1e-3.
   */
  probabilities: Record<string, number>
  /** Largest allowed |actual − target| on any single basis state. Default 0.02. */
  tolerance?: number
}

export interface StatevectorTarget {
  kind: 'statevector'
  /** 2^numQubits amplitudes, basis order 0 … 2^n − 1. Normalised on read. */
  amplitudes: SpecNumber[]
  /** Pass when |⟨target|ψ⟩|² is at least this. Default 0.999. */
  minFidelity?: number
}

export interface UnitaryTarget {
  kind: 'unitary'
  /** 2^n × 2^n row-major matrix, rows = output basis index, columns = input. */
  matrix: SpecNumber[][]
  /** Pass when |Tr(V†U)|²/d² is at least this. Default 0.999. */
  minFidelity?: number
}

export type SpecTarget = DistributionTarget | StatevectorTarget | UnitaryTarget

export interface SpecConstraints {
  /** Reject circuits wider than this. Defaults to the spec's numQubits. */
  maxQubits?: number
  /** Only these gates may appear (MEASURE and BARRIER are always allowed). */
  allowedGates?: GateName[]
  /** Circuit depth ceiling — longest chain of dependent gates. */
  maxDepth?: number
  /** Total gate ceiling (MEASURE and BARRIER do not count). */
  maxGates?: number
}

export interface CircuitSpec {
  /** Short name, used in prompts and the attempt timeline. */
  name?: string
  /** Plain-language intent, shown to the model beside the formal target. */
  description?: string
  numQubits: number
  target: SpecTarget
  constraints?: SpecConstraints
}

// ────────────────────────────────────────────────────────────
// Verdict types
// ────────────────────────────────────────────────────────────

export type DiagnosticLevel = 'error' | 'warn' | 'info'

export type DiagnosticCode =
  | 'spec_invalid'
  | 'simulation_failed'
  | 'not_unitary'
  | 'measure_ignored'
  | 'distribution_off'
  | 'fidelity_low'
  | 'too_many_qubits'
  | 'too_few_qubits'
  | 'gate_not_allowed'
  | 'depth_exceeded'
  | 'gate_count_exceeded'
  | 'ok'

export interface Diagnostic {
  level: DiagnosticLevel
  code: DiagnosticCode
  /** One actionable sentence. What is wrong, by how much, and what would fix it. */
  message: string
}

/** One basis state whose probability is off (distribution and statevector specs). */
export interface StateDeviation {
  label: string
  target: number
  actual: number
  /** actual − target. Negative: the circuit puts too little weight there. */
  delta: number
}

/** One amplitude that is off after global-phase alignment (statevector specs). */
export interface AmplitudeDeviation {
  label: string
  target: Complex
  actual: Complex
  /** |actual − target| in the complex plane. */
  distance: number
}

/** One matrix entry that is off after global-phase alignment (unitary specs). */
export interface EntryDeviation {
  /** Output basis label (row). */
  row: string
  /** Input basis label (column). */
  col: string
  target: Complex
  actual: Complex
  distance: number
}

export interface CircuitMetrics {
  numQubits: number
  /** Gates that do work: everything but MEASURE and BARRIER. */
  gateCount: number
  twoQubitGates: number
  depth: number
}

export interface VerifyResult {
  pass: boolean
  /**
   * 0 … 1. Distribution specs: 1 − total variation distance. Statevector and
   * unitary specs: the fidelity. Constraint failures do not lower the score —
   * they fail the verdict outright — so a score of 1 with pass: false means
   * "right physics, wrong resources".
   */
  score: number
  /** The phase-invariant fidelity for state and unitary specs; null for distributions. */
  fidelity: number | null
  diagnostics: Diagnostic[]
  metrics: CircuitMetrics
  stateDeviations: StateDeviation[]
  amplitudeDeviations: AmplitudeDeviation[]
  entryDeviations: EntryDeviation[]
  /** One line: the verdict and the biggest reason. */
  summary: string
}

// ────────────────────────────────────────────────────────────
// Defaults and limits
// ────────────────────────────────────────────────────────────

export const DEFAULT_TOLERANCE = 0.02
export const DEFAULT_MIN_FIDELITY = 0.999
/** Widest register a spec may name. 2^8 × 2^8 complex entries is already a 128 KB matrix. */
export const SPEC_MAX_QUBITS = 8
/** Unitary specs need one simulation per column; cap them tighter. */
export const UNITARY_MAX_QUBITS = 5
/** Below this an amplitude or matrix entry is "zero" and its phase is meaningless. */
const AMPLITUDE_EPSILON = 1e-9
/** Entry-level distance worth reporting after phase alignment. */
const ENTRY_REPORT_EPSILON = 1e-3
/** Rows of deviations kept in a verdict. Enough to act on, small enough to prompt with. */
const MAX_REPORTED = 8

const GATE_NAMES: ReadonlySet<string> = new Set(GATE_LIBRARY.map((g) => g.name).concat('BARRIER'))

// ────────────────────────────────────────────────────────────
// Spec validation — untrusted JSON in, typed spec out
// ────────────────────────────────────────────────────────────

export type SpecValidation = { ok: true; spec: CircuitSpec } | { ok: false; errors: string[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toComplex(v: unknown): Complex | null {
  if (typeof v === 'number') return Number.isFinite(v) ? { re: v, im: 0 } : null
  if (isRecord(v) && typeof v.re === 'number' && Number.isFinite(v.re)) {
    const im = v.im === undefined ? 0 : v.im
    if (typeof im !== 'number' || !Number.isFinite(im)) return null
    return { re: v.re, im }
  }
  return null
}

const LABEL_RE = /^[01]+$/

/**
 * Check an untrusted spec object and return a typed one, or every problem
 * found. Errors are complete rather than first-only: a developer editing a
 * spec in a textarea wants all of them at once.
 */
export function validateSpec(input: unknown): SpecValidation {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['Spec must be a JSON object.'] }

  const n = input.numQubits
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > SPEC_MAX_QUBITS) {
    errors.push(`numQubits must be an integer from 1 to ${SPEC_MAX_QUBITS}.`)
  }
  const numQubits = Number.isInteger(n) ? (n as number) : 1
  const dim = 1 << Math.max(1, Math.min(SPEC_MAX_QUBITS, numQubits))

  const name = typeof input.name === 'string' ? input.name.slice(0, 120) : undefined
  const description =
    typeof input.description === 'string' ? input.description.slice(0, 2_000) : undefined

  let target: SpecTarget | null = null
  const t = input.target
  if (!isRecord(t)) {
    errors.push('target must be an object with a kind of "distribution", "statevector" or "unitary".')
  } else if (t.kind === 'distribution') {
    const probabilities: Record<string, number> = {}
    if (!isRecord(t.probabilities)) {
      errors.push('target.probabilities must map basis-state labels to probabilities.')
    } else {
      let sum = 0
      for (const [label, p] of Object.entries(t.probabilities)) {
        if (!LABEL_RE.test(label) || label.length !== numQubits) {
          errors.push(
            `Label "${label}" is not a ${numQubits}-character bitstring (MSB-first, e.g. "${'0'.repeat(numQubits)}").`,
          )
          continue
        }
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
          errors.push(`Probability for "${label}" must be a number in [0, 1].`)
          continue
        }
        probabilities[label] = p
        sum += p
      }
      if (errors.length === 0 && Math.abs(sum - 1) > 1e-3) {
        errors.push(`Probabilities sum to ${sum.toFixed(4)}; they must sum to 1.`)
      }
    }
    let tolerance: number | undefined
    if (t.tolerance !== undefined) {
      if (typeof t.tolerance !== 'number' || !(t.tolerance >= 0) || t.tolerance > 0.5) {
        errors.push('target.tolerance must be a number from 0 to 0.5.')
      } else tolerance = t.tolerance
    }
    target = { kind: 'distribution', probabilities, ...(tolerance !== undefined ? { tolerance } : {}) }
  } else if (t.kind === 'statevector') {
    const amplitudes: SpecNumber[] = []
    if (!Array.isArray(t.amplitudes) || t.amplitudes.length !== dim) {
      errors.push(`target.amplitudes must be an array of exactly ${dim} entries (2^numQubits).`)
    } else {
      let norm = 0
      t.amplitudes.forEach((a, i) => {
        const z = toComplex(a)
        if (!z) errors.push(`amplitudes[${i}] must be a finite number or { re, im }.`)
        else {
          amplitudes.push(z)
          norm += cAbs2(z)
        }
      })
      if (errors.length === 0 && norm < 1e-12) errors.push('target.amplitudes are all zero.')
    }
    const minFidelity = readMinFidelity(t.minFidelity, errors)
    target = { kind: 'statevector', amplitudes, ...(minFidelity !== undefined ? { minFidelity } : {}) }
  } else if (t.kind === 'unitary') {
    const matrix: SpecNumber[][] = []
    if (numQubits > UNITARY_MAX_QUBITS) {
      errors.push(`Unitary specs are limited to ${UNITARY_MAX_QUBITS} qubits.`)
    }
    if (!Array.isArray(t.matrix) || t.matrix.length !== dim) {
      errors.push(`target.matrix must be a ${dim}×${dim} array of rows.`)
    } else {
      t.matrix.forEach((row, r) => {
        if (!Array.isArray(row) || row.length !== dim) {
          errors.push(`matrix row ${r} must have exactly ${dim} entries.`)
          return
        }
        const out: SpecNumber[] = []
        row.forEach((v, c) => {
          const z = toComplex(v)
          if (!z) errors.push(`matrix[${r}][${c}] must be a finite number or { re, im }.`)
          else out.push(z)
        })
        matrix.push(out)
      })
      if (errors.length === 0 && !isUnitaryMatrix(matrix.map((row) => row.map((z) => toComplex(z)!)))) {
        errors.push('target.matrix is not unitary (U†U ≠ I to within 1e-6).')
      }
    }
    const minFidelity = readMinFidelity(t.minFidelity, errors)
    target = { kind: 'unitary', matrix, ...(minFidelity !== undefined ? { minFidelity } : {}) }
  } else {
    errors.push('target.kind must be "distribution", "statevector" or "unitary".')
  }

  let constraints: SpecConstraints | undefined
  if (input.constraints !== undefined) {
    if (!isRecord(input.constraints)) {
      errors.push('constraints must be an object.')
    } else {
      const c = input.constraints
      constraints = {}
      if (c.maxQubits !== undefined) {
        if (!Number.isInteger(c.maxQubits) || (c.maxQubits as number) < 1 || (c.maxQubits as number) > 16) {
          errors.push('constraints.maxQubits must be an integer from 1 to 16.')
        } else constraints.maxQubits = c.maxQubits as number
      }
      if (c.maxDepth !== undefined) {
        if (!Number.isInteger(c.maxDepth) || (c.maxDepth as number) < 1) {
          errors.push('constraints.maxDepth must be a positive integer.')
        } else constraints.maxDepth = c.maxDepth as number
      }
      if (c.maxGates !== undefined) {
        if (!Number.isInteger(c.maxGates) || (c.maxGates as number) < 1) {
          errors.push('constraints.maxGates must be a positive integer.')
        } else constraints.maxGates = c.maxGates as number
      }
      if (c.allowedGates !== undefined) {
        if (!Array.isArray(c.allowedGates) || c.allowedGates.length === 0) {
          errors.push('constraints.allowedGates must be a non-empty array of gate names.')
        } else {
          const gates: GateName[] = []
          for (const g of c.allowedGates) {
            const upper = typeof g === 'string' ? g.toUpperCase() : ''
            if (!GATE_NAMES.has(upper) || upper === 'MEASURE' || upper === 'BARRIER') {
              errors.push(
                `constraints.allowedGates: "${String(g)}" is not a gate. Known: ${GATE_LIBRARY.filter((s) => s.name !== 'MEASURE').map((s) => s.name).join(', ')}.`,
              )
            } else gates.push(upper as GateName)
          }
          constraints.allowedGates = gates
        }
      }
    }
  }

  if (errors.length > 0 || !target) return { ok: false, errors }
  return {
    ok: true,
    spec: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      numQubits,
      target,
      ...(constraints ? { constraints } : {}),
    },
  }
}

function readMinFidelity(v: unknown, errors: string[]): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !(v > 0) || v > 1) {
    errors.push('target.minFidelity must be a number in (0, 1].')
    return undefined
  }
  return v
}

/** U†U = I to within 1e-6 on every entry. */
export function isUnitaryMatrix(m: Complex[][]): boolean {
  const d = m.length
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let acc: Complex = { re: 0, im: 0 }
      for (let k = 0; k < d; k++) {
        const t = cMul(cConj(m[k][i]), m[k][j])
        acc = { re: acc.re + t.re, im: acc.im + t.im }
      }
      const want = i === j ? 1 : 0
      if (Math.abs(acc.re - want) > 1e-6 || Math.abs(acc.im) > 1e-6) return false
    }
  }
  return true
}

// ────────────────────────────────────────────────────────────
// Circuit metrics
// ────────────────────────────────────────────────────────────

/** BARRIER and MEASURE are annotations, not work; everything else counts. */
export function countsAsGate(op: GateOp): boolean {
  return op.name !== 'BARRIER' && op.name !== 'MEASURE'
}

/**
 * Depth by greedy layering: each gate lands one layer after the latest layer
 * any of its qubits is busy in. Measurements count (they occupy the qubit);
 * barriers do not. This is the definition Qiskit's `QuantumCircuit.depth()`
 * uses for a circuit without classical dependencies.
 */
export function circuitDepth(circuit: Circuit): number {
  const last = new Array<number>(circuit.numQubits).fill(0)
  let depth = 0
  for (const op of circuit.ops) {
    if (op.name === 'BARRIER') continue
    let layer = 0
    for (const q of op.qubits) layer = Math.max(layer, last[q] ?? 0)
    layer += 1
    for (const q of op.qubits) last[q] = layer
    depth = Math.max(depth, layer)
  }
  return depth
}

export function circuitMetrics(circuit: Circuit): CircuitMetrics {
  let gateCount = 0
  let twoQubitGates = 0
  for (const op of circuit.ops) {
    if (!countsAsGate(op)) continue
    gateCount += 1
    if (op.qubits.length >= 2) twoQubitGates += 1
  }
  return { numQubits: circuit.numQubits, gateCount, twoQubitGates, depth: circuitDepth(circuit) }
}

// ────────────────────────────────────────────────────────────
// Circuit sanity — the simulator throws on bad ops; say why before it does
// ────────────────────────────────────────────────────────────

/** A problem the simulator would throw on, phrased for a repair prompt. */
export function circuitProblems(circuit: Circuit): string[] {
  const problems: string[] = []
  if (!Number.isInteger(circuit.numQubits) || circuit.numQubits < 1 || circuit.numQubits > 16) {
    problems.push(`numQubits must be an integer from 1 to 16, got ${circuit.numQubits}.`)
    return problems
  }
  circuit.ops.forEach((op, i) => {
    if (!GATE_NAMES.has(op.name)) {
      problems.push(`op ${i}: "${op.name}" is not a supported gate.`)
      return
    }
    const arity = GATE_BY_NAME[op.name]?.arity ?? (op.name === 'BARRIER' ? op.qubits.length : 1)
    if (op.name !== 'BARRIER' && op.qubits.length !== arity) {
      problems.push(`op ${i}: ${op.name} takes ${arity} qubit(s), got ${op.qubits.length}.`)
    }
    for (const q of op.qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= circuit.numQubits) {
        problems.push(`op ${i}: ${op.name} names qubit ${q}, but the register is q[0..${circuit.numQubits - 1}].`)
      }
    }
    if (op.name !== 'SWAP' && op.name !== 'BARRIER' && new Set(op.qubits).size !== op.qubits.length) {
      problems.push(`op ${i}: ${op.name} lists the same qubit twice.`)
    }
    if (GATE_BY_NAME[op.name]?.hasAngle && (op.theta === undefined || !Number.isFinite(op.theta))) {
      problems.push(`op ${i}: ${op.name} needs a finite angle theta.`)
    }
  })
  return problems
}

// ────────────────────────────────────────────────────────────
// Unitary extraction — one simulation per input basis state
// ────────────────────────────────────────────────────────────

/**
 * The circuit's unitary as a row-major matrix: column j is the circuit
 * applied to |j⟩. Throws (via the simulator) on invalid ops, and refuses
 * circuits with recorded measurements or classical control, which are not
 * unitary maps at all.
 */
export function circuitUnitary(circuit: Circuit): Complex[][] {
  if (hasClassicalControl(circuit)) {
    throw new Error('a circuit with recorded measurements or classical control has no unitary')
  }
  const dim = 1 << circuit.numQubits
  const columns: Complex[][] = []
  for (let j = 0; j < dim; j++) {
    const sv = new StateVector(circuit.numQubits)
    for (let q = 0; q < circuit.numQubits; q++) if ((j >> q) & 1) sv.applySingle('X', q)
    for (const op of circuit.ops) sv.apply(op)
    columns.push(sv.amplitudes())
  }
  // Transpose: matrix[row][col].
  return Array.from({ length: dim }, (_, r) => columns.map((col) => col[r]))
}

// ────────────────────────────────────────────────────────────
// Fidelities — phase-invariant by construction
// ────────────────────────────────────────────────────────────

/** ⟨a|b⟩ = Σ conj(a_i) b_i. */
export function innerProduct(a: Complex[], b: Complex[]): Complex {
  let re = 0, im = 0
  for (let i = 0; i < a.length; i++) {
    const t = cMul(cConj(a[i]), b[i])
    re += t.re
    im += t.im
  }
  return { re, im }
}

/** |⟨target|actual⟩|² for two normalised states. */
export function stateFidelity(target: Complex[], actual: Complex[]): number {
  return Math.min(1, cAbs2(innerProduct(target, actual)))
}

/** Tr(V†U) — the overlap whose phase aligns U to V and whose magnitude is the fidelity. */
export function unitaryOverlap(target: Complex[][], actual: Complex[][]): Complex {
  const d = target.length
  let re = 0, im = 0
  for (let i = 0; i < d; i++) {
    for (let k = 0; k < d; k++) {
      // (V†U)_{ii} = Σ_k conj(V_{ki}) U_{ki}
      const t = cMul(cConj(target[k][i]), actual[k][i])
      re += t.re
      im += t.im
    }
  }
  return { re, im }
}

/** |Tr(V†U)|² / d² — 1 iff U = e^{iφ}V. */
export function processFidelity(target: Complex[][], actual: Complex[][]): number {
  const d = target.length
  return Math.min(1, cAbs2(unitaryOverlap(target, actual)) / (d * d))
}

function normalise(v: Complex[]): Complex[] {
  let norm = 0
  for (const z of v) norm += cAbs2(z)
  norm = Math.sqrt(norm)
  return norm > 0 ? v.map((z) => ({ re: z.re / norm, im: z.im / norm })) : v
}

/** Multiply every entry by e^{-iφ} where φ = arg(overlap): the phase that best aligns actual to target. */
function alignPhase<T extends Complex[] | Complex[][]>(values: T, overlap: Complex): T {
  const mag = cAbs(overlap)
  if (mag < AMPLITUDE_EPSILON) return values
  const rot: Complex = { re: overlap.re / mag, im: -overlap.im / mag }
  const rotate = (z: Complex) => cMul(z, rot)
  return (Array.isArray(values[0])
    ? (values as Complex[][]).map((row) => row.map(rotate))
    : (values as Complex[]).map(rotate)) as T
}

function label(i: number, numQubits: number): string {
  return i.toString(2).padStart(numQubits, '0')
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtC = (z: Complex) => {
  const re = Math.abs(z.re) < 5e-4 ? 0 : z.re
  const im = Math.abs(z.im) < 5e-4 ? 0 : z.im
  if (im === 0) return re.toFixed(3)
  if (re === 0) return `${im.toFixed(3)}i`
  return `${re.toFixed(3)}${im >= 0 ? '+' : '-'}${Math.abs(im).toFixed(3)}i`
}

// ────────────────────────────────────────────────────────────
// verify()
// ────────────────────────────────────────────────────────────

function emptyResult(circuit: Circuit): VerifyResult {
  return {
    pass: false,
    score: 0,
    fidelity: null,
    diagnostics: [],
    metrics: safeMetrics(circuit),
    stateDeviations: [],
    amplitudeDeviations: [],
    entryDeviations: [],
    summary: '',
  }
}

function safeMetrics(circuit: Circuit): CircuitMetrics {
  try {
    return circuitMetrics(circuit)
  } catch {
    return { numQubits: circuit.numQubits, gateCount: circuit.ops.length, twoQubitGates: 0, depth: 0 }
  }
}

/**
 * Verify a circuit against a spec. Never throws for a malformed circuit —
 * the failure becomes a diagnostic, because the caller is usually a loop
 * that wants to feed the failure back, not a stack trace.
 */
export function verify(circuit: Circuit, spec: CircuitSpec): VerifyResult {
  const result = emptyResult(circuit)
  const diags = result.diagnostics

  // ── Structural problems first: the simulator would throw on these.
  const problems = circuitProblems(circuit)
  if (problems.length > 0) {
    for (const p of problems) diags.push({ level: 'error', code: 'simulation_failed', message: p })
    result.summary = `Fail: the circuit cannot be simulated (${problems[0]})`
    return result
  }

  // ── Width. A spec for n qubits wants an n-qubit circuit: a narrower one
  // cannot produce the labels, a wider one produces labels the spec has no
  // opinion about (and maxQubits may allow it only when it says so).
  const maxQubits = spec.constraints?.maxQubits ?? spec.numQubits
  if (circuit.numQubits > maxQubits) {
    diags.push({
      level: 'error',
      code: 'too_many_qubits',
      message: `The circuit uses ${circuit.numQubits} qubits; the spec allows at most ${maxQubits}.`,
    })
  }
  if (circuit.numQubits !== spec.numQubits) {
    diags.push({
      level: 'error',
      code: circuit.numQubits < spec.numQubits ? 'too_few_qubits' : 'too_many_qubits',
      message: `The spec is for exactly ${spec.numQubits} qubit(s) (labels are ${spec.numQubits} bits wide); the circuit declares ${circuit.numQubits}. Use qubit[${spec.numQubits}] q;.`,
    })
    result.summary = `Fail: wrong register width (${circuit.numQubits} vs ${spec.numQubits})`
    return result
  }

  // ── Resource constraints.
  const c = spec.constraints
  if (c?.allowedGates) {
    const allowed = new Set<string>(c.allowedGates)
    const bad = new Map<string, number>()
    for (const op of circuit.ops) {
      if (!countsAsGate(op)) continue
      if (!allowed.has(op.name)) bad.set(op.name, (bad.get(op.name) ?? 0) + 1)
    }
    if (bad.size > 0) {
      const list = Array.from(bad.entries()).map(([g, k]) => `${g}×${k}`).join(', ')
      diags.push({
        level: 'error',
        code: 'gate_not_allowed',
        message: `Gates outside the allowed set {${c.allowedGates.join(', ')}}: ${list}. Rewrite them using allowed gates only.`,
      })
    }
  }
  if (c?.maxDepth !== undefined && result.metrics.depth > c.maxDepth) {
    diags.push({
      level: 'error',
      code: 'depth_exceeded',
      message: `Depth ${result.metrics.depth} exceeds the limit of ${c.maxDepth}. Parallelise gates on different qubits or remove ${result.metrics.depth - c.maxDepth} layer(s).`,
    })
  }
  if (c?.maxGates !== undefined && result.metrics.gateCount > c.maxGates) {
    diags.push({
      level: 'error',
      code: 'gate_count_exceeded',
      message: `${result.metrics.gateCount} gates exceeds the limit of ${c.maxGates}. Remove ${result.metrics.gateCount - c.maxGates}.`,
    })
  }
  const constraintsOk = diags.every((d) => d.level !== 'error')

  // ── The physics.
  let physicsOk = false
  let headline = ''
  try {
    switch (spec.target.kind) {
      case 'distribution': {
        const t = spec.target
        const tolerance = t.tolerance ?? DEFAULT_TOLERANCE
        const dim = 1 << spec.numQubits
        const actual = hasClassicalControl(circuit)
          ? outcomeProbabilities(circuit)
          : simulate(circuit).probabilities()
        let tvd = 0
        const deviations: StateDeviation[] = []
        for (let i = 0; i < dim; i++) {
          const lab = label(i, spec.numQubits)
          const target = t.probabilities[lab] ?? 0
          const delta = actual[i] - target
          tvd += Math.abs(delta) / 2
          if (Math.abs(delta) > tolerance) deviations.push({ label: lab, target, actual: actual[i], delta })
        }
        deviations.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        result.score = Math.max(0, 1 - tvd)
        result.stateDeviations = deviations.slice(0, MAX_REPORTED)
        physicsOk = deviations.length === 0
        if (physicsOk) {
          diags.push({
            level: 'info',
            code: 'ok',
            message: `Every basis state is within ±${pct(tolerance)} of the target (total variation ${pct(tvd)}).`,
          })
          headline = `distribution matches within ±${pct(tolerance)}`
        } else {
          const worst = deviations[0]
          diags.push({
            level: 'error',
            code: 'distribution_off',
            message:
              `${deviations.length} basis state(s) are off by more than ${pct(tolerance)}: ` +
              result.stateDeviations
                .map((d) => `|${d.label}⟩ target ${pct(d.target)} got ${pct(d.actual)} (${d.delta >= 0 ? '+' : ''}${pct(d.delta)})`)
                .join('; ') +
              (deviations.length > MAX_REPORTED ? `; and ${deviations.length - MAX_REPORTED} more` : '') +
              '.',
          })
          headline = `|${worst.label}⟩ is ${worst.delta >= 0 ? 'over' : 'under'} by ${pct(Math.abs(worst.delta))}`
        }
        break
      }

      case 'statevector': {
        const t = spec.target
        const minFidelity = t.minFidelity ?? DEFAULT_MIN_FIDELITY
        if (hasClassicalControl(circuit)) {
          diags.push({
            level: 'error',
            code: 'not_unitary',
            message:
              'The circuit records measurements or conditions gates on them, so it does not prepare a single pure state. Remove the measurements: a statevector spec is checked before measurement.',
          })
          headline = 'the circuit measures; a statevector spec cannot be checked'
          break
        }
        if (circuit.ops.some((op) => op.name === 'MEASURE')) {
          diags.push({
            level: 'warn',
            code: 'measure_ignored',
            message: 'Measurements were ignored: the state is compared before any measurement.',
          })
        }
        const target = normalise(spec.target.amplitudes.map((a) => toComplex(a)!))
        const actual = simulate(circuit).amplitudes()
        const overlap = innerProduct(target, actual)
        const fidelity = Math.min(1, cAbs2(overlap))
        result.fidelity = fidelity
        result.score = fidelity
        physicsOk = fidelity >= minFidelity
        const aligned = alignPhase(actual, overlap)
        const ampDev: AmplitudeDeviation[] = []
        const probDev: StateDeviation[] = []
        for (let i = 0; i < target.length; i++) {
          const lab = label(i, spec.numQubits)
          const distance = cAbs({ re: aligned[i].re - target[i].re, im: aligned[i].im - target[i].im })
          if (distance > ENTRY_REPORT_EPSILON) {
            ampDev.push({ label: lab, target: target[i], actual: aligned[i], distance })
          }
          const pt = cAbs2(target[i]), pa = cAbs2(actual[i])
          if (Math.abs(pa - pt) > ENTRY_REPORT_EPSILON) {
            probDev.push({ label: lab, target: pt, actual: pa, delta: pa - pt })
          }
        }
        ampDev.sort((a, b) => b.distance - a.distance)
        probDev.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        result.amplitudeDeviations = ampDev.slice(0, MAX_REPORTED)
        result.stateDeviations = probDev.slice(0, MAX_REPORTED)
        if (physicsOk) {
          diags.push({ level: 'info', code: 'ok', message: `State fidelity ${fidelity.toFixed(6)} (global phase ignored).` })
          headline = `state fidelity ${fidelity.toFixed(4)}`
        } else {
          const phaseOnly = probDev.length === 0 && ampDev.length > 0
          diags.push({
            level: 'error',
            code: 'fidelity_low',
            message:
              `State fidelity ${fidelity.toFixed(4)} is below ${minFidelity}. ` +
              (phaseOnly
                ? 'The probabilities are right but the RELATIVE phases are wrong (global phase is already ignored): '
                : 'Off after aligning the global phase: ') +
              result.amplitudeDeviations
                .map((d) => `|${d.label}⟩ target ${fmtC(d.target)} got ${fmtC(d.actual)}`)
                .join('; ') +
              '.',
          })
          headline = phaseOnly
            ? `right probabilities, wrong relative phase (fidelity ${fidelity.toFixed(3)})`
            : `state fidelity ${fidelity.toFixed(3)} < ${minFidelity}`
        }
        break
      }

      case 'unitary': {
        const t = spec.target
        const minFidelity = t.minFidelity ?? DEFAULT_MIN_FIDELITY
        if (hasClassicalControl(circuit)) {
          diags.push({
            level: 'error',
            code: 'not_unitary',
            message:
              'The circuit records measurements or conditions gates on them, so it is not a unitary. Remove them.',
          })
          headline = 'the circuit measures; it has no unitary'
          break
        }
        if (circuit.ops.some((op) => op.name === 'MEASURE')) {
          diags.push({
            level: 'warn',
            code: 'measure_ignored',
            message: 'Measurements were ignored: the unitary is what the gates do before any measurement.',
          })
        }
        const target = t.matrix.map((row) => row.map((z) => toComplex(z)!))
        const actual = circuitUnitary(circuit)
        const overlap = unitaryOverlap(target, actual)
        const d = target.length
        const fidelity = Math.min(1, cAbs2(overlap) / (d * d))
        result.fidelity = fidelity
        result.score = fidelity
        physicsOk = fidelity >= minFidelity
        const aligned = alignPhase(actual, overlap)
        const entries: EntryDeviation[] = []
        for (let r = 0; r < d; r++) {
          for (let col = 0; col < d; col++) {
            const distance = cAbs({ re: aligned[r][col].re - target[r][col].re, im: aligned[r][col].im - target[r][col].im })
            if (distance > ENTRY_REPORT_EPSILON) {
              entries.push({
                row: label(r, spec.numQubits),
                col: label(col, spec.numQubits),
                target: target[r][col],
                actual: aligned[r][col],
                distance,
              })
            }
          }
        }
        entries.sort((a, b) => b.distance - a.distance)
        result.entryDeviations = entries.slice(0, MAX_REPORTED)
        // Per-input-column fidelity: "on input |01⟩ the circuit produces the wrong state".
        const badColumns: string[] = []
        for (let col = 0; col < d; col++) {
          const tc = target.map((row) => row[col])
          const ac = actual.map((row) => row[col])
          if (stateFidelity(tc, ac) < minFidelity) badColumns.push(label(col, spec.numQubits))
        }
        if (physicsOk) {
          diags.push({ level: 'info', code: 'ok', message: `Process fidelity ${fidelity.toFixed(6)} (global phase ignored).` })
          headline = `process fidelity ${fidelity.toFixed(4)}`
        } else {
          diags.push({
            level: 'error',
            code: 'fidelity_low',
            message:
              `Process fidelity ${fidelity.toFixed(4)} is below ${minFidelity}. ` +
              (badColumns.length > 0
                ? `Wrong output on input state(s) |${badColumns.join('⟩, |')}⟩. `
                : 'Every column is close individually; the relative phases between columns are off. ') +
              'Largest entry errors after phase alignment (row = output, col = input): ' +
              result.entryDeviations
                .map((e) => `U[${e.row}][${e.col}] target ${fmtC(e.target)} got ${fmtC(e.actual)}`)
                .join('; ') +
              '.',
          })
          headline = `process fidelity ${fidelity.toFixed(3)} < ${minFidelity}`
        }
        break
      }
    }
  } catch (cause) {
    diags.push({
      level: 'error',
      code: 'simulation_failed',
      message: `Simulation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
    result.summary = 'Fail: simulation failed'
    return result
  }

  result.pass = physicsOk && constraintsOk
  const m = result.metrics
  const resources = `${m.gateCount} gate(s), ${m.twoQubitGates} two-qubit, depth ${m.depth}`
  if (result.pass) {
    result.summary = `Pass: ${headline} · ${resources}`
  } else if (physicsOk) {
    const firstConstraint = diags.find((d) => d.level === 'error')
    result.summary = `Fail: right physics, but ${firstConstraint?.message.split('.')[0].toLowerCase() ?? 'a constraint is violated'} · ${resources}`
  } else {
    result.summary = `Fail: ${headline} · ${resources}`
  }
  return result
}

/**
 * The verdict as text a model (or a person) can act on. This is what the
 * repair prompt carries — it is kept short and concrete on purpose, and it
 * never includes the target amplitudes in full, only the entries that differ.
 */
export function formatDiagnostics(result: VerifyResult): string {
  const lines: string[] = [result.summary]
  for (const d of result.diagnostics) {
    if (d.level === 'info') continue
    lines.push(`- [${d.level}] ${d.message}`)
  }
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────
// Circuit-vs-circuit equivalence — no spec, just two circuits
// ────────────────────────────────────────────────────────────

/** Widest register compareCircuits will diagonalise. 2^10 × 2^10 unitary, one simulation per column. */
export const EQUIVALENCE_MAX_QUBITS = 10

export interface EquivalenceResult {
  equivalent: boolean
  fidelity: number
  note?: string
}

/**
 * Are two circuits the same unitary, up to global phase? Compares
 * processFidelity(circuitUnitary(a), circuitUnitary(b)) against minFidelity.
 *
 * Refuses rather than guesses: a width mismatch is not padded with identity
 * (that would be deciding what "equivalent" means across different qubit
 * counts on the caller's behalf), an oversized pair is rejected instead of
 * simulated (circuitUnitary is O(2^(2n))), and a circuit that is not a bare
 * unitary — RESET, POSTSELECT, a recorded measurement or classical control,
 * all caught by hasClassicalControl inside circuitUnitary — is reported by
 * name rather than left to throw past the caller.
 */
export function compareCircuits(a: Circuit, b: Circuit, minFidelity = DEFAULT_MIN_FIDELITY): EquivalenceResult {
  if (a.numQubits !== b.numQubits) {
    return { equivalent: false, fidelity: 0, note: 'circuits act on a different number of qubits' }
  }
  if (a.numQubits > EQUIVALENCE_MAX_QUBITS || b.numQubits > EQUIVALENCE_MAX_QUBITS) {
    return {
      equivalent: false,
      fidelity: 0,
      note: `circuits are capped at ${EQUIVALENCE_MAX_QUBITS} qubits for equivalence checking (2^${EQUIVALENCE_MAX_QUBITS} × 2^${EQUIVALENCE_MAX_QUBITS} unitary, one simulation per basis vector); this pair uses ${Math.max(a.numQubits, b.numQubits)}.`,
    }
  }

  let unitaryA: Complex[][]
  try {
    unitaryA = circuitUnitary(a)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      equivalent: false,
      fidelity: 0,
      note: `circuit A is not a bare unitary (measurement, RESET, or POSTSELECT present): ${message}`,
    }
  }

  let unitaryB: Complex[][]
  try {
    unitaryB = circuitUnitary(b)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      equivalent: false,
      fidelity: 0,
      note: `circuit B is not a bare unitary (measurement, RESET, or POSTSELECT present): ${message}`,
    }
  }

  const fidelity = processFidelity(unitaryA, unitaryB)
  return { equivalent: fidelity >= minFidelity, fidelity, note: undefined }
}
