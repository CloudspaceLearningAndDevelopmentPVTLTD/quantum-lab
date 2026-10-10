/**
 * generate.ts — verified challenge generation.
 *
 * The catalogue is hand-written and hand-checked; this module makes siblings of
 * it on demand — "practice more like this" — without inheriting the risk that a
 * machine-written puzzle is fiction. The defence is the same one the catalogue
 * uses, applied mechanically:
 *
 *   EVERY GENERATED CHALLENGE IS VERIFIED SOLVABLE BY EXECUTION BEFORE IT IS
 *   RETURNED. The generator runs its own reference solution through the real
 *   simulator and the real grader (lib/challenges/grade.ts) and asserts a full
 *   pass. It also asserts the puzzle is not degenerate: an EMPTY circuit must
 *   fail (otherwise the initial |0…0⟩ state already solves it), and every gate
 *   in the reference solution must matter (removing any one gate must fail the
 *   grader, so the stated par is tight and no hint names a redundant gate).
 *   For fix-the-bug, the broken starting circuit must actually fail. A draw
 *   that misses any of these is thrown away and the next attempt is derived
 *   FROM THE SAME SEED, so retries never break determinism.
 *
 * Pure and seeded throughout: same (kind, difficulty, seed) → same challenge,
 * bit for bit. No Date.now, no unseeded Math.random — the test suite proves it
 * by making Math.random throw during generation.
 *
 * The gate pool is curated rather than the full palette, for the same reasons
 * catalogue.ts documents at length:
 *   - every gate is placeable by the learner (no MEASURE/BARRIER, no Toffoli
 *     noise in a 3-gate puzzle);
 *   - every RY angle sits on the π/16 lattice, because that is the θ slider's
 *     step in ChallengeWorkbench and an angle off the lattice is unsolvable in
 *     the UI even when it is solvable in principle;
 *   - DIAGONAL gates (Z, S, CZ, P) are excluded from generation on purpose.
 *     They never change a probability on their own, and this generator grades
 *     on probabilities, so a diagonal gate only "matters" when a later H/RY
 *     mixes its phase back into the amplitudes — which random 2-3 gate draws
 *     almost never arrange. Including them made the minimality check reject
 *     ~90% of draws. They still appear as BUGS: the mutation table may rename
 *     a gate to Z/S or a CX to CZ, because a bug only has to fail the grader.
 *
 * Drawing is state-aware for the same reason: a CX whose control wire is still
 * a definite |0⟩ is the identity, so the draw tracks a coarse per-wire state
 * (zero / one / superposed) and only places a CX where its control can fire.
 * This is a heuristic to keep the survival rate high — the EXECUTED checks in
 * verifyByExecution remain the sole authority on what is returned.
 *
 * A later agent registers generateChallenge() as an MCP tool; keep the
 * signature (kind, difficulty, seed) stable.
 */

import { mulberry32, simulate, type Circuit, type GateName, type GateOp } from '@/lib/quantum'
import { grade } from './grade'
import type { Challenge } from './types'

// ────────────────────────────────────────────────────────────
// Public API surface
// ────────────────────────────────────────────────────────────

/** The kinds this generator can produce. A subset of ChallengeKind. */
export type GeneratedKind = 'target-state' | 'target-distribution' | 'fix-the-bug'

export const GENERATED_KINDS: readonly GeneratedKind[] = [
  'target-state',
  'target-distribution',
  'fix-the-bug',
]

/** 1 → one qubit / short circuit, 3 → three qubits / longer circuit. */
export type Difficulty = 1 | 2 | 3

export interface GeneratedChallenge extends Challenge {
  /** The seed that reproduces this exact challenge. */
  seed: number
  difficulty: Difficulty
  /**
   * The circuit the generator verified against the grader. Exposed so callers
   * (tests, the MCP tool, a future "show me the answer" flow) can re-verify —
   * the UI must never render it unprompted.
   */
  referenceSolution: Circuit
  /** fix-the-bug only: which op was corrupted, and by which rule. */
  mutation?: { index: number; rule: MutationRule }
}

export type MutationRule = 'rename' | 'rewire' | 'reverse-control' | 'swap-two-qubit' | 'detune'

/**
 * How many derived attempts a single seed may burn before we give up. In
 * practice a draw survives verification well inside ten attempts; hitting this
 * bound means the generator itself is broken, so it throws rather than
 * returning something unverified.
 */
export const MAX_ATTEMPTS = 64

// ────────────────────────────────────────────────────────────
// Seeding
// ────────────────────────────────────────────────────────────

/** FNV-1a — the same cheap string hash app/challenges/page.tsx uses for the daily pick. */
function fnv1a(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** A follow-up seed for "practice another one" flows: deterministic, well mixed. */
export function nextSeed(seed: number): number {
  return fnv1a(`next:${seed >>> 0}`)
}

// ────────────────────────────────────────────────────────────
// Random circuit construction
// ────────────────────────────────────────────────────────────

/** Single-qubit gates safe to draw — all probability-visible (see header). */
const SINGLE_POOL: readonly GateName[] = ['H', 'X', 'RY']
/** Fixed single-qubit gates a `rename` mutation may swap between. Z and S are
 * legal BUGS even though generation never draws them: a phase gate where a
 * Hadamard belongs is exactly the kind of quiet mistake worth practising on. */
const RENAME_POOL: readonly GateName[] = ['H', 'X', 'Z', 'S']

const PI_16 = Math.PI / 16

interface DifficultySpec {
  numQubits: number
  minGates: number
  maxGates: number
  level: Challenge['level']
}

/** Difficulty maps to register width and circuit length — nothing else. */
const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  1: { numQubits: 1, minGates: 2, maxGates: 2, level: 'Beginner' },
  2: { numQubits: 2, minGates: 2, maxGates: 3, level: 'Intermediate' },
  3: { numQubits: 3, minGates: 3, maxGates: 3, level: 'Advanced' },
}

type Rng = () => number

const pick = <T,>(rng: Rng, pool: readonly T[]): T => pool[Math.floor(rng() * pool.length)]
const pickInt = (rng: Rng, loInclusive: number, hiInclusive: number): number =>
  loInclusive + Math.floor(rng() * (hiInclusive - loInclusive + 1))

/** A θ the slider can type back in: k·π/16 with k in 1..31 (never 0 — RY(0) is identity). */
function latticeTheta(rng: Rng): number {
  return pickInt(rng, 1, 31) * PI_16
}

/**
 * Coarse classical shadow of one wire, tracked only to steer the draw:
 * 'zero'/'one' — the wire is still in a definite basis state; 'super' — an H,
 * RY, or entangling CX has touched it. Deliberately lossy (an RY(π) is really
 * an X); the executed verification catches anything this model gets wrong.
 */
type WireState = 'zero' | 'one' | 'super'

function randomCircuit(rng: Rng, spec: DifficultySpec): Circuit {
  const gates = pickInt(rng, spec.minGates, spec.maxGates)
  const n = spec.numQubits
  const wires: WireState[] = new Array<WireState>(n).fill('zero')
  const ops: GateOp[] = []

  for (let i = 0; i < gates; i++) {
    // A CX only does anything when its control can fire, so only draw one when
    // some wire is |1⟩ or superposed.
    const liveControls = wires.map((s, q) => (s === 'zero' ? -1 : q)).filter((q) => q >= 0)
    if (n >= 2 && liveControls.length > 0 && rng() < 0.4) {
      const control = pick(rng, liveControls)
      let target = pickInt(rng, 0, n - 2)
      if (target >= control) target += 1
      ops.push({ name: 'CX', qubits: [control, target] })
      if (wires[control] === 'super') wires[target] = 'super'
      else if (wires[target] !== 'super') wires[target] = wires[target] === 'one' ? 'zero' : 'one'
      continue
    }
    const name = pick(rng, SINGLE_POOL)
    const q = pickInt(rng, 0, n - 1)
    if (name === 'RY') {
      ops.push({ name, qubits: [q], theta: latticeTheta(rng) })
      wires[q] = 'super'
    } else if (name === 'H') {
      ops.push({ name, qubits: [q] })
      wires[q] = 'super'
    } else {
      ops.push({ name, qubits: [q] })
      if (wires[q] !== 'super') wires[q] = wires[q] === 'one' ? 'zero' : 'one'
    }
  }

  return { numQubits: n, ops }
}

// ────────────────────────────────────────────────────────────
// Mutation table (fix-the-bug)
//
// Every rule REPLACES exactly one op — never inserts or deletes — so a broken
// circuit and its correction always have the same length and differ at exactly
// one index. That is a deliberately narrow definition of "one bug": it keeps
// the diff auditable in tests and keeps the repair reachable in the workbench
// (delete the one wrong gate, or delete-and-rebuild; both are edits the editor
// supports).
// ────────────────────────────────────────────────────────────

const MUTATION_RULES: readonly MutationRule[] = [
  'rename',
  'rewire',
  'reverse-control',
  'swap-two-qubit',
  'detune',
]

/** Apply one rule to one op. Returns null when the rule does not apply to this op. */
function mutateOp(rule: MutationRule, op: GateOp, rng: Rng, numQubits: number): GateOp | null {
  switch (rule) {
    case 'rename': {
      if (!RENAME_POOL.includes(op.name)) return null
      const others = RENAME_POOL.filter((n) => n !== op.name)
      return { name: pick(rng, others), qubits: [...op.qubits] }
    }
    case 'rewire': {
      // Move a single-qubit gate to a different wire.
      if (op.qubits.length !== 1 || numQubits < 2) return null
      let q = pickInt(rng, 0, numQubits - 2)
      if (q >= op.qubits[0]) q += 1
      return op.theta === undefined
        ? { name: op.name, qubits: [q] }
        : { name: op.name, qubits: [q], theta: op.theta }
    }
    case 'reverse-control': {
      // CZ is symmetric in its qubits, so reversing it is not a bug at all.
      if (op.name !== 'CX') return null
      return { name: 'CX', qubits: [op.qubits[1], op.qubits[0]] }
    }
    case 'swap-two-qubit': {
      if (op.name === 'CX') return { name: 'CZ', qubits: [...op.qubits] }
      if (op.name === 'CZ') return { name: 'CX', qubits: [...op.qubits] }
      return null
    }
    case 'detune': {
      if (op.theta === undefined) return null
      // Shift by a coarse lattice step, wrapped into (0, 2π). Never land on 0:
      // RY(0) is the identity and "the bug is a gate that does nothing" grades
      // correctly but reads as a trick question.
      const delta = pick(rng, [-8, -4, 4, 8]) * PI_16
      const twoPi = 2 * Math.PI
      const theta = ((op.theta + delta) % twoPi + twoPi) % twoPi
      if (theta < PI_16 / 2) return null
      return { name: op.name, qubits: [...op.qubits], theta }
    }
  }
}

/**
 * Corrupt exactly one op of `circuit`. Tries (index, rule) pairs in an
 * rng-driven order until one applies; the correct circuit always contains at
 * least one op every draw of RENAME_POOL/CX/CZ/RY can hit, so this only fails
 * on pathological draws, which the caller treats as a failed attempt.
 */
function injectMutation(
  rng: Rng,
  circuit: Circuit
): { ops: GateOp[]; index: number; rule: MutationRule } | null {
  const tried = new Set<string>()
  const total = circuit.ops.length * MUTATION_RULES.length
  while (tried.size < total) {
    const index = pickInt(rng, 0, circuit.ops.length - 1)
    const rule = pick(rng, MUTATION_RULES)
    const key = `${index}:${rule}`
    if (tried.has(key)) continue
    tried.add(key)
    const mutated = mutateOp(rule, circuit.ops[index], rng, circuit.numQubits)
    if (!mutated) continue
    if (JSON.stringify(mutated) === JSON.stringify(circuit.ops[index])) continue
    const ops = circuit.ops.map((op, i) => (i === index ? mutated : { ...op }))
    return { ops, index, rule }
  }
  return null
}

// ────────────────────────────────────────────────────────────
// Verification — the invariant this module exists for
// ────────────────────────────────────────────────────────────

/**
 * True when the challenge is honest: the reference solution passes the real
 * grader at full score, the untouched initial state does not, and no gate of
 * the solution is dead weight. All three checks run the actual simulator —
 * nothing here reasons about gates symbolically.
 */
function verifyByExecution(challenge: Challenge, solution: Circuit): boolean {
  const full = grade(challenge, solution)
  if (!full.passed || full.score !== 1) return false

  // Degenerate targets: |0…0⟩ (or anything within tolerance of it) is solved
  // by an empty editor, which is not a challenge.
  if (grade(challenge, { numQubits: challenge.numQubits, ops: [] }).passed) return false

  // Minimality: par is the solution's gate count, so every gate must matter.
  // This is also what prunes the draws where a phase gate is invisible to the
  // probability-based grader (e.g. a Z acting on |0⟩).
  for (let i = 0; i < solution.ops.length; i++) {
    const pruned: Circuit = {
      numQubits: solution.numQubits,
      ops: solution.ops.filter((_, j) => j !== i),
    }
    if (grade(challenge, pruned).passed) return false
  }
  return true
}

// ────────────────────────────────────────────────────────────
// Prose — deterministic, and honest about being generated
// ────────────────────────────────────────────────────────────

function describeOp(op: GateOp): string {
  if (op.name === 'CX') return `CX with control q${op.qubits[0]} and target q${op.qubits[1]}`
  if (op.name === 'CZ') return `CZ across q${op.qubits[0]} and q${op.qubits[1]}`
  if (op.theta !== undefined) {
    return `${op.name}(${(op.theta / Math.PI).toFixed(2)}π) on q${op.qubits[0]}`
  }
  return `${op.name} on q${op.qubits[0]}`
}

function gateMultiset(ops: GateOp[]): string {
  return [...ops.map((op) => op.name)].sort().join(', ')
}

function recipe(ops: GateOp[]): string {
  return ops.map(describeOp).join('; then ')
}

interface Prose {
  title: string
  brief: string
  hints: string[]
  successNote: string
  lessonSlug: string
}

function proseFor(
  kind: GeneratedKind,
  spec: DifficultySpec,
  solution: Circuit,
  broken?: { index: number }
): Prose {
  const n = solution.ops.length
  const gates = `${n} gate${n === 1 ? '' : 's'}`
  const qubits = `${spec.numQubits} qubit${spec.numQubits === 1 ? '' : 's'}`

  switch (kind) {
    case 'target-state':
      return {
        title: 'Generated: reach the target state',
        brief:
          `A generated drill, graded by the same simulator as every hand-written challenge. ` +
          `Build a circuit on ${qubits} whose histogram matches the target exactly. ` +
          `It can be done in ${gates}, and that is the par.`,
        hints: [
          `Work bar by bar: which basis states need amplitude, and which must stay empty? ` +
            `The reference solution uses ${gates}.`,
          `The reference solution uses exactly these gates (in some order): ${gateMultiset(solution.ops)}.`,
          `One circuit that works: ${recipe(solution.ops)}.`,
        ],
        successNote:
          `Solved — and verified twice, because this challenge was born from a circuit: the generator ` +
          `built a random ${gates} circuit, simulated it to obtain the target, and confirmed the grader ` +
          `accepts it before showing it to you. Your circuit need not be the same one; any circuit ` +
          `producing the same distribution is exactly as correct, which is worth remembering about ` +
          `quantum circuits in general.`,
        lessonSlug: 'gates-and-circuits',
      }
    case 'target-distribution':
      return {
        title: 'Generated: match the distribution',
        brief:
          `A generated drill, graded by the same simulator as every hand-written challenge. ` +
          `Build a circuit on ${qubits} whose measurement statistics match the target histogram — ` +
          `every bar within tolerance. The reference solution takes ${gates}; rotations are your friend here.`,
        hints: [
          `Uneven bars usually mean a rotation gate: RY(θ) puts sin²(θ/2) of the probability on |1⟩, ` +
            `and the θ slider steps in π/16.`,
          `The reference solution uses exactly these gates (in some order): ${gateMultiset(solution.ops)}.`,
          `One circuit that works: ${recipe(solution.ops)}.`,
        ],
        successNote:
          `Matched. The target was not designed by hand — it is whatever distribution a randomly drawn ` +
          `${gates} circuit produces — but it was verified by execution before you saw it, so "reachable ` +
          `within tolerance" was a fact, not a hope. Note what the tolerance is for: two circuits rarely ` +
          `agree to the last decimal, and measurement statistics never do.`,
        lessonSlug: 'superposition-and-measurement',
      }
    case 'fix-the-bug': {
      const at = broken ? broken.index + 1 : 0
      return {
        title: 'Generated: find the planted bug',
        brief:
          `This circuit was correct until the generator deliberately corrupted exactly one gate — ` +
          `renamed it, moved it, or detuned it. Repair the circuit so its histogram matches the target. ` +
          `Click a placed gate to remove it; rebuilding from scratch is also fair game.`,
        hints: [
          `Exactly one op differs from the correct circuit, and the op count is right. Compare the two ` +
            `histograms and ask which single gate could explain the whole difference.`,
          `The wrong gate is op ${at} of ${n}, reading left to right.`,
          `The correct circuit is: ${recipe(solution.ops)}.`,
        ],
        successNote:
          `Fixed. The bug was planted by a mutation rule — one op replaced, nothing inserted or deleted — ` +
          `which is also roughly how real circuit bugs look: the structure is right, one detail is not. ` +
          `The generator verified both directions before showing you this: the broken circuit fails the ` +
          `grader and the repaired one passes it, so the puzzle was never unsolvable or already solved.`,
        lessonSlug: 'gates-and-circuits',
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// The generator
// ────────────────────────────────────────────────────────────

/**
 * Generate one verified challenge. Deterministic: the same (kind, difficulty,
 * seed) always returns the same challenge, including across retries, because
 * every attempt's RNG is derived from the same three inputs.
 *
 * Throws only when MAX_ATTEMPTS derived draws all fail verification, which
 * indicates a bug in this module rather than bad luck — the test suite runs
 * hundreds of seeds to keep that claim honest.
 */
export function generateChallenge(
  kind: GeneratedKind,
  difficulty: Difficulty,
  seed: number
): GeneratedChallenge {
  const spec = DIFFICULTY[difficulty]
  if (!spec) throw new Error(`difficulty must be 1, 2 or 3, got ${difficulty}`)
  if (!GENERATED_KINDS.includes(kind)) throw new Error(`unknown generated kind: ${kind}`)
  if (!Number.isFinite(seed)) throw new Error(`seed must be a finite number, got ${seed}`)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = mulberry32(fnv1a(`${kind}:${difficulty}:${seed >>> 0}:${attempt}`))
    const solution = randomCircuit(rng, spec)
    const targetProbabilities = simulate(solution).probabilities()

    let startingCircuit: Circuit | undefined
    let mutation: GeneratedChallenge['mutation']
    if (kind === 'fix-the-bug') {
      const injected = injectMutation(rng, solution)
      if (!injected) continue
      startingCircuit = { numQubits: spec.numQubits, ops: injected.ops }
      mutation = { index: injected.index, rule: injected.rule }
    }

    const prose = proseFor(kind, spec, solution, mutation)
    const challenge: GeneratedChallenge = {
      id: `gen-${kind}-d${difficulty}-s${seed >>> 0}`,
      title: prose.title,
      brief: prose.brief,
      kind,
      level: spec.level,
      numQubits: spec.numQubits,
      lessonSlug: prose.lessonSlug,
      startingCircuit,
      targetProbabilities,
      tolerance: kind === 'target-distribution' ? 0.03 : undefined,
      maxGates: solution.ops.length,
      hints: prose.hints,
      successNote: prose.successNote,
      seed: seed >>> 0,
      difficulty,
      referenceSolution: solution,
      mutation,
    }

    // ── THE invariant: verified solvable by execution, or not returned. ──
    if (!verifyByExecution(challenge, solution)) continue
    if (startingCircuit && grade(challenge, startingCircuit).passed) continue

    return challenge
  }

  throw new Error(
    `generateChallenge(${kind}, ${difficulty}, ${seed}) exhausted ${MAX_ATTEMPTS} attempts ` +
      `without a draw that verifies — this is a generator bug, not a bad seed`
  )
}
