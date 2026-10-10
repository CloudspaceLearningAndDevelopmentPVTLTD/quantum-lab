/**
 * hhl.ts — the HHL quantum linear-systems algorithm on the real statevector engine.
 *
 * HHL solves Ax = b for a Hermitian A, producing a STATE proportional to the
 * solution x — not a classical read-out of x. That distinction is the whole
 * point of the algorithm and the thing this module exists to get exactly
 * right, the same way phaseEstimation.ts exists to get QPE exactly right.
 *
 * ── The demo matrix ──
 *
 * A is restricted to the form A = c0·I + c1·X (real, symmetric, so Hermitian;
 * equal diagonal entries by construction). That is a genuine restriction —
 * not every 2×2 Hermitian matrix looks like this — but it buys something
 * essential for a *verifiable* demo: X's eigenbasis is |+⟩/|−⟩, so
 * e^{iAt} = e^{ic0t} · e^{ic1tX} is exactly e^{ic0t} times an RX rotation
 * (see `evolutionGates` below), which this engine already has as a named
 * gate. No matrix exponential is approximated anywhere in this file.
 *
 * `t` (the evolution time) is chosen so 2^CLOCK_QUBITS·λ/(2π)·t lands exactly
 * on the clock register's grid for both eigenvalues of A — see the comment
 * on EVOLUTION_TIME — so phase estimation resolves them with ZERO error
 * using only 2 clock qubits. That is what makes an exact numeric check
 * possible with a tiny circuit.
 *
 * `b`, A's eigendecomposition, and the classical solve are all computed by
 * generic 2×2 linear algebra below rather than typed in as literals, so the
 * "verified against a classical solve" claim is checked by running actual
 * code, not asserted by a comment.
 *
 * Register layout (qubit 0 is the LSB, matching lib/quantum.ts):
 *   qubits 0..CLOCK_QUBITS-1   clock/phase register, qubit j = bit j of y
 *   qubit  CLOCK_QUBITS        state register — holds |b⟩, then (on ancilla
 *                              success) an unnormalized |x⟩
 *   qubit  CLOCK_QUBITS + 1    ancilla — the rotation writes 1/λ into its
 *                              amplitude; reading it as |1⟩ heralds success
 *
 * hhl.test.ts checks the post-ancilla-success state register against a
 * classical Ax = b solve to floating-point precision. If that check ever
 * fails, this file is wrong and the page must not ship.
 */

import { StateVector } from '@/lib/quantum'
import { applyQft, applyInverseQft } from './phaseEstimation'

// ────────────────────────────────────────────────────────────
// The demo problem
// ────────────────────────────────────────────────────────────

/** Real symmetric 2×2 matrix [[a, b], [b, d]] — Hermitian because it's real symmetric. */
export interface Sym2x2 {
  a: number
  b: number
  d: number
}

export const CLOCK_QUBITS = 2
export const STATE_QUBIT = CLOCK_QUBITS
export const ANCILLA_QUBIT = CLOCK_QUBITS + 1
export const TOTAL_QUBITS = CLOCK_QUBITS + 2
export const CLOCK_DIM = 1 << CLOCK_QUBITS

/**
 * A = 1.5·I + 0.5·X = [[1.5, 0.5], [0.5, 1.5]]. Eigenvalues 1 and 2 (condition
 * number 2 — well conditioned), eigenvectors |−⟩ and |+⟩.
 *
 * Chosen so that with EVOLUTION_TIME below, both eigenvalues land EXACTLY on
 * the 2-bit clock grid: λ=1 → y=1 (0.25 of a turn), λ=2 → y=2 (0.5 of a turn).
 * No other small integer pair does this with only 2 clock qubits while also
 * keeping both eigenvalues positive and neither equal to zero (a zero
 * eigenvalue is indistinguishable from "no phase kicked back at all", which
 * would make the demo ambiguous about what QPE actually measured).
 */
export const MATRIX_A: Sym2x2 = { a: 1.5, b: 0.5, d: 1.5 }

/** b = |0⟩. Decomposes into BOTH eigenvectors of A, so the demo genuinely exercises superposition across eigencomponents. */
export const VECTOR_B: readonly [number, number] = [1, 0]

/**
 * Evolution time. With CLOCK_QUBITS = 2 (grid spacing 2π/4), this maps
 * eigenvalue λ to clock reading y = λ (see `eigenvalueForClockValue`), which
 * is what makes the numbers in the walkthrough legible: the register you
 * read out for an eigenvalue is that eigenvalue.
 */
export const EVOLUTION_TIME = Math.PI / 2

/**
 * The rotation constant C in sin(θ/2) = C/λ. Set to the smallest eigenvalue
 * A actually has (1), which is the largest value C can take without any
 * branch needing sin(θ/2) > 1 — and therefore the choice that maximizes this
 * demo's overall success probability. It is a genuine dial in real HHL: a
 * smaller C still works but succeeds less often; C larger than λ_min is not
 * implementable, because arcsin has no solution for an argument above 1.
 */
export const C_CONST = 1

// ────────────────────────────────────────────────────────────
// Generic real 2×2 linear algebra — computed, not hand-typed
// ────────────────────────────────────────────────────────────

/** Solve M x = rhs for a real symmetric 2×2 M via Cramer's rule. Throws if M is singular. */
export function solveSym2x2(m: Sym2x2, rhs: readonly [number, number]): [number, number] {
  const det = m.a * m.d - m.b * m.b
  if (Math.abs(det) < 1e-12) throw new Error(`matrix is singular (det = ${det})`)
  const [b0, b1] = rhs
  return [(m.d * b0 - m.b * b1) / det, (-m.b * b0 + m.a * b1) / det]
}

export interface EigenPair {
  value: number
  /** Unit vector, real. */
  vector: [number, number]
}

/**
 * Eigendecomposition of a real symmetric 2×2 matrix, by the closed form
 * λ± = (a+d)/2 ± √(((a−d)/2)² + b²). Independent of the A/b constants above —
 * this is the same formula for any symmetric 2×2 input, which is what makes
 * it a check rather than a restatement of MATRIX_A.
 */
export function eigenSym2x2(m: Sym2x2): [EigenPair, EigenPair] {
  const mid = (m.a + m.d) / 2
  const r = Math.sqrt(((m.a - m.d) / 2) ** 2 + m.b ** 2)
  const values: [number, number] = [mid + r, mid - r]
  return values.map((value): EigenPair => {
    // Eigenvector solves (M - value·I) v = 0. (value − d, b) works whenever
    // b ≠ 0; MATRIX_A has b = 0.5, so this is always the live branch here.
    let vx = value - m.d
    let vy = m.b
    if (Math.abs(vy) < 1e-12 && Math.abs(vx) < 1e-12) {
      // b == 0: M is already diagonal and the standard basis vectors are the
      // eigenvectors. Kept for completeness — MATRIX_A never reaches this.
      vx = 1
      vy = 0
    }
    const norm = Math.hypot(vx, vy)
    return { value, vector: [vx / norm, vy / norm] }
  }) as [EigenPair, EigenPair]
}

/** x = A⁻¹b, the classical answer this page's quantum state is checked against. */
export function classicalSolve(m: Sym2x2 = MATRIX_A, rhs: readonly [number, number] = VECTOR_B): [number, number] {
  return solveSym2x2(m, rhs)
}

/** x normalized to a unit vector — the same normalization a statevector carries. */
export function normalize2(v: readonly [number, number]): [number, number] {
  const norm = Math.hypot(v[0], v[1])
  if (norm < 1e-15) throw new Error('cannot normalize a zero vector')
  return [v[0] / norm, v[1] / norm]
}

// ────────────────────────────────────────────────────────────
// The eigenvalue ↔ clock-reading map
// ────────────────────────────────────────────────────────────

/**
 * The eigenvalue that clock reading y decodes to, given EVOLUTION_TIME and
 * CLOCK_QUBITS: QPE measures φ = y/2^t as an estimate of λt/(2π), so
 * λ = 2π·y / (t · 2^CLOCK_QUBITS). With EVOLUTION_TIME = π/2 and 2^t = 4 this
 * reduces to λ = y — the grid is built so the clock reading IS the eigenvalue.
 */
export function eigenvalueForClockValue(y: number): number {
  return (2 * Math.PI * y) / (EVOLUTION_TIME * CLOCK_DIM)
}

/**
 * The controlled-rotation angle for eigenvalue λ: sin(θ/2) = C/λ, so
 * θ = 2·asin(C/λ). Returns 0 (no rotation — this branch cannot herald
 * success) for λ = 0 or |C/λ| > 1, both real limitations of the fixed-C
 * rotation, not bugs: a genuinely tiny eigenvalue needs a smaller C than one
 * that also has to serve the largest eigenvalue in the same circuit.
 */
export function rotationAngle(lambda: number, c = C_CONST): number {
  if (!(Math.abs(lambda) > 1e-12)) return 0
  const ratio = c / lambda
  if (Math.abs(ratio) > 1) return 0
  return 2 * Math.asin(ratio)
}

/** The clock reading that decodes to eigenvalue `lambda` exactly, or null if none does. */
export function clockReadingForEigenvalue(lambda: number): number | null {
  for (let y = 0; y < CLOCK_DIM; y++) {
    if (Math.abs(eigenvalueForClockValue(y) - lambda) < 1e-9) return y
  }
  return null
}

// ────────────────────────────────────────────────────────────
// Circuit primitives
// ────────────────────────────────────────────────────────────

/**
 * Prepare a real, normalized 2-vector on one qubit with a single RY: since
 * RY(θ)|0⟩ = (cos(θ/2), sin(θ/2)) is already real, θ = 2·atan2(v1, v0) lands
 * exactly on any real target with no phase gate needed. For VECTOR_B = [1, 0]
 * this is θ = 0 — the identity — which is the honest way to say |b⟩ = |0⟩
 * needs no preparation at all, rather than special-casing it away.
 */
export function prepareRealState(sv: StateVector, qubit: number, v: readonly [number, number]): void {
  const [v0, v1] = normalize2(v as [number, number])
  const theta = 2 * Math.atan2(v1, v0)
  if (Math.abs(theta) > 1e-15) sv.applySingle('RY', qubit, theta)
}

/**
 * Apply controlled-e^{iAt·2^power}, exactly, as controlled-e^{ic1t2^power·X}
 * times the global phase e^{ic0t2^power} — see the module header. A global
 * phase conditioned on a control qubit being |1⟩ IS a P gate on that qubit
 * alone (P(θ)|1⟩ = e^{iθ}|1⟩, P(θ)|0⟩ = |0⟩ — precisely "add phase θ when
 * control is 1"), so no separate controlled-phase machinery is needed.
 *
 * e^{iαX} = cos(α)·I + i·sin(α)·X equals RX(−2α) exactly (RX(θ) = cos(θ/2)I
 * − i sin(θ/2)X), which is why the controlled part below is a controlled-RX.
 * `invert` runs the same gates with negated angles — the uncompute step —
 * since (e^{iAt})† = e^{−iAt}.
 */
export function applyControlledEvolutionPower(
  sv: StateVector,
  clockQubit: number,
  power: number,
  m: Sym2x2 = MATRIX_A,
  t = EVOLUTION_TIME,
  invert = false
): void {
  const sign = invert ? -1 : 1
  const globalPhase = sign * m.a * t * power
  const rxAngle = sign * -2 * m.b * t * power
  sv.applySingle('P', clockQubit, globalPhase)
  sv.applyControlled('RX', [clockQubit], STATE_QUBIT, rxAngle)
}

/**
 * Apply `gateName` to `target`, controlled on the clock register reading
 * EXACTLY `value` — including its zero bits, via the standard X-conjugation
 * trick (flip a 0-control to 1, apply, flip back). Used for the 1/λ rotation:
 * each eigenvalue the clock can read gets its own, independent rotation angle.
 */
function applyControlledOnExactValue(
  sv: StateVector,
  controlQubits: readonly number[],
  value: number,
  gateName: 'RY',
  target: number,
  theta: number
): void {
  if (Math.abs(theta) < 1e-15) return
  const flipped: number[] = []
  controlQubits.forEach((q, bitIndex) => {
    if (((value >> bitIndex) & 1) === 0) {
      sv.applySingle('X', q)
      flipped.push(q)
    }
  })
  sv.applyControlled(gateName, controlQubits as number[], target, theta)
  for (const q of flipped) sv.applySingle('X', q)
}

/** The clock qubits in bit order (qubit j is bit j of y). */
const CLOCK_QUBIT_INDICES = Array.from({ length: CLOCK_QUBITS }, (_, j) => j)

/** Apply the controlled 1/λ rotation for every eigenvalue the clock register can hold. */
export function applyEigenvalueInversionRotation(sv: StateVector, c = C_CONST): void {
  for (let y = 1; y < CLOCK_DIM; y++) {
    const lambda = eigenvalueForClockValue(y)
    const theta = rotationAngle(lambda, c)
    applyControlledOnExactValue(sv, CLOCK_QUBIT_INDICES, y, 'RY', ANCILLA_QUBIT, theta)
  }
}

// ────────────────────────────────────────────────────────────
// Stage-by-stage walkthrough — mirrors lib/viz/phaseEstimation.ts's qpeStages
// ────────────────────────────────────────────────────────────

export type HhlStageId =
  | 'prepare'
  | 'hadamard'
  | 'kickback'
  | 'iqft'
  | 'rotation'
  | 'uncompute-qft'
  | 'uncompute-kickback'
  | 'uncompute-hadamard'
  | 'measure'

export interface HhlStage {
  id: HhlStageId
  /** Which controlled-U power this stage ends after (kickback / uncompute-kickback only). */
  power: number | null
  title: string
  detail: string
  state: StateVector
}

/**
 * Build every intermediate state of the HHL circuit for (A, b), one entry per
 * gate layer. `hhl.test.ts` checks the LAST stage's ancilla-success branch
 * against `classicalSolve()`.
 */
export function hhlStages(m: Sym2x2 = MATRIX_A, b: readonly [number, number] = VECTOR_B): HhlStage[] {
  const sv = new StateVector(TOTAL_QUBITS)
  const stages: HhlStage[] = []
  const push = (id: HhlStageId, power: number | null, title: string, detail: string): void => {
    stages.push({ id, power, title, detail, state: sv.clone() })
  }

  prepareRealState(sv, STATE_QUBIT, b)
  push(
    'prepare',
    null,
    'Prepare |b⟩',
    `The state register is set to |b⟩ = ${b[0].toFixed(3)}|0⟩ + ${b[1].toFixed(3)}|1⟩ — the right-hand side of Ax = b. HHL takes this preparation as given; building an arbitrary |b⟩ efficiently is a separate, genuinely hard problem the algorithm does not solve.`
  )

  for (let j = 0; j < CLOCK_QUBITS; j++) sv.applySingle('H', j)
  push(
    'hadamard',
    null,
    'Superpose the clock register',
    `All ${CLOCK_DIM} clock values now carry equal amplitude — the same starting point as quantum phase estimation, because that is exactly what runs next.`
  )

  for (let j = 0; j < CLOCK_QUBITS; j++) {
    const power = 2 ** j
    applyControlledEvolutionPower(sv, j, power, m, EVOLUTION_TIME, false)
    push(
      'kickback',
      j,
      `Controlled-e^{iAt·${power}}`,
      `Applying e^{iAt} ${power} time${power === 1 ? '' : 's'}, controlled on clock qubit ${j}. |b⟩'s two eigencomponents each kick back their own phase, e^{iλt·${power}} — this is quantum phase estimation running on an operator with two distinct eigenvalues in superposition, not one.`
    )
  }

  applyInverseQft(sv, CLOCK_QUBITS)
  push(
    'iqft',
    null,
    'Inverse QFT — read out the eigenvalues',
    `The clock register now holds both eigenvalues of A at once, in superposition: y = 1 (λ = 1) and y = 2 (λ = 2), each entangled with its own eigencomponent of |b⟩. No measurement has happened — collapsing here would destroy the superposition the rest of the algorithm needs.`
  )

  applyEigenvalueInversionRotation(sv, C_CONST)
  push(
    'rotation',
    null,
    'Controlled rotation — the 1/λ step',
    `An ancilla qubit is rotated by θ(λ) where sin(θ/2) = C/λ, controlled on the clock register — the one step that divides. Larger eigenvalues get a smaller rotation and a smaller chance of flipping the ancilla, which is the mechanism, not a side effect: it is what makes P(ancilla = 1) carry a factor of 1/λ into the amplitude.`
  )

  applyQft(sv, CLOCK_QUBITS)
  push(
    'uncompute-qft',
    null,
    'Uncompute: forward QFT',
    'The first half of undoing phase estimation — running the transform that was inverted after the kickback, forward again.'
  )

  for (let j = CLOCK_QUBITS - 1; j >= 0; j--) {
    const power = 2 ** j
    applyControlledEvolutionPower(sv, j, power, m, EVOLUTION_TIME, true)
    push(
      'uncompute-kickback',
      j,
      `Uncompute controlled-e^{iAt·${power}}`,
      `Running e^{−iAt} ${power} time${power === 1 ? '' : 's'}, controlled on clock qubit ${j} — the inverse of the kickback stage, in reverse order.`
    )
  }

  for (let j = 0; j < CLOCK_QUBITS; j++) sv.applySingle('H', j)
  push(
    'uncompute-hadamard',
    null,
    'Uncompute: Hadamards',
    'The clock register disentangles completely and returns to |0…0⟩ — a real prediction this page checks numerically, not an assumption. The eigenvalue information has been fully consumed by the rotation; none of it is left lying around to leak or be re-measured.'
  )

  push(
    'measure',
    null,
    'Measure the ancilla',
    'Measure the ancilla in the computational basis. Reading |1⟩ heralds success: the state register now holds a vector proportional to A⁻¹b. Reading |0⟩ means try again — the run is simply discarded, exactly as an inconclusive Bell measurement is discarded in teleportation.'
  )

  return stages
}

// ────────────────────────────────────────────────────────────
// Reading out registers from a (possibly entangled) joint state
// ────────────────────────────────────────────────────────────

/** Basis index for clock reading y, state bit s, ancilla bit a, in this module's fixed register layout. */
function basisIndex(y: number, s: 0 | 1, a: 0 | 1): number {
  return y | (s << STATE_QUBIT) | (a << ANCILLA_QUBIT)
}

/** Joint probability of each clock reading, marginalizing over the state register and ancilla. */
export function clockProbabilities(sv: StateVector): number[] {
  return Array.from({ length: CLOCK_DIM }, (_, y) => {
    let p = 0
    for (const s of [0, 1] as const) for (const a of [0, 1] as const) p += sv.probability(basisIndex(y, s, a))
    return p
  })
}

/** [P(ancilla = 0), P(ancilla = 1)], marginalizing over the clock and state registers. */
export function ancillaProbabilities(sv: StateVector): [number, number] {
  return [1 - sv.qubitProbability(ANCILLA_QUBIT), sv.qubitProbability(ANCILLA_QUBIT)]
}

/** [P(state = 0), P(state = 1)], marginalizing over the clock register and ancilla. */
export function stateProbabilities(sv: StateVector): [number, number] {
  return [1 - sv.qubitProbability(STATE_QUBIT), sv.qubitProbability(STATE_QUBIT)]
}

export interface HhlSolution {
  /** P(ancilla = 1) — the probability this run succeeds at all. */
  successProbability: number
  /** The state register's two amplitudes, conditioned on ancilla = 1 and clock = 0 (normalized). */
  amplitudes: [number, number]
  /** How much probability, given ancilla = 1, sits OUTSIDE clock = 0 — should be ~0; a nonzero value means the uncompute left residual entanglement. */
  residualClockLeakage: number
}

/**
 * The solution this run of HHL actually produces: post-select on ancilla = 1
 * (the herald), read the state register's amplitudes there, and report how
 * much of that success probability leaked to a clock reading other than 0 —
 * which should be zero when phase estimation is exact, as it is here.
 *
 * Deliberately NOT a full projective measurement of every qubit: HHL's output
 * is the STATE proportional to x, and this function reports exactly that
 * state (given the herald), not a classical sample of it. Reading out x in
 * full by sampling would need exponentially many shots — see the page copy.
 */
export function extractSolution(sv: StateVector): HhlSolution {
  const successProbability = sv.qubitProbability(ANCILLA_QUBIT)
  if (!(successProbability > 1e-12)) {
    throw new Error('ancilla = 1 has ~zero probability; nothing to extract')
  }

  let p00 = 0 // clock = 0, ancilla = 1, either state bit
  const raw: [number, number] = [0, 0]
  for (const s of [0, 1] as const) {
    const amp = sv.amplitude(basisIndex(0, s, 1))
    if (Math.abs(amp.im) > 1e-6) {
      throw new Error(`expected a real amplitude at clock=0, state=${s}, ancilla=1; got ${amp.im}i`)
    }
    raw[s] = amp.re
    p00 += amp.re * amp.re + amp.im * amp.im
  }

  const residualClockLeakage = successProbability - p00
  const amplitudes = normalize2(raw)
  return { successProbability, amplitudes, residualClockLeakage }
}
