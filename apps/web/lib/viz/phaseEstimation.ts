/**
 * phaseEstimation.ts — quantum phase estimation on the real statevector engine.
 *
 * QPE is the girder between /visualizations/qft and /visualizations/shor: the QFT
 * page shows what the transform does to a phase ramp, Shor's page uses the answer,
 * and this is the piece in between that writes the ramp in the first place.
 *
 * The setup is the smallest honest one. U is the phase gate P(2πφ), whose |1⟩
 * eigenstate has eigenvalue e^{2πiφ}; the eigenstate register is a single qubit
 * prepared in |1⟩. Controlled-U^{2^j} is then controlled-P(2π φ 2^j), which the
 * engine applies directly — no matrix is exponentiated by hand, and the kickback
 * onto the counting register is a consequence of running the gate, not an
 * assumption baked into the code.
 *
 * Register layout: counting qubits 0..t−1 with qubit j carrying bit j of the
 * measured integer y (qubit 0 is the LSB, matching lib/quantum.ts), and the
 * eigenstate qubit at index t.
 *
 * phaseEstimation.test.ts pins the simulator against the CLOSED FORM of the
 * output distribution,
 *
 *     P(y) = sin²(πε) / (4^t · sin²(πε / 2^t)),   ε = 2^t φ − y,
 *
 * which is derived from the geometric series and owes nothing to this code, plus
 * the textbook 4/π² and 8/π² success bounds and the t = n + ⌈log₂(2 + 1/2ε)⌉
 * qubit-count rule.
 */

import { StateVector } from '@/lib/quantum'

/** Counting-register sizes the page offers. 10 + 1 qubits is 2048 amplitudes. */
export const MIN_COUNTING_QUBITS = 2
export const MAX_COUNTING_QUBITS = 10

function assertCounting(t: number): void {
  if (!Number.isInteger(t) || t < 1 || t > MAX_COUNTING_QUBITS) {
    throw new Error(`counting register must be 1..${MAX_COUNTING_QUBITS} qubits, got ${t}`)
  }
}

/**
 * The inverse quantum Fourier transform on qubits 0..t−1 of `sv`, leaving every
 * other qubit alone. Same construction as /visualizations/qft, run backwards with
 * every phase angle negated: bit-reversal swaps, then for each qubit the negative
 * controlled phases followed by a Hadamard.
 *
 * Sign convention: the forward QFT here is |x⟩ → (1/√N) Σ_y e^{+2πixy/N} |y⟩, so
 * this maps (1/√N) Σ_y e^{+2πixy/N} |y⟩ back to |x⟩ — which is exactly the state
 * the controlled-U powers produce. The test asserts that round trip exactly.
 */
export function applyInverseQft(sv: StateVector, t: number): void {
  assertCounting(t)
  for (let i = 0; i < Math.floor(t / 2); i++) sv.applySwap(i, t - 1 - i)
  for (let j = 0; j < t; j++) {
    for (let k = 0; k <= j - 1; k++) {
      sv.applyControlled('P', [k], j, -Math.PI / 2 ** (j - k))
    }
    sv.applySingle('H', j)
  }
}

/** The forward QFT on qubits 0..t−1 — used by the tests to build a clean phase ramp. */
export function applyQft(sv: StateVector, t: number): void {
  assertCounting(t)
  for (let j = t - 1; j >= 0; j--) {
    sv.applySingle('H', j)
    for (let k = j - 1; k >= 0; k--) {
      sv.applyControlled('P', [k], j, Math.PI / 2 ** (j - k))
    }
  }
  for (let i = 0; i < Math.floor(t / 2); i++) sv.applySwap(i, t - 1 - i)
}

export type QpeStageId = 'init' | 'superpose' | 'kickback' | 'iqft'

export interface QpeStage {
  id: QpeStageId
  /** Which controlled-U power this stage ends after, for id === 'kickback'. */
  power: number | null
  title: string
  detail: string
  state: StateVector
}

/**
 * Build the QPE state stage by stage: the eigenstate prepared, the counting
 * register put in superposition, one stage per controlled-U^{2^j}, then the
 * inverse QFT.
 *
 * `phi` is the phase φ in U|u⟩ = e^{2πiφ}|u⟩, taken mod 1 — only the fractional
 * part is observable, which is itself worth knowing.
 */
export function qpeStages(t: number, phi: number): QpeStage[] {
  assertCounting(t)
  if (!Number.isFinite(phi)) throw new Error(`phi must be finite, got ${phi}`)
  const frac = ((phi % 1) + 1) % 1

  const sv = new StateVector(t + 1)
  const eigen = t
  const stages: QpeStage[] = []
  const push = (id: QpeStageId, power: number | null, title: string, detail: string): void => {
    stages.push({ id, power, title, detail, state: sv.clone() })
  }

  sv.applySingle('X', eigen)
  push(
    'init',
    null,
    'Prepare the eigenstate',
    'The bottom qubit is put in |1⟩, the eigenstate of U = P(2πφ) with eigenvalue e^{2πiφ}. It stays in that state for the whole run — U never changes it, only the phase in front of it.'
  )

  for (let j = 0; j < t; j++) sv.applySingle('H', j)
  push(
    'superpose',
    null,
    'Superpose the counting register',
    `All ${1 << t} values of y now carry equal amplitude and identical phase. Every dial points the same way.`
  )

  for (let j = 0; j < t; j++) {
    sv.applyControlled('P', [j], eigen, 2 * Math.PI * frac * 2 ** j)
    push(
      'kickback',
      j,
      `Controlled-U^${2 ** j}`,
      `Applying U ${2 ** j} time${2 ** j === 1 ? '' : 's'}, controlled on counting qubit ${j}. The eigenstate is unchanged; the phase e^{2πi·${2 ** j}φ} lands on the control instead.`
    )
  }

  applyInverseQft(sv, t)
  push(
    'iqft',
    null,
    'Inverse QFT',
    'The ramp written across the counting register is a frequency. The inverse transform turns it back into a number.'
  )

  return stages
}

/** The state after the whole algorithm, without keeping every stage. */
export function qpeFinalState(t: number, phi: number): StateVector {
  const stages = qpeStages(t, phi)
  return stages[stages.length - 1].state
}

/** Measurement probabilities over the counting register, eigenstate traced out. */
export function countingProbabilities(sv: StateVector, t: number): number[] {
  assertCounting(t)
  const dim = 1 << t
  return Array.from({ length: dim }, (_, y) => sv.probability(y) + sv.probability(y + dim))
}

/**
 * The relative phase counting qubit j carries after its controlled-U power:
 * 2π φ 2^j, wrapped to [0, 2π). This is what the dials on the page draw, and it
 * is the whole content of the register before the inverse QFT — the magnitudes
 * never move.
 */
export function kickbackAngle(phi: number, j: number): number {
  const frac = ((phi % 1) + 1) % 1
  const raw = 2 * Math.PI * frac * 2 ** j
  const wrapped = raw % (2 * Math.PI)
  return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped
}

/**
 * The closed-form QPE output distribution.
 *
 * P(y) = |(1/2^t) Σ_{k<2^t} e^{2πikε/2^t}|² with ε = 2^t φ − y, summed as a
 * geometric series to sin²(πε) / (4^t sin²(πε/2^t)). Independent of the circuit:
 * the tests use it to check the simulator, not the other way round.
 */
export function analyticProbability(t: number, phi: number, y: number): number {
  assertCounting(t)
  const dim = 1 << t
  const frac = ((phi % 1) + 1) % 1
  const eps = frac * dim - y
  const denomAngle = (Math.PI * eps) / dim
  // ε = 0 is the resonant case: every term of the sum is 1, the total is 2^t, and
  // the ratio above is 0/0. Away from it the formula is numerically well behaved
  // even for tiny ε, because numerator and denominator vanish at the same rate.
  if (eps === 0) return 1
  if (Math.abs(Math.sin(denomAngle)) < 1e-15) return 0
  const num = Math.sin(Math.PI * eps)
  const den = dim * Math.sin(denomAngle)
  return (num * num) / (den * den)
}

/** The full analytic distribution over the counting register. */
export function analyticDistribution(t: number, phi: number): number[] {
  const dim = 1 << t
  return Array.from({ length: dim }, (_, y) => analyticProbability(t, phi, y))
}

export interface QpeEstimate {
  /** The most likely measured integer. */
  y: number
  /** The phase that integer decodes to, y / 2^t. */
  phi: number
  /** Probability of measuring exactly that y. */
  probability: number
  /** |φ̂ − φ| on the circle (so 0.99 and 0.01 are 0.02 apart, not 0.98). */
  error: number
  /** Probability of landing on either of the two integers that bracket 2^t φ. */
  bracketProbability: number
  /** True when 2^t φ is an integer — the case QPE nails with certainty. */
  exact: boolean
}

/** Distance between two phases on the unit circle. */
export function circleDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 1) + 1) % 1)
  return Math.min(d, 1 - d)
}

/**
 * What the run is expected to return: the peak of the analytic distribution and
 * the two bounds the page quotes. Uses the closed form, so the numbers beside the
 * canvas are exact rather than sampled.
 */
export function qpeEstimate(t: number, phi: number): QpeEstimate {
  assertCounting(t)
  const dim = 1 << t
  const frac = ((phi % 1) + 1) % 1
  const probs = analyticDistribution(t, phi)
  let best = 0
  for (let y = 1; y < dim; y++) if (probs[y] > probs[best]) best = y

  const scaled = frac * dim
  const floor = Math.floor(scaled) % dim
  const ceil = (floor + 1) % dim
  const exact = Math.abs(scaled - Math.round(scaled)) < 1e-9
  const bracket = exact ? probs[Math.round(scaled) % dim] : probs[floor] + probs[ceil]

  return {
    y: best,
    phi: best / dim,
    probability: probs[best],
    error: circleDistance(best / dim, frac),
    bracketProbability: bracket,
    exact,
  }
}

/**
 * Probability the measurement lands within `tolerance` of the true phase —
 * the number the precision/qubit-count trade-off is actually about.
 */
export function probabilityWithin(t: number, phi: number, tolerance: number): number {
  assertCounting(t)
  const dim = 1 << t
  const frac = ((phi % 1) + 1) % 1
  let acc = 0
  for (let y = 0; y < dim; y++) {
    if (circleDistance(y / dim, frac) <= tolerance + 1e-12) acc += analyticProbability(t, phi, y)
  }
  return acc
}

/**
 * Counting qubits needed to read φ to `bits` binary places with failure
 * probability at most `epsilon`: t = bits + ⌈log₂(2 + 1/(2ε))⌉ (Nielsen & Chuang
 * §5.2.1). The second term is the price of confidence — it buys no extra
 * precision at all, which is the trade-off the page makes draggable.
 */
export function qubitsForPrecision(bits: number, epsilon: number): number {
  if (!Number.isInteger(bits) || bits < 1) throw new Error(`bits must be a positive integer`)
  if (!(epsilon > 0) || epsilon >= 1) throw new Error(`epsilon must be in (0, 1), got ${epsilon}`)
  return bits + Math.ceil(Math.log2(2 + 1 / (2 * epsilon)))
}

/** The extra qubits the confidence term costs on its own. */
export function confidenceOverhead(epsilon: number): number {
  return Math.ceil(Math.log2(2 + 1 / (2 * epsilon)))
}

/** y as a binary fraction: y = 5, t = 3 → "0.101". */
export function binaryFraction(y: number, t: number): string {
  return `0.${y.toString(2).padStart(t, '0')}`
}
