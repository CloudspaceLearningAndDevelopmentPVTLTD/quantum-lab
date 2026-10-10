/**
 * catalogue.test.ts — every challenge is solvable, at par, by a circuit this
 * file actually builds and runs.
 *
 * The point is not to test the grader (grade.test.ts does that). It is to stop
 * the catalogue drifting into fiction. A par is a promise: "there exists a
 * circuit with this many gates that passes". The only way to keep that promise
 * honest is to write the circuit down and hand it to the real grader, which is
 * what SOLUTIONS below does — one entry per challenge, no exceptions, enforced
 * by a test that fails when a challenge is added without one.
 *
 * Two further invariants are checked because both have bitten this catalogue:
 *
 *  - Any rotation the LEARNER has to place must sit on the π/16 lattice, since
 *    that is the θ slider's step in ChallengeWorkbench. Angles that arrive
 *    pre-placed in `startingCircuit` are exempt — the learner never types them.
 *  - A fix-the-bug challenge's starting circuit must actually be broken. A
 *    "repair" that passes untouched is not a challenge.
 */

import { describe, expect, it } from 'vitest'

import { CHALLENGES, getChallenge } from './catalogue'
import { grade, gateCount } from './grade'
import type { Challenge } from './types'
import { simulate, type Circuit, type GateOp } from '@/lib/quantum'

// ── Small builders, so a solution reads like the circuit a learner draws ──

const g = (name: GateOp['name'], qubits: number[], theta?: number): GateOp =>
  theta === undefined ? { name, qubits } : { name, qubits, theta }

const H = (q: number) => g('H', [q])
const X = (q: number) => g('X', [q])
const Z = (q: number) => g('Z', [q])
const S = (q: number) => g('S', [q])
const CX = (c: number, t: number) => g('CX', [c, t])
const CZ = (a: number, b: number) => g('CZ', [a, b])
const CCX = (a: number, b: number, t: number) => g('CCX', [a, b, t])
const SWAP = (a: number, b: number) => g('SWAP', [a, b])
const RY = (q: number, theta: number) => g('RY', [q], theta)

/** A CCZ, which the palette does not have: H on the target, CCX, H back. */
const CCZ = (a: number, b: number, t: number): GateOp[] => [H(t), CCX(a, b, t), H(t)]

/** The ops a fix-the-bug challenge starts the learner with. */
function starting(challenge: Challenge): GateOp[] {
  return (challenge.startingCircuit?.ops ?? []).map((op) => ({ ...op }))
}

function circuit(challenge: Challenge, ops: GateOp[]): Circuit {
  return { numQubits: challenge.numQubits, ops }
}

/**
 * One reference solution per challenge, expressed the way a learner would build
 * it: challenges with a starting circuit begin from that circuit, exactly as
 * the workbench does.
 */
const SOLUTIONS: Record<string, (ch: Challenge) => GateOp[]> = {
  'flip-it': () => [X(0)],
  'fair-coin': () => [H(0)],
  'label-the-register': () => [X(0), X(2)],
  'bell-pair': () => [H(0), CX(0, 1)],
  'psi-plus': () => [H(0), CX(0, 1), X(1)],
  'uniform-three': () => [H(0), H(1), H(2)],

  // The repair is a deletion: drop the stray Z from H·Z·H.
  'undo-the-hadamard': (ch) => starting(ch).filter((op) => op.name !== 'Z'),
  // The gates were right, the order was not.
  'broken-cnot': () => [H(0), CX(0, 1)],
  'ghz-three': () => [H(0), CX(0, 1), CX(1, 2)],
  'tilt-the-coin': () => [RY(0, Math.PI / 4)],
  'minus-sign': () => [H(0), Z(0)],
  // Starts as H·S (|+i⟩); another quarter turn about Z lands on |−⟩, then H.
  'read-the-y-axis': (ch) => [...starting(ch), S(0), H(0)],
  'phase-kickback': () => [H(0), X(1), H(1), CX(0, 1)],
  'deutsch-one-query': () => [H(0), X(1), H(1), CX(0, 1), H(0)],
  'route-the-pair': () => [H(0), CX(0, 1), CX(1, 2), CX(2, 1), CX(1, 2)],

  'gate-golf-top-two': () => [H(1), CX(1, 2)],
  'mark-the-state': () => [H(0), H(1), CZ(0, 1)],
  'uncompute-the-ancilla': () => [H(0), H(1), X(2), H(2), CCX(0, 1, 2), H(2), X(2)],
  'w-state-repair': (ch) => [...starting(ch), CX(2, 1)],
  'qft-two-qubit': (ch) => [...starting(ch), SWAP(0, 1)],
  'teleport-the-state': (ch) => [...starting(ch), CX(1, 2), CZ(0, 2)],
  // CCZ marks |111⟩; the X sandwich on q1 relabels |101⟩ into its reach.
  'mark-one-of-eight': () => [H(0), H(1), H(2), X(1), ...CCZ(0, 1, 2), X(1)],
  // Two CXs into one |−⟩ ancilla kick back (−1)^(q0⊕q1).
  'parity-kickback': () => [H(0), H(1), X(2), H(2), CX(0, 2), CX(1, 2)],
  // Two CNOTs move half a Bell pair onto a known |0⟩ — one cheaper than SWAP.
  'golf-move-the-pair': (ch) => [...starting(ch), CX(1, 2), CX(2, 1)],
  'golf-odd-one-out': () => [H(0), CX(0, 1), CX(0, 2), X(2)],
  // The repair swaps the two correction conditions back: X follows q1, Z follows q0.
  'teleport-crossed-wires': (ch) => [
    ...starting(ch).slice(0, -2),
    CX(1, 2),
    CZ(0, 2),
  ],
  // S†·Z = S; the CZ conjugated through the trailing H(0) and SWAP is CX(0→1).
  'qft-wrong-way-round': (ch) => [...starting(ch), CX(0, 1)],
  // RY(3π/8) ≈ 1/3 on q0; anti-controlled RY(π/2) splits the rest; the CCX
  // block excites q2 exactly when neither other qubit did. All angles are on
  // the π/16 slider lattice — that approximability is the challenge's point.
  'w-state-from-scratch': () => [
    RY(0, (3 * Math.PI) / 8),
    X(0),
    RY(1, Math.PI / 4),
    CX(0, 1),
    RY(1, (7 * Math.PI) / 4),
    CX(0, 1),
    X(1),
    CCX(0, 1, 2),
    X(1),
    X(0),
  ],
  // The Bell measurement: un-CX, then H, and Φ− reads out as |01⟩ exactly.
  'read-the-phase-bit': (ch) => [...starting(ch), CX(0, 1), H(0)],
  'grover-one-iteration': () => [
    H(0), H(1), H(2),
    ...CCZ(0, 1, 2), // oracle: sign-flip |111⟩
    H(0), H(1), H(2),
    X(0), X(1), X(2),
    ...CCZ(0, 1, 2), // diffusion: sign-flip everything but |000⟩
    X(0), X(1), X(2),
    H(0), H(1), H(2),
  ],
}

const PI_16 = Math.PI / 16

/** True when θ is a whole number of π/16 steps — what the workbench slider can express. */
function onSliderLattice(theta: number): boolean {
  const steps = theta / PI_16
  return Math.abs(steps - Math.round(steps)) < 1e-9
}

describe('challenge catalogue', () => {
  it('has unique ids and getChallenge finds each one', () => {
    const ids = CHALLENGES.map((ch) => ch.id)
    expect(new Set(ids).size, 'duplicate challenge id').toBe(ids.length)
    for (const id of ids) expect(getChallenge(id)?.id).toBe(id)
  })

  it('ramps: the first challenges are Beginner and the levels never go backwards', () => {
    const rank = { Beginner: 0, Intermediate: 1, Advanced: 2 } as const
    const levels = CHALLENGES.map((ch) => rank[ch.level])
    expect(levels.slice(0, 3), 'a newcomer must be able to start').toEqual([0, 0, 0])
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i], `${CHALLENGES[i].id} is easier than the one before it`).toBeGreaterThanOrEqual(
        levels[i - 1]
      )
    }
  })

  it('covers ground: every kind is used, and the register sizes vary', () => {
    const kinds = new Set(CHALLENGES.map((ch) => ch.kind))
    expect(kinds).toEqual(
      new Set(['target-state', 'target-distribution', 'gate-golf', 'fix-the-bug', 'oracle'])
    )
    expect(new Set(CHALLENGES.map((ch) => ch.numQubits))).toEqual(new Set([1, 2, 3]))
  })

  it('every challenge is well formed', () => {
    for (const ch of CHALLENGES) {
      expect(ch.targetProbabilities, `${ch.id} has no target`).toBeDefined()
      const target = ch.targetProbabilities as number[]
      expect(target.length, `${ch.id} target is the wrong width`).toBe(1 << ch.numQubits)

      const total = target.reduce((a, b) => a + b, 0)
      expect(Math.abs(total - 1), `${ch.id} target does not sum to 1`).toBeLessThan(0.005)

      // Hints reveal strategy before syntax, so there must be more than one.
      expect(ch.hints.length, `${ch.id} needs staged hints`).toBeGreaterThanOrEqual(2)
      expect(ch.brief.length, `${ch.id} brief is too thin to act on`).toBeGreaterThan(80)
      expect(ch.successNote.length).toBeGreaterThan(80)

      expect(ch.maxGates, `${ch.id} has no par`).toBeDefined()
      expect(ch.maxGates).toBeGreaterThan(0)

      if (ch.kind === 'oracle') {
        expect(ch.targetSigns, `${ch.id} is an oracle with no target signs`).toHaveLength(
          1 << ch.numQubits
        )
      }
      if (ch.kind === 'fix-the-bug') {
        expect(ch.startingCircuit, `${ch.id} is a repair with nothing to repair`).toBeDefined()
      }
      if (ch.startingCircuit) {
        expect(ch.startingCircuit.numQubits).toBe(ch.numQubits)
      }
    }
  })

  it('a starting circuit never already passes', () => {
    for (const ch of CHALLENGES) {
      if (!ch.startingCircuit) continue
      const verdict = grade(ch, circuit(ch, starting(ch)))
      expect(verdict.passed, `${ch.id} is solved before the learner touches it`).toBe(false)
    }
  })

  /**
   * The workbench can only APPEND. `CircuitGrid` builds every placement as
   * `ops: [...circuit.ops, op]` — there is no insert-at-column — and the only
   * other edit is removing an op by index. So a pre-placed starting circuit is
   * a hard constraint on the solution's SHAPE, not just its contents:
   *
   *   · if the brief tells the learner to keep the pre-placed gates (any kind
   *     other than fix-the-bug), the solution must be those ops followed by the
   *     learner's, in that order;
   *   · only a fix-the-bug challenge may require deleting or reordering them,
   *     because only those briefs tell the learner to.
   *
   * `deutsch-one-query` violated this: it pre-placed the oracle CX, told the
   * learner "leave the CX where it is", and then needed three gates in FRONT of
   * it. The reference solution prepended, which no user can do, so the suite
   * was green on a challenge nobody could finish.
   */
  it('a kept starting circuit is a prefix of its solution — the editor only appends', () => {
    for (const ch of CHALLENGES) {
      if (!ch.startingCircuit || ch.kind === 'fix-the-bug') continue
      const head = starting(ch)
      const ops = SOLUTIONS[ch.id](ch)
      expect(
        JSON.stringify(ops.slice(0, head.length)),
        `${ch.id}: the solution does not begin with the gates the learner is told to keep, ` +
          'so it can only be built by deleting them — which the brief forbids'
      ).toBe(JSON.stringify(head))
    }
  })

  it('has a reference solution for every challenge', () => {
    expect(Object.keys(SOLUTIONS).sort()).toEqual(CHALLENGES.map((ch) => ch.id).sort())
  })

  describe.each(CHALLENGES.map((ch) => [ch.id, ch] as const))('%s', (_id, ch) => {
    const ops = SOLUTIONS[ch.id](ch)
    const solution = circuit(ch, ops)

    it('the reference solution passes the real grader', () => {
      const verdict = grade(ch, solution)
      expect(
        verdict.passed,
        `${ch.id} failed: ${verdict.summary} — ${verdict.checks
          .filter((c) => !c.passed)
          .map((c) => c.detail)
          .join(' | ')}`
      ).toBe(true)
      expect(verdict.score).toBe(1)
    })

    it('the reference solution is within par', () => {
      expect(gateCount(solution), `${ch.id} par is unreachable`).toBeLessThanOrEqual(
        ch.maxGates as number
      )
    })

    it('every angle the learner must place is on the π/16 slider lattice', () => {
      const preplaced = new Set(
        starting(ch).map((op) => `${op.name}:${op.qubits.join(',')}:${op.theta ?? 0}`)
      )
      for (const op of ops) {
        if (op.theta === undefined) continue
        if (preplaced.has(`${op.name}:${op.qubits.join(',')}:${op.theta}`)) continue
        expect(
          onSliderLattice(op.theta),
          `${ch.id} asks the learner to place ${op.name}(${op.theta}), which the θ slider cannot reach`
        ).toBe(true)
      }
    })

    it('the target is the distribution the reference solution actually produces', () => {
      const probabilities = simulate(solution).probabilities()
      const target = ch.targetProbabilities as number[]
      for (let i = 0; i < target.length; i += 1) {
        expect(
          Math.abs(probabilities[i] - target[i]),
          `${ch.id} basis state ${i} is off`
        ).toBeLessThanOrEqual(ch.tolerance ?? 0.02)
      }
    })
  })

  it('an empty circuit fails every challenge, and says something useful about why', () => {
    for (const ch of CHALLENGES) {
      const verdict = grade(ch, circuit(ch, []))
      // |0…0⟩ genuinely is the target of "undo the Hadamard" — that one starts
      // from a broken circuit, so an empty editor is not a legitimate answer to
      // it in the UI, but it is a legitimate STATE. Everything else must fail.
      if (ch.id === 'undo-the-hadamard') continue
      expect(verdict.passed, `${ch.id} passes with an empty circuit`).toBe(false)
      expect(verdict.summary.length).toBeGreaterThan(10)
      expect(verdict.checks.some((c) => !c.passed)).toBe(true)
    }
  })

  it('an oracle with the right histogram and the wrong sign fails on the phase, not the bars', () => {
    // H·H on both wires: uniform 25% everywhere, no sign flip anywhere. This is
    // the near-miss the oracle kind exists to catch, and the verdict has to say
    // which basis state and why rather than "wrong".
    const ch = getChallenge('mark-the-state')!
    const verdict = grade(ch, circuit(ch, [H(0), H(1)]))
    expect(verdict.passed).toBe(false)
    const distribution = verdict.checks.find((c) => c.label === 'Output distribution')!
    const phases = verdict.checks.find((c) => c.label === 'Relative phases')!
    expect(distribution.passed, 'the histogram is genuinely correct here').toBe(true)
    expect(phases.passed).toBe(false)
    expect(phases.detail).toContain('|11⟩')
    expect(verdict.summary).toMatch(/phase/i)
  })

  it('the advanced oracles also fail their sign-free near-miss', () => {
    // Same trap as mark-the-state, at three qubits: the exact target histogram
    // with no phase structure must fail on phases, not bars.
    const marked = getChallenge('mark-one-of-eight')!
    let verdict = grade(marked, circuit(marked, [H(0), H(1), H(2)]))
    expect(verdict.passed).toBe(false)
    expect(verdict.checks.find((c) => c.label === 'Output distribution')?.passed).toBe(true)
    expect(verdict.checks.find((c) => c.label === 'Relative phases')?.passed).toBe(false)

    // Preparing the registers and the |−⟩ ancilla but never firing the CXs
    // reproduces the histogram exactly — the ancilla's own minus is there, the
    // parity kickback is not.
    const parity = getChallenge('parity-kickback')!
    verdict = grade(parity, circuit(parity, [H(0), H(1), X(2), H(2)]))
    expect(verdict.passed).toBe(false)
    expect(verdict.checks.find((c) => c.label === 'Output distribution')?.passed).toBe(true)
    expect(verdict.checks.find((c) => c.label === 'Relative phases')?.passed).toBe(false)
  })

  it('a circuit on the wrong number of wires is rejected before it is simulated', () => {
    const ch = getChallenge('bell-pair')!
    const verdict = grade(ch, { numQubits: 3, ops: [H(0), CX(0, 1)] })
    expect(verdict.passed).toBe(false)
    expect(verdict.checks[0].detail).toContain('2 qubits')
  })
})
