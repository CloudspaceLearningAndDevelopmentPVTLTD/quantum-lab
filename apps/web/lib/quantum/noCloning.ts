/**
 * lib/quantum/noCloning.ts — test any candidate cloning circuit.
 *
 * A candidate is a list of gates on three qubits: q0 carries the unknown
 * input |ψ⟩, q1 starts blank in |0⟩ and is supposed to end up as a copy, and
 * q2 is a spare ancilla the circuit may use however it likes. The circuit runs
 * on the wave-1 statevector engine (lib/quantum.ts), so any gate the
 * simulator knows is allowed.
 *
 * What is measured, for one input |ψ⟩:
 *   • joint clone fidelity  F₂ = ⟨ψψ| ρ_{q0 q1} |ψψ⟩ — did the pair come out as
 *     two copies?
 *   • per-output fidelity   F_q = ⟨ψ| ρ_q |ψ⟩ for q0 and q1 — how good is each
 *     copy on its own? (This is the figure of merit the 5/6 optimal-cloner
 *     bound refers to.)
 *
 * The linearity argument is made operational in `linearityPrediction`: the
 * circuit's output on any superposition a|0⟩ + b|1⟩ is a·U|0,00⟩ + b·U|1,00⟩,
 * assembled from the two basis outputs WITHOUT running the circuit on the
 * superposition. `noCloningVerdict` compares that prediction with the direct
 * run and reports whether the candidate survives a non-orthogonal test state.
 */

import {
  type Complex,
  type GateOp,
  StateVector,
  c,
  cAbs2,
  cMul,
} from '@/lib/quantum'
import {
  blochStateAmplitudes,
  fidelityWithPure,
  productState,
  reducedDensity,
} from './tomography'

export const CLONER_QUBITS = 3
export const INPUT_QUBIT = 0
export const COPY_QUBIT = 1
export const ANCILLA_QUBIT = 2

/** Run the candidate on |ψ⟩_q0 ⊗ |0⟩_q1 ⊗ |0⟩_q2. */
export function runCandidate(ops: readonly GateOp[], input: readonly [Complex, Complex]): StateVector {
  const sv = new StateVector(CLONER_QUBITS)
  // q0 is the LOW bit: amplitude index 0 = |q2 q1 q0⟩ = |000⟩, index 1 = |001⟩.
  sv.data.fill(0)
  sv.data[0] = input[0].re
  sv.data[1] = input[0].im
  sv.data[2] = input[1].re
  sv.data[3] = input[1].im
  for (const op of ops) sv.apply(op)
  return sv
}

export interface CloneReport {
  /** ⟨ψψ| ρ_{q0 q1} |ψψ⟩ */
  joint: number
  /** ⟨ψ| ρ_{q0} |ψ⟩ — the original after the circuit. */
  original: number
  /** ⟨ψ| ρ_{q1} |ψ⟩ — the would-be copy. */
  copy: number
}

export function cloneReportForState(sv: StateVector, input: readonly [Complex, Complex]): CloneReport {
  const pair = reducedDensity(sv, [INPUT_QUBIT, COPY_QUBIT])
  const q0 = reducedDensity(sv, [INPUT_QUBIT])
  const q1 = reducedDensity(sv, [COPY_QUBIT])
  return {
    joint: fidelityWithPure(pair, productState(input, input)),
    original: fidelityWithPure(q0, input),
    copy: fidelityWithPure(q1, input),
  }
}

export function cloneReport(ops: readonly GateOp[], input: readonly [Complex, Complex]): CloneReport {
  return cloneReportForState(runCandidate(ops, input), input)
}

/**
 * The output the circuit MUST produce on a|0⟩ + b|1⟩, obtained by superposing
 * its outputs on |0⟩ and |1⟩. Linearity of the evolution is the only
 * assumption; nothing about the circuit is used beyond those two runs.
 */
export function linearityPrediction(ops: readonly GateOp[], input: readonly [Complex, Complex]): StateVector {
  const out0 = runCandidate(ops, [c(1), c(0)])
  const out1 = runCandidate(ops, [c(0), c(1)])
  const sv = new StateVector(CLONER_QUBITS)
  sv.data.fill(0)
  for (let i = 0; i < sv.dim; i++) {
    const t0 = cMul(input[0], out0.amplitude(i))
    const t1 = cMul(input[1], out1.amplitude(i))
    sv.data[2 * i] = t0.re + t1.re
    sv.data[2 * i + 1] = t0.im + t1.im
  }
  return sv
}

/**
 * Closed-form ceiling for a machine that copies |0⟩ and |1⟩ perfectly, fed
 * cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩: the joint clone fidelity can be at most
 * (cos³(θ/2) + sin³(θ/2))². At θ = 90° that is exactly ½.
 */
export function perfectBasisClonerBound(theta: number): number {
  const a = Math.cos(theta / 2)
  const b = Math.sin(theta / 2)
  const s = Math.abs(a) ** 3 + Math.abs(b) ** 3
  return s * s
}

/** The Bužek–Hillery universal cloner's per-copy fidelity, for every input. */
export const UNIVERSAL_CLONER_FIDELITY = 5 / 6

export interface Verdict {
  /** Joint clone fidelity on |0⟩, |1⟩ and the test state. */
  f0: CloneReport
  f1: CloneReport
  test: CloneReport
  /** The linearity-assembled prediction for the test state. */
  predicted: CloneReport
  /** |⟨0|ψ_test⟩|² — how non-orthogonal the test state is to |0⟩. */
  overlapWithZero: number
  /** Largest disagreement between prediction and direct run (should be ~0). */
  linearityGap: number
  status: 'clones-basis-only' | 'fails-basis' | 'passes-all'
}

const PERFECT = 1 - 1e-6

/**
 * Run the three-input test. `theta`/`phi` pick the non-orthogonal probe state;
 * the page defaults to |+⟩. A status of 'passes-all' is impossible for a
 * unitary circuit and a probe that is neither |0⟩ nor |1⟩ — that is the
 * theorem — but the function checks rather than assumes it.
 */
export function noCloningVerdict(ops: readonly GateOp[], theta: number, phi = 0): Verdict {
  const probe = blochStateAmplitudes(theta, phi)
  const f0 = cloneReport(ops, [c(1), c(0)])
  const f1 = cloneReport(ops, [c(0), c(1)])
  const direct = runCandidate(ops, probe)
  const predictedState = linearityPrediction(ops, probe)
  const test = cloneReportForState(direct, probe)
  const predicted = cloneReportForState(predictedState, probe)
  let gap = 0
  for (let i = 0; i < direct.dim; i++) {
    const d = direct.amplitude(i)
    const p = predictedState.amplitude(i)
    gap = Math.max(gap, Math.sqrt(cAbs2(c(d.re - p.re, d.im - p.im))))
  }
  const basisOk = f0.joint >= PERFECT && f1.joint >= PERFECT
  const status: Verdict['status'] = !basisOk
    ? 'fails-basis'
    : test.joint >= PERFECT
      ? 'passes-all'
      : 'clones-basis-only'
  return {
    f0,
    f1,
    test,
    predicted,
    overlapWithZero: cAbs2(probe[0]),
    linearityGap: gap,
    status,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

export type CandidatePresetId = 'cnot' | 'swap' | 'buzek-hillery' | 'blank'

export interface CandidatePreset {
  id: CandidatePresetId
  label: string
  summary: string
  ops: GateOp[]
}

/**
 * Bužek–Hillery network (Bužek, Braunstein, Hillery & Bruß, PRA 56, 3446,
 * 1997). The ancilla pair (q1, q2) is prepared in
 *
 *     |Ψ⟩ = (2|00⟩ + |01⟩ + |11⟩)/√6     (written |q1 q2⟩)
 *
 * and then four CNOTs — q0→q1, q0→q2, q1→q0, q2→q0 — spread the input over
 * q0 and q1. The preparation state was obtained by pulling the known optimal
 * output for |0⟩, √(2/3)|00⟩|0⟩ + √(1/6)(|01⟩+|10⟩)|1⟩, back through the
 * (self-inverse) CNOT network and checking the same |Ψ⟩ serves |1⟩; the test
 * file verifies 5/6 on every input. Preparation from |00⟩:
 *   RY(α) on q1 with cos²(α/2) = 5/6,
 *   then a uniformly-controlled RY on q2 — RY(β) if q1 = 0 with
 *   cos(β/2) = 2/√5, RY(π) if q1 = 1 — decomposed as
 *   RY((β+π)/2) · CX · RY((β−π)/2) · CX.
 */
function buzekHilleryOps(): GateOp[] {
  const alpha = 2 * Math.acos(Math.sqrt(5 / 6))
  const beta = 2 * Math.acos(2 / Math.sqrt(5))
  return [
    { name: 'RY', qubits: [1], theta: alpha },
    { name: 'RY', qubits: [2], theta: (beta + Math.PI) / 2 },
    { name: 'CX', qubits: [1, 2] },
    { name: 'RY', qubits: [2], theta: (beta - Math.PI) / 2 },
    { name: 'CX', qubits: [1, 2] },
    { name: 'CX', qubits: [0, 1] },
    { name: 'CX', qubits: [0, 2] },
    { name: 'CX', qubits: [1, 0] },
    { name: 'CX', qubits: [2, 0] },
  ]
}

export const CANDIDATE_PRESETS: readonly CandidatePreset[] = [
  {
    id: 'cnot',
    label: 'CNOT copier',
    summary: 'One CNOT from the input onto the blank qubit. Copies |0⟩ and |1⟩ perfectly.',
    ops: [{ name: 'CX', qubits: [0, 1] }],
  },
  {
    id: 'swap',
    label: 'SWAP',
    summary: 'Moves the state to q1 and leaves |0⟩ behind. A move is not a copy.',
    ops: [{ name: 'SWAP', qubits: [0, 1] }],
  },
  {
    id: 'buzek-hillery',
    label: 'Bužek–Hillery 5/6',
    summary: 'The best universal cloner there is: every input comes out 5/6 right, twice.',
    ops: buzekHilleryOps(),
  },
  {
    id: 'blank',
    label: 'Blank',
    summary: 'Start from nothing and build your own.',
    ops: [],
  },
]
