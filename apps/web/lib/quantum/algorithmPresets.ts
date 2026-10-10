/**
 * algorithmPresets.ts — the textbook oracle algorithms: Deutsch-Jozsa,
 * Bernstein-Vazirani, Simon, quantum phase estimation, a VQE ansatz, and a
 * QAOA MaxCut ansatz.
 *
 * Every circuit here is built by a small helper function rather than typed
 * out op-by-op, and every preset is checked in algorithmPresets.test.ts
 * against a hand-derived closed-form result — never "it runs without
 * throwing". See that file's header for what each one proves.
 *
 * HHL (A = diag(1,3), b = |+⟩, t = π/2) is included: its uncompute step was
 * hand-derived as an exact isometry (see the doc comment on buildHHL below
 * and the HHL describe block in algorithmPresets.test.ts) before being
 * coded, and the numeric run matches that derivation to float precision —
 * see HHL_SHIPPED below.
 */

import type { Circuit, GateOp, Preset } from '../quantum'

// ────────────────────────────────────────────────────────────
// Small shared helpers
// ────────────────────────────────────────────────────────────

/** H on every qubit in `qubits`, in order. */
function hadamardAll(qubits: readonly number[]): GateOp[] {
  return qubits.map((q): GateOp => ({ name: 'H', qubits: [q] }))
}

/**
 * MEASURE every qubit in `qubits` into consecutive classical bits starting at
 * `clbitStart` (default 0) — qubits[i] writes clbit `clbitStart + i`. Every
 * oracle-algorithm preset below reads its input register out this way so
 * outcomeBranches() can be checked against the literal bit string, not just
 * "some deterministic outcome".
 */
function measureAll(qubits: readonly number[], clbitStart = 0): GateOp[] {
  return qubits.map((q, i): GateOp => ({ name: 'MEASURE', qubits: [q], clbit: clbitStart + i }))
}

// ────────────────────────────────────────────────────────────
// 1. Deutsch-Jozsa — 3 input qubits (q0, q1, q2) + 1 ancilla (q3)
// ────────────────────────────────────────────────────────────

/**
 * Builds the Deutsch-Jozsa circuit for either oracle.
 *
 * Constant oracle f(x) = 0 for every x: the oracle is a no-op (a CX onto an
 * ancilla that is never flipped is exactly "no phase kickback at all").
 * Balanced oracle f(x) = parity(x) = x0 ⊕ x1 ⊕ x2: CX from every input qubit
 * to the ancilla, so the ancilla accumulates the parity and (once the ancilla
 * sits in |−⟩) each input qubit picks up a (−1)^{x_i} phase kick.
 */
function buildDeutschJozsa(oracle: 'constant' | 'balanced'): Circuit {
  const inputs = [0, 1, 2]
  const ancilla = 3
  const ops: GateOp[] = [
    { name: 'X', qubits: [ancilla] },
    ...hadamardAll([...inputs, ancilla]),
    ...(oracle === 'balanced' ? inputs.map((q): GateOp => ({ name: 'CX', qubits: [q, ancilla] })) : []),
    ...hadamardAll(inputs),
    ...measureAll(inputs),
  ]
  return { numQubits: 4, numClbits: 3, ops }
}

// ────────────────────────────────────────────────────────────
// 2. Bernstein-Vazirani — 3 input qubits (q0, q1, q2) + 1 ancilla (q3)
// ────────────────────────────────────────────────────────────

/**
 * Hidden bit string s, s[i] read at qubit index i (s[0] is the bit the LSB
 * input qubit carries). The oracle is CX from input qubit i to the ancilla
 * for every i where s[i] = 1 — the "dot product mod 2" oracle f(x) = s·x.
 */
function buildBernsteinVazirani(secret: readonly (0 | 1)[]): Circuit {
  const inputs = secret.map((_, i) => i)
  const ancilla = inputs.length
  const ops: GateOp[] = [
    { name: 'X', qubits: [ancilla] },
    { name: 'H', qubits: [ancilla] },
    ...hadamardAll(inputs),
    ...secret.flatMap((bit, i): GateOp[] => (bit === 1 ? [{ name: 'CX', qubits: [i, ancilla] }] : [])),
    ...hadamardAll(inputs),
    ...measureAll(inputs),
  ]
  return { numQubits: inputs.length + 1, numClbits: inputs.length, ops }
}

/** Hidden string for the shipped preset: s = 101, i.e. s0=1, s1=0, s2=1. */
export const BERNSTEIN_VAZIRANI_SECRET: readonly (0 | 1)[] = [1, 0, 1]

// ────────────────────────────────────────────────────────────
// 3. Simon's algorithm — 2 input qubits (q0, q1) + 2 output qubits (q2, q3)
// ────────────────────────────────────────────────────────────

/**
 * The oracle: f(x0, x1) = x0 ⊕ x1, written onto output qubit q2 only (q3
 * stays |0⟩ always). By hand: f(00)=0, f(01)=1, f(10)=1, f(11)=0 — i.e.
 * f(00)=f(11)=00 and f(01)=f(10)=01 exactly as the spec's worked example
 * calls for, and it is 2-to-1 with f(x) = f(x ⊕ s) for the secret s = 11
 * (flipping both input bits leaves an XOR of two bits unchanged: NOT a ⊕ NOT
 * b = a ⊕ b). algorithmPresets.test.ts simulates this oracle alone on all 4
 * computational-basis inputs before trusting the rest of the circuit.
 */
function simonOracleOps(): GateOp[] {
  return [
    { name: 'CX', qubits: [0, 2] },
    { name: 'CX', qubits: [1, 2] },
  ]
}

/** Secret string for the shipped preset: s = 11 (both bits set). */
export const SIMON_SECRET: readonly (0 | 1)[] = [1, 1]

function buildSimon(): Circuit {
  const inputs = [0, 1]
  const ops: GateOp[] = [
    ...hadamardAll(inputs),
    ...simonOracleOps(),
    ...hadamardAll(inputs),
    ...measureAll(inputs),
  ]
  return { numQubits: 4, numClbits: 2, ops }
}

// ────────────────────────────────────────────────────────────
// 4. Quantum phase estimation — 2 ancilla (q0 = LSB, q1 = MSB) + 1 target (q2)
// ────────────────────────────────────────────────────────────

/**
 * theta chosen so theta/(2π) is EXACTLY the 2-bit binary fraction 3/4 —
 * see the file header and algorithmPresets.test.ts for why that makes the
 * outcome perfectly sharp rather than approximate.
 */
export const QPE_THETA = (3 * Math.PI) / 2

/**
 * Controlled-P(theta · 2^j) from ancilla qubit `control` onto `target`, built
 * with the engine's generic `extraControls` field (a Z-basis, non-anti
 * control by default — exactly "fires when the control reads |1⟩").
 */
function controlledPhaseOp(theta: number, control: number, target: number): GateOp {
  return { name: 'P', qubits: [target], theta, extraControls: [{ qubit: control }] }
}

/**
 * register[0] is qubit 0 (the LEAST significant register qubit) throughout
 * this engine — see splitBlockOperands's doc comment and gates-extended.ts's
 * header ("Registers are listed least-significant qubit FIRST"), and the
 * already-shipped Shor preset in gates-extended.ts, which controls the a^1
 * power from counting[0] and feeds IQFT the SAME qubit order. QPE here
 * follows the identical convention: q0 (bit position 0 of the register)
 * controls the 2^0 power of the phase, q1 (bit position 1) controls 2^1, and
 * IQFT is handed the register in that same [q0, q1] order.
 */
function buildPhaseEstimation(): Circuit {
  const [a0, a1] = [0, 1]
  const target = 2
  const ops: GateOp[] = [
    { name: 'X', qubits: [target] },
    { name: 'H', qubits: [a0] },
    { name: 'H', qubits: [a1] },
    controlledPhaseOp(QPE_THETA * 1, a0, target),
    controlledPhaseOp(QPE_THETA * 2, a1, target),
    { name: 'IQFT', qubits: [a0, a1] },
    ...measureAll([a0, a1]),
  ]
  return { numQubits: 3, numClbits: 2, ops }
}

// ────────────────────────────────────────────────────────────
// 5. HHL — attempted, and shipped once its uncompute + postselection was
//    verified to reproduce the closed-form target to float precision.
// ────────────────────────────────────────────────────────────

/**
 * A = diag(1, 3) on the system qubit q2, so e^{iAt} for a given power p is
 * exactly the diagonal unitary diag(e^{i·1·p}, e^{i·3·p}) — computed directly
 * via Math.cos/Math.sin, no eigendecomposition, no approximation. Built as a
 * 1-qubit UNITARY (op.matrix, row-major) so it can carry `extraControls`.
 * `conjugate` negates the exponents for the uncompute step's inverse.
 */
function diagonalEvolutionOp(power: number, control: number, target: number, conjugate = false): GateOp {
  const sign = conjugate ? -1 : 1
  const a1 = sign * 1 * power
  const a3 = sign * 3 * power
  return {
    name: 'UNITARY',
    qubits: [target],
    matrix: [
      { re: Math.cos(a1), im: Math.sin(a1) }, { re: 0, im: 0 },
      { re: 0, im: 0 }, { re: Math.cos(a3), im: Math.sin(a3) },
    ],
    label: conjugate ? 'e^{-iAt·2^j}' : 'e^{iAt·2^j}',
    extraControls: [{ qubit: control }],
  }
}

/** Evolution time for the worked example: t = π/2, chosen so both eigenphases are exact 2-bit dyadic fractions (1/4 and 3/4). */
export const HHL_TIME = Math.PI / 2
/** Normalization constant for the controlled rotations, C = 1 (the largest value satisfying 0 < C ≤ min(1, 3)). */
export const HHL_C = 1

/**
 * Qubits: q0, q1 = QPE ancilla register (q0 = LSB, same convention as
 * buildPhaseEstimation above); q2 = system qubit (b = |+⟩, A = diag(1, 3));
 * q3 = HHL rotation ancilla, postselected to 1.
 *
 * The controlled rotations in step 5 condition on the QPE register reading
 * EXACTLY k=1 (eigenvalue 1, phase 1/4 → q0=1, q1=0 — an anti-control, since
 * q1 must read 0) or EXACTLY k=3 (eigenvalue 3, phase 3/4 → q0=1, q1=1, both
 * positive controls) — same [q0, q1] = [LSB, MSB] convention as the QPE
 * register above, so a k=1/k=3 mixup here would show up as exactly the wrong
 * fidelity in the test, not a crash.
 */
function buildHHL(): Circuit {
  const [a0, a1] = [0, 1]
  const system = 2
  const hhlAncilla = 3
  const t = HHL_TIME
  const ops: GateOp[] = [
    { name: 'H', qubits: [system] }, // b = |+>
    { name: 'H', qubits: [a0] },
    { name: 'H', qubits: [a1] },
    diagonalEvolutionOp(t * 1, a0, system),
    diagonalEvolutionOp(t * 2, a1, system),
    { name: 'IQFT', qubits: [a0, a1] },
    // k = 1 branch: q0=1 (positive), q1=0 (anti) -> angle 2*asin(C/1)
    {
      name: 'RY', qubits: [hhlAncilla], theta: 2 * Math.asin(HHL_C / 1),
      extraControls: [{ qubit: a0 }, { qubit: a1, anti: true }],
    },
    // k = 3 branch: q0=1, q1=1 (both positive) -> angle 2*asin(C/3)
    {
      name: 'RY', qubits: [hhlAncilla], theta: 2 * Math.asin(HHL_C / 3),
      extraControls: [{ qubit: a0 }, { qubit: a1 }],
    },
    // Uncompute the QPE register.
    { name: 'QFT', qubits: [a0, a1] },
    diagonalEvolutionOp(t * 2, a1, system, true),
    diagonalEvolutionOp(t * 1, a0, system, true),
    { name: 'H', qubits: [a0] },
    { name: 'H', qubits: [a1] },
    { name: 'POSTSELECT', qubits: [hhlAncilla], postselectValue: 1 },
  ]
  return { numQubits: 4, ops }
}

/**
 * Shipped after a hand derivation (walked through in
 * algorithmPresets.test.ts's HHL describe block) showed the uncompute is an
 * exact isometry V with V|00⟩_{q0q1}|b⟩_{q2} = |k_b⟩_{q0q1}|b⟩_{q2} for each
 * eigenvector b — so V⁻¹ returns q0,q1 to |00⟩ regardless of what the
 * rotation on q3 did — and the postselected q2 amplitudes came out to EXACTLY
 * [3/√10, 1/√10], the closed-form A⁻¹b target, when run through the engine.
 * See the test file for the measured fidelity.
 */
export const HHL_SHIPPED = true

// ────────────────────────────────────────────────────────────
// 6. VQE hardware-efficient ansatz (n=2, 1 layer, illustrative fixed angles)
// ────────────────────────────────────────────────────────────

/**
 * Per layer: RY(theta) then RZ(theta) on every qubit, then a CX entangling
 * ladder. This is a TEMPLATE — the angles are illustrative, not the result of
 * optimizing against any Hamiltonian — so "correctness" here means
 * well-formed structure (normalized, genuinely entangled), not solving a
 * particular problem. Angles are deliberately non-uniform across qubits and
 * gate types so the result is not an accidental product state.
 */
const VQE_RY_ANGLES = [Math.PI / 3, Math.PI / 5]
const VQE_RZ_ANGLES = [Math.PI / 7, Math.PI / 11]

function buildVqeAnsatz(): Circuit {
  const qubits = [0, 1]
  const ops: GateOp[] = [
    ...qubits.map((q): GateOp => ({ name: 'RY', qubits: [q], theta: VQE_RY_ANGLES[q] })),
    ...qubits.map((q): GateOp => ({ name: 'RZ', qubits: [q], theta: VQE_RZ_ANGLES[q] })),
    { name: 'CX', qubits: [0, 1] },
  ]
  return { numQubits: 2, ops }
}

// ────────────────────────────────────────────────────────────
// 7. QAOA MaxCut ansatz on a 4-cycle (4 qubits, 1 layer)
// ────────────────────────────────────────────────────────────

export const QAOA_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
]
/**
 * gamma=pi/4 (the spec's suggested illustrative angle) turns out to be a
 * DEGENERATE point for a 4-cycle at p=1: cos(2*gamma) = cos(pi/2) = 0, which
 * — algorithmPresets.test.ts's numeric scan confirms this by hand — zeroes
 * every edge's cost correlation for EVERY beta, so the weighted cost
 * expectation lands exactly on the uniform baseline (2.0) no matter what.
 * That is a real fact about this graph and this gamma, not a bug, but it
 * fails the "measurably different from uniform" requirement by construction
 * — so gamma=pi/8 is used instead, which is not a degenerate point.
 */
export const QAOA_GAMMA = Math.PI / 8
export const QAOA_BETA = Math.PI / 6

/**
 * The ZZ cost unitary for edge (i, j): e^{-iγ·Z_i⊗Z_j}, synthesized as
 * CX(i,j); RZ(2γ) on j; CX(i,j) — algorithmPresets.test.ts verifies this
 * identity against the direct diagonal matrix diag(e^{-iγ}, e^{iγ}, e^{iγ},
 * e^{-iγ}) BEFORE this function is trusted for the full circuit below.
 */
function costEdgeOps(i: number, j: number, gamma: number): GateOp[] {
  return [
    { name: 'CX', qubits: [i, j] },
    { name: 'RZ', qubits: [j], theta: 2 * gamma },
    { name: 'CX', qubits: [i, j] },
  ]
}

function buildQaoaMaxCut4Cycle(): Circuit {
  const qubits = [0, 1, 2, 3]
  const ops: GateOp[] = [
    ...hadamardAll(qubits),
    ...QAOA_EDGES.flatMap(([i, j]) => costEdgeOps(i, j, QAOA_GAMMA)),
    ...qubits.map((q): GateOp => ({ name: 'RX', qubits: [q], theta: 2 * QAOA_BETA })),
  ]
  return { numQubits: 4, ops }
}

// ────────────────────────────────────────────────────────────
// Exported presets
// ────────────────────────────────────────────────────────────

export const ALGORITHM_PRESETS: Preset[] = [
  {
    id: 'deutsch-jozsa-constant',
    name: 'Deutsch-Jozsa (constant oracle)',
    blurb:
      'One query settles f(x)=0 for all 8 inputs — impossible classically without checking every ' +
      'input. The oracle is a no-op, so the interference leaves the 3 input qubits at |000⟩ every time.',
    circuit: buildDeutschJozsa('constant'),
  },
  {
    id: 'deutsch-jozsa-balanced',
    name: 'Deutsch-Jozsa (balanced oracle)',
    blurb:
      'Same one query, but f(x) = parity(x) is balanced (0 for half the inputs, 1 for the other half). ' +
      'The input qubits never read |000⟩ — the phase kickback from the parity oracle rules it out exactly.',
    circuit: buildDeutschJozsa('balanced'),
  },
  {
    id: 'bernstein-vazirani',
    name: 'Bernstein-Vazirani (hidden string 101)',
    blurb:
      'One query recovers the entire 3-bit hidden string s=101 — n queries classically, one here. ' +
      'The input register reads exactly s, every single time.',
    circuit: buildBernsteinVazirani(BERNSTEIN_VAZIRANI_SECRET),
  },
  {
    id: 'simon',
    name: "Simon's Algorithm (secret string 11)",
    blurb:
      'A genuinely 2-to-1 oracle (f(x)=f(x⊕s) for secret s=11) leaves every measured y orthogonal to s ' +
      '— y·s = 0 mod 2 on every single run, the guarantee that lets repeated runs solve for s by linear algebra.',
    circuit: buildSimon(),
  },
  {
    id: 'phase-estimation',
    name: 'Quantum Phase Estimation (exact 2-bit example)',
    blurb:
      'θ = 3π/2 is chosen so θ/2π = 3/4 is an EXACT 2-bit binary fraction — the 2-qubit ancilla register ' +
      'reads the integer 3 with probability 1, no spread, because the phase has no bits past the 2nd.',
    circuit: buildPhaseEstimation(),
  },
  {
    id: 'hhl',
    name: 'HHL (A = diag(1,3), exact worked example)',
    blurb:
      'Solves Ax=b for the diagonal A=diag(1,3), b=|+⟩ by quantum phase estimation, a controlled rotation, ' +
      'uncomputation, and postselection — the system qubit lands on (3|0⟩+|1⟩)/√10, the exact classical ' +
      'answer A⁻¹b, to float precision. Every phase in this worked example is an exact dyadic fraction.',
    circuit: buildHHL(),
  },
  {
    id: 'vqe-ansatz',
    name: 'VQE Hardware-Efficient Ansatz (2 qubits, 1 layer)',
    blurb:
      'RY then RZ on every qubit, then a CX ladder — the template a variational eigensolver optimizes ' +
      'over. These angles are illustrative, not fit to any Hamiltonian, but the ansatz genuinely entangles.',
    circuit: buildVqeAnsatz(),
  },
  {
    id: 'qaoa-maxcut-4cycle',
    name: 'QAOA MaxCut Ansatz (4-cycle graph, 1 layer)',
    blurb:
      'The cost unitary (CX–RZ–CX per edge) and mixer (RX on every qubit) for MaxCut on a 4-node cycle, ' +
      'at illustrative angles γ=π/8, β=π/6 — a single QAOA layer measurably biases the distribution away ' +
      'from uniform, toward cuts the cost function favors.',
    circuit: buildQaoaMaxCut4Cycle(),
  },
]

// Exposed for algorithmPresets.test.ts, which re-derives and checks every
// closed-form claim above rather than trusting these comments.
export const _internal = {
  buildDeutschJozsa,
  buildBernsteinVazirani,
  buildSimon,
  simonOracleOps,
  buildPhaseEstimation,
  controlledPhaseOp,
  buildHHL,
  diagonalEvolutionOp,
  buildVqeAnsatz,
  buildQaoaMaxCut4Cycle,
  costEdgeOps,
}
