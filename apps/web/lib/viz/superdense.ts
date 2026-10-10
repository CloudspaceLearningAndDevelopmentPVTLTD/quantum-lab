/**
 * superdense.ts — superdense coding, the mirror image of teleportation.
 *
 * Teleportation spends one shared entangled pair and two classical bits to move
 * one qubit. Superdense coding spends one shared entangled pair and one qubit
 * to move two classical bits. Same resource, run backwards.
 *
 * Everything the page claims is computed here from lib/quantum.ts and checked
 * in superdense.test.ts against facts established without this module: the four
 * encoded states are mutually ORTHOGONAL (which is the entire reason two bits
 * fit in one qubit — orthogonal states are perfectly distinguishable), the
 * decoded outcome is the sent message with probability exactly 1, and without
 * the shared pair the four encodings collapse onto two, so at most one bit
 * survives.
 *
 * Qubit roles: q0 is Alice's half and the one that travels; q1 is Bob's half,
 * which never moves and is never touched by Alice.
 */

import { StateVector, outcomeProbabilities, simulate, type Circuit, type GateOp } from '@/lib/quantum'

export const ALICE = 0
export const BOB = 1

/** The four two-bit messages, MSB-first — "10" means bit a = 1, bit b = 0. */
export const MESSAGES = ['00', '01', '10', '11'] as const
export type Message = (typeof MESSAGES)[number]

/**
 * Alice's encoding for message "ab": X to the power a, then Z to the power b,
 * on her half only.
 *
 * The pairing of bit to gate is not arbitrary — it is chosen so that Bob's
 * decoded measurement label reads back the message unchanged, which is what
 * `decodedProbabilities` asserts. X moves the pair between the Φ and Ψ
 * families; Z moves it between + and −. Two independent choices, four states.
 */
export function encodingOps(message: Message): GateOp[] {
  const a = message[0] === '1'
  const b = message[1] === '1'
  const ops: GateOp[] = []
  if (a) ops.push({ name: 'X', qubits: [ALICE] })
  if (b) ops.push({ name: 'Z', qubits: [ALICE] })
  return ops
}

/** Make the shared pair: H on Alice's half, then CX onto Bob's. */
export const PAIR_OPS: readonly GateOp[] = [
  { name: 'H', qubits: [ALICE] },
  { name: 'CX', qubits: [ALICE, BOB] },
] as const

/** Bob's decode: undo the entanglement, then read both qubits. */
export const DECODE_OPS: readonly GateOp[] = [
  { name: 'CX', qubits: [ALICE, BOB] },
  { name: 'H', qubits: [ALICE] },
] as const

export interface SuperdenseOptions {
  message: Message
  /**
   * When false, Alice and Bob never shared a pair — they each start with |0⟩.
   * Alice encodes and sends exactly the same qubit, and Bob runs exactly the
   * same decoder. It does not work, and the way it fails is the lesson.
   */
  entangled?: boolean
}

/** The whole protocol, prep through decode, as one circuit. */
export function superdenseCircuit({ message, entangled = true }: SuperdenseOptions): Circuit {
  return {
    numQubits: 2,
    ops: [
      ...(entangled ? PAIR_OPS : []),
      ...encodingOps(message),
      ...DECODE_OPS,
    ],
  }
}

/** The state on the wire: after Alice encodes, before Bob decodes. */
export function encodedState({ message, entangled = true }: SuperdenseOptions): StateVector {
  return simulate({
    numQubits: 2,
    ops: [...(entangled ? PAIR_OPS : []), ...encodingOps(message)],
  })
}

/**
 * What Bob reads, as a probability per two-bit label (MSB-first, so the key is
 * "q1 q0" — the same convention StateVector.label uses).
 */
export function decodedProbabilities(options: SuperdenseOptions): Record<Message, number> {
  const probs = outcomeProbabilities(superdenseCircuit(options))
  const out = {} as Record<Message, number>
  for (const m of MESSAGES) out[m] = probs[parseInt(m, 2)]
  return out
}

/** |⟨a|b⟩|² between two 2-qubit states. 0 = perfectly distinguishable. */
export function overlap(a: StateVector, b: StateVector): number {
  let re = 0
  let im = 0
  for (let i = 0; i < a.dim; i++) {
    const x = a.amplitude(i)
    const y = b.amplitude(i)
    // ⟨a|b⟩ = Σ conj(a_i) b_i
    re += x.re * y.re + x.im * y.im
    im += x.re * y.im - x.im * y.re
  }
  return re * re + im * im
}

export interface StageDescription {
  id: string
  title: string
  /** Index into the frames array — how many ops have run by the end of the stage. */
  frame: (options: SuperdenseOptions) => number
  narration: string
}

/**
 * The stages the reader steps through. Frame indices are computed rather than
 * hardcoded because the encoding contributes between zero and two ops depending
 * on the message, and the un-entangled variant drops two more.
 */
export const SUPERDENSE_STAGES: readonly StageDescription[] = [
  {
    id: 'start',
    title: 'Start',
    frame: () => 0,
    narration: 'Two qubits in |0⟩. Alice will only ever touch the first one.',
  },
  {
    id: 'share',
    title: 'Share a pair',
    frame: ({ entangled = true }) => (entangled ? 2 : 0),
    narration:
      'A Bell pair is prepared and split, long before Alice knows what she wants to say. This is the resource — it is spent, not copied.',
  },
  {
    id: 'encode',
    title: 'Encode',
    frame: ({ message, entangled = true }) =>
      (entangled ? 2 : 0) + encodingOps(message).length,
    narration:
      'Alice applies one of four operations to her half alone. Her qubit’s own state does not visibly change: the message is written into the correlation, not into the qubit.',
  },
  {
    id: 'send',
    title: 'Send 1 qubit',
    frame: ({ message, entangled = true }) =>
      (entangled ? 2 : 0) + encodingOps(message).length,
    narration:
      'Alice sends that single qubit to Bob. One qubit crosses the channel — and it is carrying two bits.',
  },
  {
    id: 'decode',
    title: 'Decode',
    frame: ({ message, entangled = true }) =>
      (entangled ? 2 : 0) + encodingOps(message).length + DECODE_OPS.length,
    narration:
      'Bob undoes the entanglement with a CX and an H, then measures both qubits. Both bits come out, every time, with no uncertainty at all.',
  },
] as const

/** Per-frame states for the chosen message. */
export function superdenseFrames(options: SuperdenseOptions): StateVector[] {
  const circuit = superdenseCircuit(options)
  const sv = new StateVector(circuit.numQubits)
  const frames = [sv.clone()]
  for (const op of circuit.ops) {
    sv.apply(op)
    frames.push(sv.clone())
  }
  return frames
}

/**
 * How often Bob's decoder returns the message Alice actually sent, averaged
 * over the four equally likely messages.
 *
 * With the shared pair this is exactly 1 — not "almost always", exactly. Take
 * the pair away and it falls to 1/2: one bit out of two, which is all a single
 * qubit is worth by itself. That gap is the value of the entanglement, measured
 * in bits, and it is why the pair is called a resource.
 */
export function decodeSuccess(entangled: boolean): number {
  let total = 0
  for (const message of MESSAGES) {
    total += decodedProbabilities({ message, entangled })[message]
  }
  return total / MESSAGES.length
}
