/**
 * teleportation.ts — the teleportation protocol as data, not as a drawing.
 *
 * Every number the /visualizations/teleportation page shows comes from here,
 * and everything here comes from lib/quantum.ts's classical-control engine:
 * the circuit really measures, the corrections really are conditioned on the
 * measured bits, and the four Bell outcomes really are enumerated with their
 * exact probabilities rather than asserted to be a quarter each.
 *
 * The one claim the page exists to make — that the two classical bits are not
 * decoration — is checked in teleportation.test.ts against results computed
 * independently of this module: Bob's Bloch vector after correction equals
 * (sinθcosφ, sinθsinφ, cosθ), the textbook vector for the state Alice put in,
 * and the four uncorrected branches average to the zero vector, which is
 * exactly the statement that Bob learns nothing until the bits arrive.
 *
 * Qubit roles, fixed everywhere in this module and on the page:
 *   q0  the payload — the unknown state Alice wants to send
 *   q1  Alice's half of the entangled pair
 *   q2  Bob's half. This is the qubit that ends up holding the payload.
 * Classical bits: c0 from measuring q0, c1 from measuring q1.
 */

import {
  execute,
  outcomeBranches,
  StateVector,
  type Circuit,
  type GateOp,
  type OutcomeBranch,
} from '@/lib/quantum'

export const PAYLOAD = 0
export const ALICE = 1
export const BOB = 2

export type Vec3 = { x: number; y: number; z: number }

/**
 * The Bloch vector of cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩, from the textbook
 * formula rather than from the simulator. The tests compare the simulator's
 * answer against this; the page uses it to draw the "what Alice sent" arrow
 * beside the "what Bob received" one so a mismatch would be visible, not just
 * assertable.
 */
export function blochOf(theta: number, phi: number): Vec3 {
  return {
    x: Math.sin(theta) * Math.cos(phi),
    y: Math.sin(theta) * Math.sin(phi),
    z: Math.cos(theta),
  }
}

/** Distance between two Bloch vectors — 0 means the states are identical. */
export function blochDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Fidelity between a pure single-qubit state and the reduced state of a qubit
 * with Bloch vector `r`: F = (1 + a·r) / 2 for unit `a`.
 *
 * Written in terms of Bloch vectors because that is what both sides of the
 * comparison actually are — Alice's input is pure, Bob's qubit may not be, and
 * this formula is right in both cases (it drops to 1/2, not to something
 * undefined, when Bob's vector is the zero vector of a maximally mixed state).
 */
export function blochFidelity(pure: Vec3, r: Vec3): number {
  const dot = pure.x * r.x + pure.y * r.y + pure.z * r.z
  return Math.min(1, Math.max(0, (1 + dot) / 2))
}

/** Preparation of the payload qubit: RY(θ) then RZ(φ). */
export function preparationOps(theta: number, phi: number): GateOp[] {
  return [
    { name: 'RY', qubits: [PAYLOAD], theta },
    { name: 'RZ', qubits: [PAYLOAD], theta: phi },
  ]
}

export interface TeleportOptions {
  theta: number
  phi: number
  /**
   * When false the conditional corrections are left out entirely — the circuit
   * that "teleports" without using the classical bits. It is the control
   * experiment, and it fails.
   */
  correct?: boolean
}

/**
 * The full protocol as a circuit.
 *
 * Op indices are load-bearing: STAGES below indexes into the frames this
 * circuit produces, so if you add an op, fix the stage frames with it.
 *
 *   0 RY(θ) q0      1 RZ(φ) q0        prepare the payload
 *   2 H q1          3 CX q1,q2        share a Bell pair
 *   4 CX q0,q1      5 H q0            rotate into the Bell basis
 *   6 measure q0→c0 7 measure q1→c1   Alice measures. Both halves collapse.
 *   8 if c1: X q2   9 if c0: Z q2     Bob corrects, once the bits arrive.
 */
export function teleportCircuit({ theta, phi, correct = true }: TeleportOptions): Circuit {
  const ops: GateOp[] = [
    ...preparationOps(theta, phi),
    { name: 'H', qubits: [ALICE] },
    { name: 'CX', qubits: [ALICE, BOB] },
    { name: 'CX', qubits: [PAYLOAD, ALICE] },
    { name: 'H', qubits: [PAYLOAD] },
    { name: 'MEASURE', qubits: [PAYLOAD], clbit: 0 },
    { name: 'MEASURE', qubits: [ALICE], clbit: 1 },
  ]
  if (correct) {
    ops.push({ name: 'X', qubits: [BOB], condition: { bit: 1, value: 1 } })
    ops.push({ name: 'Z', qubits: [BOB], condition: { bit: 0, value: 1 } })
  }
  return { numQubits: 3, numClbits: 2, ops }
}

/** A single qubit prepared in the payload state — the reference Alice sent. */
export function payloadState(theta: number, phi: number): StateVector {
  const sv = new StateVector(1)
  sv.applySingle('RY', 0, theta)
  sv.applySingle('RZ', 0, phi)
  return sv
}

export interface TeleportStage {
  id: string
  /** Short title for the stepper control. */
  title: string
  /**
   * Index into the frames array from `teleportFrames` — i.e. how many ops have
   * run by the end of this stage.
   */
  frame: number
  /** Whether Alice's two bits are in flight or have arrived, for the animation. */
  channel: 'idle' | 'flying' | 'arrived'
  /** One sentence: what just happened, in the reader's terms. */
  narration: string
}

/**
 * The protocol as the reader walks it.
 *
 * Note that "send the bits" and "Alice measures" share a frame. That is not an
 * oversight — it is the whole point. Nothing happens to any qubit while the two
 * classical bits travel; Bob's qubit sits in the same state it was in before,
 * and it stays there however long the message takes to arrive.
 */
export const TELEPORT_STAGES: readonly TeleportStage[] = [
  {
    id: 'start',
    title: 'Start',
    frame: 0,
    channel: 'idle',
    narration:
      'Three qubits, all in |0⟩. Alice holds the first two, Bob holds the third — and Bob may be anywhere.',
  },
  {
    id: 'prepare',
    title: 'Prepare',
    frame: 2,
    channel: 'idle',
    narration:
      'Alice prepares the payload. She is not allowed to look at it: measuring it now would destroy exactly the thing she is trying to send.',
  },
  {
    id: 'entangle',
    title: 'Entangle',
    frame: 4,
    channel: 'idle',
    narration:
      'A Bell pair is made and split: Alice keeps q1, Bob takes q2. Bob’s qubit alone is now maximally mixed — its Bloch arrow has no length at all.',
  },
  {
    id: 'bell',
    title: 'Bell basis',
    frame: 6,
    channel: 'idle',
    narration:
      'CX then H rotates Alice’s two qubits so that a plain computational measurement reads out which of the four Bell states they are in.',
  },
  {
    id: 'measure',
    title: 'Measure',
    frame: 8,
    channel: 'idle',
    narration:
      'Alice measures. The payload is gone — irreversibly — and all she has left is two random-looking bits. Bob’s qubit has changed, but he cannot tell: he still sees a coin flip.',
  },
  {
    id: 'send',
    title: 'Send 2 bits',
    frame: 8,
    channel: 'flying',
    narration:
      'The two bits travel down an ordinary channel at ordinary speed. Nothing about Bob’s qubit changes while they are in flight — this is where the protocol waits, and why nothing outruns light.',
  },
  {
    id: 'correct',
    title: 'Correct',
    frame: 10,
    channel: 'arrived',
    narration:
      'Bob applies X if c1 was 1, then Z if c0 was 1. His qubit is now exactly the state Alice prepared — same length, same direction, no copy left behind.',
  },
] as const

/**
 * Per-frame states for one chosen Bell outcome.
 *
 * `forced` pins which of the four results Alice got, so the reader can watch a
 * specific branch rather than being handed a random one on every re-render.
 * The frames before the measurement are identical in all four branches, which
 * is worth noticing: the choice only matters from the collapse onward.
 */
export function teleportFrames(
  options: TeleportOptions,
  forced: { c0: 0 | 1; c1: 0 | 1 }
): StateVector[] {
  const result = execute(teleportCircuit(options), {
    forceOutcomes: { 0: forced.c0, 1: forced.c1 },
    collectFrames: true,
  })
  return result.frames ?? [result.state]
}

export interface TeleportBranch {
  /** "c1 c0", MSB-first, matching the label convention for qubits. */
  label: string
  c0: 0 | 1
  c1: 0 | 1
  probability: number
  /** Bob's Bloch vector at the end of this branch. */
  bob: Vec3
  /** The correction Bob has to apply on this branch, as a readable string. */
  correction: string
}

const CORRECTION = ['identity — nothing to do', 'Z', 'X', 'X then Z']

/**
 * All four Bell outcomes with their exact probabilities and Bob's resulting
 * state. Exact, not sampled: this comes from outcomeBranches(), which walks
 * both sides of every measurement.
 */
export function teleportBranches(options: TeleportOptions): TeleportBranch[] {
  const branches: OutcomeBranch[] = outcomeBranches(teleportCircuit(options))
  return branches
    .map((b) => {
      const c0 = (b.clbits[0] ?? 0) as 0 | 1
      const c1 = (b.clbits[1] ?? 0) as 0 | 1
      return {
        label: `${c1}${c0}`,
        c0,
        c1,
        probability: b.probability,
        bob: b.state.blochVector(BOB),
        correction: CORRECTION[c1 * 2 + c0],
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The average of Bob's Bloch vector over the branches, weighted by their
 * probabilities — i.e. what Bob's qubit looks like to someone who has not
 * received the classical bits and so cannot tell which branch he is in.
 *
 * With the corrections applied this is the payload vector. Without them it is
 * the zero vector: no information, no signal, nothing to measure.
 */
export function averageBobVector(branches: readonly TeleportBranch[]): Vec3 {
  return branches.reduce<Vec3>(
    (acc, b) => ({
      x: acc.x + b.probability * b.bob.x,
      y: acc.y + b.probability * b.bob.y,
      z: acc.z + b.probability * b.bob.z,
    }),
    { x: 0, y: 0, z: 0 }
  )
}

/** Length of a Bloch vector: 1 for a pure state, 0 for a maximally mixed one. */
export function blochLength(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

/** A few named states worth teleporting, as (θ, φ) in radians. */
export const PRESET_STATES: readonly { id: string; label: string; theta: number; phi: number }[] = [
  { id: 'zero', label: '|0⟩', theta: 0, phi: 0 },
  { id: 'one', label: '|1⟩', theta: Math.PI, phi: 0 },
  { id: 'plus', label: '|+⟩', theta: Math.PI / 2, phi: 0 },
  { id: 'minus', label: '|−⟩', theta: Math.PI / 2, phi: Math.PI },
  { id: 'plus-i', label: '|+i⟩', theta: Math.PI / 2, phi: Math.PI / 2 },
  { id: 'odd', label: 'an odd one', theta: 1.1, phi: 2.3 },
] as const
