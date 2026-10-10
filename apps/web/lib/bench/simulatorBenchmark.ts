/**
 * A real, honest correctness-and-performance benchmark for the statevector
 * simulator in `lib/quantum.ts`.
 *
 * "Every number is measured, not estimated" — so this file never hardcodes a
 * pretend deviation or a pretend timing. `correctnessSuite()` runs actual
 * circuits through `simulate()` and diffs the actual output against a
 * hand-derived exact closed-form state; `performanceSuite()` times actual
 * calls to `simulate()` with `performance.now()` (or `Date.now()` when
 * `performance` is unavailable — the only place in this file that clock or
 * fall back to a wall clock at all).
 *
 * Deviation metric: we use `stateFidelity` from `lib/workbench/verify.ts`,
 * turned into a deviation via `1 - fidelity`. `stateFidelity` is
 * phase-invariant (`|⟨target|actual⟩|²`), which is the right notion of
 * "the same physical state" — a simulator is free to return a state that
 * differs from the mathematically cleanest closed form by an unobservable
 * global phase, and comparing amplitudes directly would falsely flag that as
 * an error. All of our closed-form targets below are written with a definite,
 * standard phase convention anyway, so `1 - fidelity` and a raw amplitude
 * comparison agree to floating-point precision for every case here; fidelity
 * is used because it is the metric that stays correct even if that were not
 * true.
 */

import { simulate, type Circuit, type Complex, PRESETS } from '@/lib/quantum'
import { stateFidelity } from '@/lib/workbench/verify'

// ────────────────────────────────────────────────────────────
// Correctness
// ────────────────────────────────────────────────────────────

export interface CorrectnessResult {
  name: string
  maxDeviation: number
  passed: boolean
}

/** True when the reported deviation is small enough to trust the engine. */
const CORRECTNESS_THRESHOLD = 1e-9

const SQRT1_2 = Math.SQRT1_2

function real(re: number): Complex {
  return { re, im: 0 }
}

/** Zero everywhere except the given amplitude at `index`, for a `dim`-size state. */
function basisAmplitudes(dim: number, entries: Record<number, number>): Complex[] {
  const out: Complex[] = Array.from({ length: dim }, () => real(0))
  for (const [i, amp] of Object.entries(entries)) out[Number(i)] = real(amp)
  return out
}

/** A GHZ-N circuit: H on qubit 0, then a CX ladder entangling every other qubit to it. */
function ghzCircuit(n: number): Circuit {
  const ops: Circuit['ops'] = [{ name: 'H', qubits: [0] }]
  for (let q = 0; q < n - 1; q++) ops.push({ name: 'CX', qubits: [q, q + 1] })
  return { numQubits: n, ops }
}

/** The exact GHZ-N state: 1/√2 on |00…0⟩ and |11…1⟩, zero elsewhere. */
function ghzTarget(n: number): Complex[] {
  const dim = 1 << n
  return basisAmplitudes(dim, { 0: SQRT1_2, [dim - 1]: SQRT1_2 })
}

/**
 * QFT of the all-zero computational-basis state.
 *
 * QFT|j⟩ = (1/√N) Σ_k e^{2πi jk/N} |k⟩. For j = 0 every exponent is e^0 = 1,
 * so QFT|0⟩ = (1/√N) Σ_k |k⟩ — the exact uniform superposition, real and
 * positive on every basis state, independent of N. (This is specific to the
 * all-zero input: QFT of a *different* computational-basis state would carry
 * a nontrivial phase on each |k⟩; we picked the all-zero input because it
 * gives the cleanest closed form to check against.)
 */
function qftUniformTarget(n: number): Complex[] {
  const dim = 1 << n
  const amp = 1 / Math.sqrt(dim)
  return Array.from({ length: dim }, () => real(amp))
}

function deviation(target: Complex[], actual: Complex[]): number {
  return 1 - stateFidelity(target, actual)
}

function groverPresetCircuit(): Circuit {
  const preset = PRESETS.find((p) => p.id === 'grover2')
  if (!preset) throw new Error("simulatorBenchmark expects a 'grover2' preset in PRESETS")
  return preset.circuit
}

/**
 * Circuits with an exact, hand-derivable closed-form final state, each paired
 * with the actual measured deviation between that closed form and what
 * `simulate()` returns.
 */
export function correctnessSuite(): CorrectnessResult[] {
  const cases: { name: string; circuit: Circuit; target: Complex[] }[] = [
    {
      name: 'Bell state (H, CX)',
      circuit: { numQubits: 2, ops: [{ name: 'H', qubits: [0] }, { name: 'CX', qubits: [0, 1] }] },
      target: basisAmplitudes(4, { 0: SQRT1_2, 3: SQRT1_2 }),
    },
    {
      name: 'GHZ-3 (H, CX, CX)',
      circuit: ghzCircuit(3),
      target: ghzTarget(3),
    },
    {
      name: 'GHZ-5 (H, CX×4)',
      circuit: ghzCircuit(5),
      target: ghzTarget(5),
    },
    {
      name: '4-qubit QFT of |0000⟩ (exact uniform superposition)',
      circuit: { numQubits: 4, ops: [{ name: 'QFT', qubits: [0, 1, 2, 3] }] },
      target: qftUniformTarget(4),
    },
    {
      name: "Grover 2-qubit search (grover2 preset, marks |11⟩)",
      circuit: groverPresetCircuit(),
      // quantum.test.ts's "known algorithms" suite asserts this same preset
      // lands on |11⟩ with certainty; the exact state is |11⟩ up to an
      // unobservable global phase, which is exactly what stateFidelity checks.
      target: basisAmplitudes(4, { 3: 1 }),
    },
  ]

  return cases.map(({ name, circuit, target }) => {
    const actual = simulate(circuit).amplitudes()
    const maxDeviation = deviation(target, actual)
    return { name, maxDeviation, passed: maxDeviation < CORRECTNESS_THRESHOLD }
  })
}

// ────────────────────────────────────────────────────────────
// Performance
// ────────────────────────────────────────────────────────────

export interface PerformanceResult {
  qubits: number
  gates: number
  ms: number
  gatesPerSecond: number
}

/** Layers per qubit count in the synthetic benchmark circuit — fixed and stated. */
const LAYERS = 4

/**
 * A synthetic circuit of fixed, stated gate density: `LAYERS` repetitions of
 * (one H per qubit, then a CX ladder over adjacent qubits). Total gate count
 * is therefore `LAYERS * (numQubits + (numQubits - 1))`, which scales
 * predictably with qubit count so the reported gates/sec numbers are
 * comparable across sizes.
 */
function syntheticCircuit(numQubits: number): Circuit {
  const ops: Circuit['ops'] = []
  for (let layer = 0; layer < LAYERS; layer++) {
    for (let q = 0; q < numQubits; q++) ops.push({ name: 'H', qubits: [q] })
    for (let q = 0; q < numQubits - 1; q++) ops.push({ name: 'CX', qubits: [q, q + 1] })
  }
  return { numQubits, ops }
}

/**
 * The only wall-clock reads in this file. `performance.now()` is preferred
 * (sub-millisecond, monotonic); `Date.now()` is a fallback for a non-browser
 * test process where `performance` may not be defined.
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Times `simulate()` on a synthetic circuit for each qubit count from 4 up to
 * `maxQubits`. Every `ms` and `gatesPerSecond` value is measured on whatever
 * machine calls this — nothing here is precomputed or estimated.
 */
export function performanceSuite(maxQubits = 16): PerformanceResult[] {
  const results: PerformanceResult[] = []
  for (let qubits = 4; qubits <= maxQubits; qubits++) {
    const circuit = syntheticCircuit(qubits)
    const gates = circuit.ops.length
    const start = now()
    simulate(circuit)
    const elapsed = now() - start
    const ms = Math.max(elapsed, 0)
    // A run can measure 0ms on a fast machine with a coarse clock; guard the
    // division so gatesPerSecond stays a finite, honest number rather than
    // Infinity or a divide-by-zero artifact.
    const seconds = Math.max(ms, 1e-3) / 1000
    results.push({ qubits, gates, ms, gatesPerSecond: gates / seconds })
  }
  return results
}
