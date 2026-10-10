/**
 * qkd.ts — the numerics behind /visualizations/quantum-key-distribution.
 *
 * Two protocols, both run qubit by qubit on the site's statevector simulator
 * (lib/quantum.ts). Nothing here shortcuts to "matching basis → same bit,
 * mismatched → coin flip": every photon is a real `StateVector`, prepared with
 * X and H gates, disturbed by Eve with a real projective measurement, and read
 * by Bob with `measureQubit`. The textbook numbers (50% sifting, 25% QBER under
 * intercept-resend, 2√2 → √2 for E91) fall out of the Born rule rather than
 * being coded in, which is what lets qkd.test.ts check them independently.
 *
 * ── BB84 ──────────────────────────────────────────────────────────────────────
 *
 *   Alice     bit b ∈ {0,1}, basis β ∈ {Z, X}. |ψ⟩ = H^β X^b |0⟩.
 *   Eve       intercepts a fraction f of qubits. On each she guesses a basis ε,
 *             measures (H^ε · measure · H^ε), and forwards the eigenstate she
 *             found — the intercept-resend attack. No-cloning is why she cannot
 *             do anything gentler and still learn the bit.
 *   Channel   optional depolarising noise: with probability p a uniformly random
 *             Pauli X, Y or Z is applied. Two of the three flip the bit in
 *             either basis, so the channel alone contributes a QBER of 2p/3.
 *   Bob       basis β′, measures (H^β′ · measure).
 *   Sifting   keep positions where β = β′ — half of them, in expectation.
 *   QBER      fraction of the sifted key where Alice's bit ≠ Bob's bit.
 *
 *   Expected QBER, derived by hand:
 *     Eve wrong-basis on a sifted qubit with probability f/2, and in that case
 *     Bob's outcome is a fair coin whatever the channel then does: f/2 · 1/2.
 *     Otherwise (probability 1 − f/2) only the channel can flip it: 2p/3.
 *       Q(f, p) = f/4 + (1 − f/2)(2p/3)                        [expectedBb84Qber]
 *     Full interception on a clean channel is the famous 25%.
 *
 *   Secret key rate (Shor–Preskill, asymptotic, one-way post-processing):
 *       r(Q) = 1 − 2 h(Q)                                       [secretKeyRate]
 *   which reaches zero at Q ≈ 11.0%. That root IS the abort threshold the lesson
 *   quotes — it is not a separate magic number.
 *
 * ── E91 ───────────────────────────────────────────────────────────────────────
 *
 *   A source emits the singlet (|01⟩ − |10⟩)/√2. Alice measures spin along a
 *   Bloch-plane angle from {0, π/4, π/2}, Bob from {π/4, π/2, 3π/4} (Ekert's
 *   original settings). Measuring along angle θ is RY(−θ) followed by a Z-basis
 *   measurement.
 *
 *     matching settings   (π/4,π/4), (π/2,π/2)   → key: Alice's bit vs NOT Bob's
 *     the four CHSH pairs (0,π/4) (0,3π/4) (π/2,π/4) (π/2,3π/4) → S
 *     the other three combinations              → discarded
 *
 *   The singlet gives E(a,b) = −cos(a − b) (lib/viz/chsh.ts, reused here), so
 *   |S| = 2√2 with no Eve. Intercept-resend on Bob's arm — Eve measures along
 *   one of Bob's three axes ε and forwards the eigenstate — leaves a product
 *   state whose correlator is E = −cos(a − ε)cos(b − ε). Evaluated on the four
 *   CHSH pairs that gives |S| = √2 for EVERY choice of ε (worked in the test
 *   file), so with interception fraction f:
 *       |S|(f) = (1 − f)·2√2 + f·√2 = √2 (2 − f)                 [expectedE91S]
 *   which crosses Bell's bound of 2 at f = 2 − √2 ≈ 58.6%.
 */

import { StateVector, mulberry32 } from '@/lib/quantum'
import {
  CLASSICAL_BOUND,
  TSIRELSON_BOUND,
  chshFromCorrelators,
  singletCorrelation,
  summarize,
  type Correlators,
  type Tally,
  type TallyStats,
} from '@/lib/viz/chsh'

export { CLASSICAL_BOUND, TSIRELSON_BOUND }

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

/** 0 = rectilinear (Z, "+"), 1 = diagonal (X, "×"). */
export type Basis = 0 | 1
export type Bit = 0 | 1

export const BASIS_LABEL: Record<Basis, string> = { 0: '+', 1: '×' }
export const BASIS_NAME: Record<Basis, string> = { 0: 'rectilinear', 1: 'diagonal' }

/** Binary entropy in bits. h(0) = h(1) = 0, h(½) = 1. */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
}

/**
 * The asymptotic BB84 secret key fraction after error correction and privacy
 * amplification, per sifted bit: 1 − 2h(Q). Clamped at zero — a negative rate
 * means "abort", not "owe Eve some key".
 */
export function secretKeyRate(qber: number): number {
  return Math.max(0, 1 - 2 * binaryEntropy(qber))
}

/** Where 1 − 2h(Q) hits zero: Q ≈ 0.110. Above this, BB84 aborts. */
export const QBER_ABORT = 0.11

const randomBit = (rand: () => number): Bit => (rand() < 0.5 ? 0 : 1)

/**
 * Depolarising noise on qubit `q`: with probability p apply a uniformly random
 * non-identity Pauli. Returns the Pauli applied, or null.
 */
function depolarise(sv: StateVector, q: number, p: number, rand: () => number): 'X' | 'Y' | 'Z' | null {
  if (p <= 0 || rand() >= p) return null
  const which = Math.min(2, Math.floor(rand() * 3))
  const pauli = (['X', 'Y', 'Z'] as const)[which]
  sv.applySingle(pauli, q)
  return pauli
}

// ─────────────────────────────────────────────────────────────────────────────
// BB84
// ─────────────────────────────────────────────────────────────────────────────

export type Bb84Params = {
  /** Fraction of qubits Eve intercepts, 0..1. */
  interceptFraction: number
  /** Depolarising probability per qubit on the channel, 0..1. */
  channelNoise: number
}

/** One qubit's full ledger row — everything the three parties know about it. */
export type Bb84Qubit = {
  aliceBit: Bit
  aliceBasis: Basis
  /** Present when Eve intercepted this qubit. */
  eve: { basis: Basis; bit: Bit } | null
  /** The Pauli the channel applied, if any. */
  noise: 'X' | 'Y' | 'Z' | null
  bobBasis: Basis
  bobBit: Bit
  /** Bases matched — the position survives sifting. */
  sifted: boolean
  /** Sifted AND Alice's bit ≠ Bob's bit. */
  error: boolean
}

/**
 * Prepare, attack, transmit and measure ONE qubit. Every step is a gate or a
 * measurement on a real single-qubit statevector.
 */
export function sendBb84Qubit(params: Bb84Params, rand: () => number): Bb84Qubit {
  const aliceBit = randomBit(rand)
  const aliceBasis = randomBit(rand) as Basis
  const bobBasis = randomBit(rand) as Basis

  // Alice: |0⟩ → X^bit → H^basis.
  const sv = new StateVector(1)
  if (aliceBit === 1) sv.applySingle('X', 0)
  if (aliceBasis === 1) sv.applySingle('H', 0)

  // Eve: intercept-resend. Measuring in the diagonal basis is H · measure; the
  // collapsed state is |m⟩, and H again turns it into the |±⟩ she "found" and
  // forwards. In the rectilinear basis the measurement already leaves |m⟩.
  let eve: Bb84Qubit['eve'] = null
  if (params.interceptFraction > 0 && rand() < params.interceptFraction) {
    const basis = randomBit(rand) as Basis
    if (basis === 1) sv.applySingle('H', 0)
    const bit = sv.measureQubit(0, rand)
    if (basis === 1) sv.applySingle('H', 0)
    eve = { basis, bit }
  }

  const noise = depolarise(sv, 0, params.channelNoise, rand)

  // Bob.
  if (bobBasis === 1) sv.applySingle('H', 0)
  const bobBit = sv.measureQubit(0, rand)

  const sifted = aliceBasis === bobBasis
  return {
    aliceBit,
    aliceBasis,
    eve,
    noise,
    bobBasis,
    bobBit,
    sifted,
    error: sifted && aliceBit !== bobBit,
  }
}

/** The hand-derived expectation: f/4 + (1 − f/2)·(2p/3). */
export function expectedBb84Qber(params: Bb84Params): number {
  const f = params.interceptFraction
  const p = params.channelNoise
  return f / 4 + (1 - f / 2) * ((2 * p) / 3)
}

/** One point on the QBER-versus-qubits chart. */
export type Bb84Sample = { sent: number; qber: number; se: number }

export type Bb84Run = {
  params: Bb84Params
  sent: number
  sifted: number
  errors: number
  /** Sifted bits Eve intercepted AND holds the correct value of. */
  eveCorrect: number
  /** Sifted bits Eve intercepted at all. */
  eveIntercepted: number
  /** The most recent qubits, newest last, for the raw-data strip. */
  recent: Bb84Qubit[]
  /** The first `LEDGER_ROWS` qubits, for the table on the page. */
  ledger: Bb84Qubit[]
  samples: Bb84Sample[]
  nextSampleAt: number
  sampleEvery: number
}

export const RECENT_QUBITS = 40
export const LEDGER_ROWS = 24

export function createBb84Run(params: Bb84Params, sampleEvery: number): Bb84Run {
  return {
    params,
    sent: 0,
    sifted: 0,
    errors: 0,
    eveCorrect: 0,
    eveIntercepted: 0,
    recent: [],
    ledger: [],
    samples: [],
    nextSampleAt: sampleEvery,
    sampleEvery,
  }
}

/** Sample QBER and its binomial standard error from a run's tallies. */
function qberOf(sifted: number, errors: number): { qber: number; se: number } {
  if (sifted === 0) return { qber: 0, se: Infinity }
  const q = errors / sifted
  return { qber: q, se: Math.sqrt((q * (1 - q)) / sifted) }
}

/** Send `batch` more qubits through the protocol. */
export function advanceBb84(run: Bb84Run, rand: () => number, batch: number): void {
  for (let i = 0; i < batch; i++) {
    const q = sendBb84Qubit(run.params, rand)
    run.sent++
    if (q.sifted) {
      run.sifted++
      if (q.error) run.errors++
      if (q.eve) {
        run.eveIntercepted++
        if (q.eve.bit === q.aliceBit) run.eveCorrect++
      }
    }
    run.recent.push(q)
    if (run.recent.length > RECENT_QUBITS) run.recent.shift()
    if (run.ledger.length < LEDGER_ROWS) run.ledger.push(q)
    if (run.sent >= run.nextSampleAt) {
      const { qber, se } = qberOf(run.sifted, run.errors)
      run.samples.push({ sent: run.sent, qber, se: Number.isFinite(se) ? se : 0 })
      run.nextSampleAt += run.sampleEvery
    }
  }
}

export type Verdict = 'pending' | 'secure' | 'abort'

export type Bb84Stats = {
  sent: number
  sifted: number
  siftedFraction: number
  errors: number
  qber: number
  /** One binomial standard error on the QBER. Infinity with no sifted bits. */
  qberSe: number
  expectedQber: number
  /** 1 − 2h(Q), clamped at 0. */
  keyRate: number
  /** Sifted bits × key rate, rounded down — what survives privacy amplification. */
  finalKeyBits: number
  /** Fraction of the sifted key Eve holds correctly (only meaningful if she intercepted). */
  eveKnowledge: number
  verdict: Verdict
}

/** Needs this many sifted bits before calling a verdict — 20 bits cannot resolve 11% from 0%. */
export const VERDICT_MIN_SIFTED = 64

export function bb84Stats(run: Bb84Run): Bb84Stats {
  const { qber, se } = qberOf(run.sifted, run.errors)
  const keyRate = secretKeyRate(qber)
  const verdict: Verdict =
    run.sifted < VERDICT_MIN_SIFTED ? 'pending' : qber > QBER_ABORT ? 'abort' : 'secure'
  return {
    sent: run.sent,
    sifted: run.sifted,
    siftedFraction: run.sent > 0 ? run.sifted / run.sent : 0,
    errors: run.errors,
    qber,
    qberSe: se,
    expectedQber: expectedBb84Qber(run.params),
    keyRate,
    finalKeyBits: verdict === 'abort' ? 0 : Math.floor(run.sifted * keyRate),
    eveKnowledge: run.eveIntercepted > 0 ? run.eveCorrect / run.eveIntercepted : 0,
    verdict,
  }
}

/** A complete seeded BB84 run in one call — the form the tests use. */
export function runBb84(params: Bb84Params, qubits: number, seed: number): Bb84Stats {
  const run = createBb84Run(params, Math.max(1, Math.floor(qubits / 60)))
  advanceBb84(run, mulberry32(seed), qubits)
  return bb84Stats(run)
}

// ─────────────────────────────────────────────────────────────────────────────
// E91
// ─────────────────────────────────────────────────────────────────────────────

/** Ekert's settings, as Bloch-plane angles in radians. */
export const E91_ALICE_ANGLES = [0, Math.PI / 4, Math.PI / 2] as const
export const E91_BOB_ANGLES = [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4] as const

export type SettingIndex = 0 | 1 | 2

export const E91_ANGLE_LABELS = {
  alice: ['0°', '45°', '90°'],
  bob: ['45°', '90°', '135°'],
} as const

export type E91Role = 'key' | 'chsh' | 'discard'

/**
 * What a (Alice, Bob) setting combination is used for. The CHSH pairs are, in
 * lib/viz/chsh.ts's order: (a,b)=(0,45°), (a,b′)=(0,135°), (a′,b)=(90°,45°),
 * (a′,b′)=(90°,135°). Returns the tally index for those, so the run can drop
 * straight into chsh.ts's `Tally`.
 */
export function e91Role(ai: SettingIndex, bi: SettingIndex): { role: E91Role; chshIndex: 0 | 1 | 2 | 3 | null } {
  if (E91_ALICE_ANGLES[ai] === E91_BOB_ANGLES[bi]) return { role: 'key', chshIndex: null }
  if (ai === 0 && bi === 0) return { role: 'chsh', chshIndex: 0 }
  if (ai === 0 && bi === 2) return { role: 'chsh', chshIndex: 1 }
  if (ai === 2 && bi === 0) return { role: 'chsh', chshIndex: 2 }
  if (ai === 2 && bi === 2) return { role: 'chsh', chshIndex: 3 }
  return { role: 'discard', chshIndex: null }
}

export type E91Params = {
  /** Fraction of pairs on which Eve intercepts Bob's qubit, 0..1. */
  interceptFraction: number
}

export type E91Pair = {
  ai: SettingIndex
  bi: SettingIndex
  /** ±1 outcomes, as spin along the chosen axis. */
  a: 1 | -1
  b: 1 | -1
  /** Index into E91_BOB_ANGLES of the axis Eve measured along, if she did. */
  eveAxis: SettingIndex | null
  role: E91Role
}

/** Prepare (|01⟩ − |10⟩)/√2 up to a global phase on a fresh 2-qubit register. */
export function prepareSinglet(): StateVector {
  const sv = new StateVector(2)
  sv.applySingle('H', 0)
  sv.applyControlled('X', [0], 1)
  sv.applySingle('X', 1)
  sv.applySingle('Z', 0)
  return sv
}

/** Measure spin along Bloch-plane angle θ: rotate the axis onto z, then read z. Returns ±1. */
function measureAlong(sv: StateVector, q: number, theta: number, rand: () => number): 1 | -1 {
  sv.applySingle('RY', q, -theta)
  return sv.measureQubit(q, rand) === 0 ? 1 : -1
}

const pick3 = (rand: () => number): SettingIndex => Math.min(2, Math.floor(rand() * 3)) as SettingIndex

/** One entangled pair: emitted, optionally attacked on Bob's arm, measured by both. */
export function sendE91Pair(params: E91Params, rand: () => number): E91Pair {
  const ai = pick3(rand)
  const bi = pick3(rand)
  const sv = prepareSinglet()

  // Eve measures Bob's qubit along one of his three axes and forwards the
  // eigenstate she found: RY(−ε), measure, RY(+ε) puts the collapsed |m⟩ back
  // onto the ε axis. Alice's qubit is now the opposite eigenstate along ε —
  // the entanglement is gone and only classical anticorrelation remains.
  let eveAxis: SettingIndex | null = null
  if (params.interceptFraction > 0 && rand() < params.interceptFraction) {
    eveAxis = pick3(rand)
    const eps = E91_BOB_ANGLES[eveAxis]
    sv.applySingle('RY', 1, -eps)
    sv.measureQubit(1, rand)
    sv.applySingle('RY', 1, eps)
  }

  const a = measureAlong(sv, 0, E91_ALICE_ANGLES[ai], rand)
  const b = measureAlong(sv, 1, E91_BOB_ANGLES[bi], rand)
  return { ai, bi, a, b, eveAxis, role: e91Role(ai, bi).role }
}

/** The exact singlet correlator for a setting combination: −cos(a − b). */
export function e91Correlation(ai: SettingIndex, bi: SettingIndex): number {
  return singletCorrelation(E91_ALICE_ANGLES[ai], E91_BOB_ANGLES[bi])
}

/** |S| = √2 (2 − f) under intercept-resend on a fraction f of pairs. */
export function expectedE91S(interceptFraction: number): number {
  return Math.SQRT2 * (2 - interceptFraction)
}

/** The interception fraction at which |S| falls to Bell's bound: 2 − √2. */
export const E91_DETECTION_FRACTION = 2 - Math.SQRT2

export type E91Sample = { sent: number; sAbs: number; se: number }

export type E91Run = {
  params: E91Params
  sent: number
  tally: Tally
  /** Pairs per (Alice setting, Bob setting), row-major 3×3. */
  grid: number[]
  keyBits: number
  keyErrors: number
  recent: E91Pair[]
  samples: E91Sample[]
  nextSampleAt: number
  sampleEvery: number
}

export const RECENT_PAIRS = 40

export function createE91Run(params: E91Params, sampleEvery: number): E91Run {
  return {
    params,
    sent: 0,
    tally: { counts: [0, 0, 0, 0], sums: [0, 0, 0, 0] },
    grid: new Array(9).fill(0),
    keyBits: 0,
    keyErrors: 0,
    recent: [],
    samples: [],
    nextSampleAt: sampleEvery,
    sampleEvery,
  }
}

export function advanceE91(run: E91Run, rand: () => number, batch: number): void {
  for (let i = 0; i < batch; i++) {
    const pair = sendE91Pair(run.params, rand)
    run.sent++
    run.grid[pair.ai * 3 + pair.bi]++
    const { role, chshIndex } = e91Role(pair.ai, pair.bi)
    if (role === 'key') {
      run.keyBits++
      // The singlet anticorrelates: a key error is Alice and Bob AGREEING.
      if (pair.a === pair.b) run.keyErrors++
    } else if (chshIndex !== null) {
      run.tally.counts[chshIndex]++
      run.tally.sums[chshIndex] += pair.a * pair.b
    }
    run.recent.push(pair)
    if (run.recent.length > RECENT_PAIRS) run.recent.shift()
    if (run.sent >= run.nextSampleAt) {
      const s = summarize(run.tally)
      run.samples.push({ sent: run.sent, sAbs: s.sAbs, se: Number.isFinite(s.se) ? s.se : 0 })
      run.nextSampleAt += run.sampleEvery
    }
  }
}

export type E91Stats = {
  sent: number
  chsh: TallyStats
  /** The exact singlet correlators for the four CHSH pairs, for the chart ticks. */
  idealCorrelators: Correlators
  expectedS: number
  keyBits: number
  keyErrors: number
  keyQber: number
  keyRate: number
  finalKeyBits: number
  verdict: Verdict
}

/** Needs this many CHSH pairs before calling a verdict. */
export const E91_VERDICT_MIN_PAIRS = 200

export function e91Stats(run: E91Run): E91Stats {
  const chsh = summarize(run.tally)
  const chshPairs = run.tally.counts.reduce((a, b) => a + b, 0)
  const keyQber = run.keyBits > 0 ? run.keyErrors / run.keyBits : 0
  const keyRate = secretKeyRate(keyQber)
  // Detection is the Bell test: |S| at or below 2 is consistent with a
  // classically correlated (i.e. Eve-readable) source, so the key is unusable.
  // A violation only proves the pair is entangled, not maximally so, and the
  // key must still survive error correction: a matched-axis QBER above the
  // 1 − 2h(Q) = 0 point leaves nothing to distil, so that aborts too.
  const verdict: Verdict =
    chshPairs < E91_VERDICT_MIN_PAIRS
      ? 'pending'
      : chsh.sAbs <= CLASSICAL_BOUND || keyQber > QBER_ABORT
        ? 'abort'
        : 'secure'
  return {
    sent: run.sent,
    chsh,
    idealCorrelators: {
      ab: e91Correlation(0, 0),
      abPrime: e91Correlation(0, 2),
      aPrimeB: e91Correlation(2, 0),
      aPrimeBPrime: e91Correlation(2, 2),
    },
    expectedS: expectedE91S(run.params.interceptFraction),
    keyBits: run.keyBits,
    keyErrors: run.keyErrors,
    keyQber,
    keyRate,
    finalKeyBits: verdict === 'abort' ? 0 : Math.floor(run.keyBits * keyRate),
    verdict,
  }
}

/** A complete seeded E91 run in one call. */
export function runE91(params: E91Params, pairs: number, seed: number): E91Stats {
  const run = createE91Run(params, Math.max(1, Math.floor(pairs / 60)))
  advanceE91(run, mulberry32(seed), pairs)
  return e91Stats(run)
}

/** Re-exported so the page can print the CHSH combination without a second import. */
export { chshFromCorrelators }
