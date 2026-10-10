/**
 * deutschJozsa.ts — the Deutsch–Jozsa and Bernstein–Vazirani circuits, run on
 * the real statevector engine in lib/quantum.ts.
 *
 * Both algorithms are the SAME circuit — H on every input qubit, one oracle
 * call, H again — and differ only in what you do with the measurement. That is
 * the reason they share a module and a page: Deutsch–Jozsa asks whether the
 * result is |0…0⟩, Bernstein–Vazirani reads the result as a bitstring.
 *
 * Nothing here fakes the oracle. `applyOracle` builds U_f as an honest reversible
 * circuit on n + 1 qubits, |x⟩|y⟩ → |x⟩|y ⊕ f(x)⟩, out of X and (multi-)controlled
 * X gates, and the phase kickback that the pages talk about is a consequence of
 * running it against an ancilla in |−⟩ rather than something written in by hand.
 *
 * Amplitudes stay real throughout (X, H and CX have real matrices), which is what
 * lets the page draw signed bars and print an exact amplitude table.
 *
 * deutschJozsa.test.ts checks the results against independent facts — a constant
 * oracle must return |0…0⟩ with probability exactly 1, EVERY balanced function on
 * 2 and 3 bits must return it with probability exactly 0, and Bernstein–Vazirani
 * must return the hidden string it was given — not against this module's own output.
 */

import { StateVector } from '@/lib/quantum'

/** Input-register sizes the page offers. 4 + 1 ancilla is 32 amplitudes. */
export const MIN_INPUT_QUBITS = 2
export const MAX_INPUT_QUBITS = 4

/**
 * The oracle, as data.
 *
 * - `constant` — f(x) = value for every x. One query tells you nothing classically.
 * - `parity`   — f(x) = (s · x) ⊕ b, the linear function Bernstein–Vazirani reads
 *                out. Balanced for every s ≠ 0, constant for s = 0.
 * - `table`    — an arbitrary truth table, so the page can offer a balanced
 *                function that is NOT a parity (Deutsch–Jozsa handles those;
 *                Bernstein–Vazirani does not).
 */
export type OracleSpec =
  | { kind: 'constant'; value: 0 | 1 }
  | { kind: 'parity'; s: number; b: 0 | 1 }
  | { kind: 'table'; values: readonly (0 | 1)[] }

export type OracleClass = 'constant' | 'balanced' | 'neither'

/** Parity of the set bits of x — the classical (s · x) mod 2 for s = all ones. */
export function bitParity(x: number): 0 | 1 {
  let v = x >>> 0
  v ^= v >>> 16
  v ^= v >>> 8
  v ^= v >>> 4
  v ^= v >>> 2
  v ^= v >>> 1
  return (v & 1) as 0 | 1
}

function assertQubitCount(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > MAX_INPUT_QUBITS) {
    throw new Error(`input register must be 1..${MAX_INPUT_QUBITS} qubits, got ${n}`)
  }
}

/**
 * The full truth table of f, MOST importantly computed CLASSICALLY — the tests
 * compare the quantum run against this, so it must never be derived from a
 * statevector.
 */
export function truthTable(spec: OracleSpec, n: number): (0 | 1)[] {
  assertQubitCount(n)
  const dim = 1 << n
  switch (spec.kind) {
    case 'constant':
      return new Array<0 | 1>(dim).fill(spec.value)
    case 'parity': {
      if (!Number.isInteger(spec.s) || spec.s < 0 || spec.s >= dim) {
        throw new Error(`hidden string ${spec.s} does not fit in ${n} bits`)
      }
      return Array.from({ length: dim }, (_, x) => (bitParity(x & spec.s) ^ spec.b) as 0 | 1)
    }
    case 'table': {
      if (spec.values.length !== dim) {
        throw new Error(`truth table needs ${dim} entries, got ${spec.values.length}`)
      }
      return spec.values.slice() as (0 | 1)[]
    }
  }
}

/** Is f constant, balanced, or neither? Deutsch–Jozsa promises it is never 'neither'. */
export function classify(table: readonly (0 | 1)[]): OracleClass {
  const ones = table.reduce<number>((acc, v) => acc + v, 0)
  if (ones === 0 || ones === table.length) return 'constant'
  if (ones * 2 === table.length) return 'balanced'
  return 'neither'
}

/**
 * The balanced-but-not-a-parity function the page offers:
 * f(x) = x₀ ⊕ (x₁ ∧ x₂ ∧ … ∧ x_{n−1}).
 *
 * Balanced for every n ≥ 1, because flipping x₀ always flips f — so exactly half
 * the inputs give 1. Non-linear for n ≥ 3, which is the point: Deutsch–Jozsa
 * still separates it from a constant in one query, while Bernstein–Vazirani's
 * readout is only meaningful when f is a parity. At n = 2 it degenerates to
 * x₀ ⊕ x₁, which IS a parity — every balanced function on two bits is affine.
 */
export function nonLinearBalancedTable(n: number): (0 | 1)[] {
  assertQubitCount(n)
  const dim = 1 << n
  const highMask = dim - 2 // bits 1..n-1
  return Array.from({ length: dim }, (_, x) => {
    const and = n === 1 ? 0 : (x & highMask) === highMask ? 1 : 0
    return ((x & 1) ^ and) as 0 | 1
  })
}

/**
 * Apply U_f: |x⟩|y⟩ → |x⟩|y ⊕ f(x)⟩, with the input register on qubits 0..n−1
 * and the ancilla on qubit n.
 *
 * Built from real gates, not from a hand-written phase table. A `table` oracle
 * costs one n-controlled X per input with f(x) = 1, wrapped in X gates that turn
 * the zero bits of x into ones — the textbook construction, and the reason the
 * page can say the oracle is a circuit rather than a wish.
 */
export function applyOracle(sv: StateVector, spec: OracleSpec, n: number): void {
  assertQubitCount(n)
  if (sv.numQubits !== n + 1) {
    throw new Error(`oracle needs ${n + 1} qubits (input + ancilla), got ${sv.numQubits}`)
  }
  const anc = n

  if (spec.kind === 'constant') {
    if (spec.value === 1) sv.applySingle('X', anc)
    return
  }

  if (spec.kind === 'parity') {
    for (let j = 0; j < n; j++) {
      if ((spec.s >> j) & 1) sv.applyControlled('X', [j], anc)
    }
    if (spec.b === 1) sv.applySingle('X', anc)
    return
  }

  const table = truthTable(spec, n)
  const controls = Array.from({ length: n }, (_, j) => j)
  for (let x = 0; x < table.length; x++) {
    if (table[x] !== 1) continue
    for (let j = 0; j < n; j++) if (((x >> j) & 1) === 0) sv.applySingle('X', j)
    sv.applyControlled('X', controls, anc)
    for (let j = 0; j < n; j++) if (((x >> j) & 1) === 0) sv.applySingle('X', j)
  }
}

/** Largest |imaginary part| anywhere in the state. Should stay at 0 for these circuits. */
export function maxImaginary(sv: StateVector): number {
  let worst = 0
  for (let i = 0; i < sv.dim; i++) worst = Math.max(worst, Math.abs(sv.amplitude(i).im))
  return worst
}

/**
 * The input register's own amplitudes, with the ancilla factored out.
 *
 * Valid because every step of this circuit leaves the state a product
 * |φ⟩ ⊗ |ancilla⟩ — that is exactly why the ancilla can be ignored once the
 * kickback has happened. The extraction takes the ⟨x, ancilla = 0| column and
 * renormalises it, which recovers |φ⟩ up to a global sign fixed by that column.
 *
 * `isProductWithAncilla` below is the guard; the test suite asserts it holds at
 * every step, so the table the page prints is the real state and not a summary
 * of one that has secretly entangled.
 */
export function registerAmplitudes(sv: StateVector, n: number): number[] {
  assertQubitCount(n)
  const dim = 1 << n
  const col = Array.from({ length: dim }, (_, x) => sv.amplitude(x).re)
  const norm = Math.hypot(...col)
  if (norm < 1e-9) {
    throw new Error('ancilla has no overlap with |0⟩; the input register cannot be read off')
  }
  return col.map((v) => v / norm)
}

/**
 * True when the state is |φ⟩ ⊗ |ancilla⟩ — i.e. the two ancilla columns are
 * proportional. Checked by the tests rather than trusted.
 */
export function isProductWithAncilla(sv: StateVector, n: number, tol = 1e-9): boolean {
  const dim = 1 << n
  const c0 = Array.from({ length: dim }, (_, x) => sv.amplitude(x).re)
  const c1 = Array.from({ length: dim }, (_, x) => sv.amplitude(x + dim).re)
  // A product state means the two ancilla columns are proportional: c1 = λ·c0
  // for one λ shared by every x. Anything else is entanglement between the
  // input register and the ancilla.
  let lambda: number | null = null
  for (let x = 0; x < dim; x++) {
    if (Math.abs(c0[x]) < tol) {
      if (Math.abs(c1[x]) > 1e-8) return false
      continue
    }
    const r = c1[x] / c0[x]
    if (lambda === null) lambda = r
    else if (Math.abs(r - lambda) > 1e-8) return false
  }
  return true
}

export type StepId = 'init' | 'ancilla' | 'superpose' | 'oracle' | 'interfere'

export interface DjStep {
  id: StepId
  /** Short name for the step control. */
  title: string
  /** One sentence saying what changed and what to look at. */
  detail: string
  /** The full (n + 1)-qubit state after this step. */
  state: StateVector
  /** The input register's signed amplitudes after this step. */
  amplitudes: number[]
}

/**
 * Every step of the circuit, as a list of states.
 *
 * X and H on the ancilla are one step ('ancilla'): splitting them would leave the
 * ancilla in |1⟩, whose ⟨0| column is empty, and the amplitude table would have
 * nothing to show. Physically nothing is skipped — both gates are applied.
 */
export function djSteps(n: number, spec: OracleSpec): DjStep[] {
  assertQubitCount(n)
  const table = truthTable(spec, n)
  const kindLabel = classify(table)
  const sv = new StateVector(n + 1)
  const anc = n
  const steps: DjStep[] = []

  const push = (id: StepId, title: string, detail: string): void => {
    steps.push({ id, title, detail, state: sv.clone(), amplitudes: registerAmplitudes(sv, n) })
  }

  push(
    'init',
    'Initialise',
    `All ${n + 1} qubits start in |0⟩. One amplitude is 1 and every other is 0.`
  )

  sv.applySingle('X', anc)
  sv.applySingle('H', anc)
  push(
    'ancilla',
    'Set up the kickback',
    'X then H puts the ancilla in |−⟩ = (|0⟩ − |1⟩)/√2. The input register has not moved.'
  )

  for (let j = 0; j < n; j++) sv.applySingle('H', j)
  push(
    'superpose',
    'Hadamard the input',
    `Every one of the ${1 << n} inputs now carries the same amplitude, +1/√${1 << n} ≈ ${(
      1 / Math.sqrt(1 << n)
    ).toFixed(3)}.`
  )

  applyOracle(sv, spec, n)
  push(
    'oracle',
    'Query the oracle — once',
    `The single call flips the sign of every x with f(x) = 1. Magnitudes are untouched, so a measurement here would still be uniform noise. This oracle is ${kindLabel}.`
  )

  for (let j = 0; j < n; j++) sv.applySingle('H', j)
  push(
    'interfere',
    'Hadamard again',
    'The second Hadamard layer turns that pattern of signs into interference. Read the surviving amplitude.'
  )

  return steps
}

/** Measurement probabilities over the input register (the ancilla is traced out). */
export function inputProbabilities(sv: StateVector, n: number): number[] {
  assertQubitCount(n)
  const dim = 1 << n
  return Array.from({ length: dim }, (_, x) => sv.probability(x) + sv.probability(x + dim))
}

/**
 * Deutsch–Jozsa's verdict: P(|0…0⟩) is 1 for a constant f and 0 for a balanced
 * one, with nothing in between — so one shot decides it.
 */
export function djVerdict(sv: StateVector, n: number): { pAllZero: number; reads: OracleClass } {
  const probs = inputProbabilities(sv, n)
  const pAllZero = probs[0]
  return { pAllZero, reads: pAllZero > 0.5 ? 'constant' : 'balanced' }
}

/** Bernstein–Vazirani's verdict: the most likely outcome is the hidden string. */
export function bvReadout(sv: StateVector, n: number): { s: number; probability: number } {
  const probs = inputProbabilities(sv, n)
  let best = 0
  for (let x = 1; x < probs.length; x++) if (probs[x] > probs[best]) best = x
  return { s: best, probability: probs[best] }
}

/**
 * Classical queries a DETERMINISTIC algorithm needs in the worst case to decide
 * constant vs balanced: 2^{n−1} + 1. Seeing half the inputs plus one agree is the
 * first moment the answer cannot still be balanced.
 *
 * (A randomised classical algorithm settles it in a handful of queries with high
 * probability — the exponential gap is against certainty, and the page says so.)
 */
export function djClassicalQueries(n: number): number {
  assertQubitCount(n)
  return 2 ** (n - 1) + 1
}

/** Classical queries to learn a hidden n-bit string: n, one per bit. */
export function bvClassicalQueries(n: number): number {
  assertQubitCount(n)
  return n
}

/** Both algorithms use exactly one oracle call, at any n. That is the headline. */
export const QUANTUM_QUERIES = 1

/** "1011" for s, MSB first, matching StateVector.label. */
export function bitString(x: number, n: number): string {
  return x.toString(2).padStart(n, '0')
}
