/**
 * superdense.test.ts — do two classical bits really fit in one qubit?
 *
 * The assertions are against facts established outside this module:
 *
 *  - The four encoded states must be MUTUALLY ORTHOGONAL. That is not a
 *    property of our code, it is the reason the protocol works at all: only
 *    orthogonal states can be told apart with certainty by any measurement.
 *  - Bob's decoded label must equal the message with probability exactly 1.
 *  - Take the shared pair away and the four encodings must collapse onto two
 *    (Alice cannot touch Bob's qubit, so a Z on |0⟩ does nothing), leaving at
 *    most one bit — which is precisely what one qubit is worth alone.
 */

import { describe, it, expect } from 'vitest'
import {
  ALICE,
  BOB,
  DECODE_OPS,
  MESSAGES,
  PAIR_OPS,
  SUPERDENSE_STAGES,
  decodeSuccess,
  decodedProbabilities,
  encodedState,
  encodingOps,
  overlap,
  superdenseCircuit,
  superdenseFrames,
} from './superdense'
import { simulate } from '@/lib/quantum'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { VISUALIZATIONS } from '@/lib/visualizations'

const near = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('the encoding', () => {
  it('touches only Alice’s qubit', () => {
    for (const message of MESSAGES) {
      for (const op of encodingOps(message)) expect(op.qubits).toEqual([ALICE])
    }
  })

  it('leaves Alice’s own qubit looking identical in all four cases', () => {
    // The message is not written into her qubit — it is written into the
    // correlation. Her reduced state stays maximally mixed whatever she sends,
    // which is why intercepting her qubit alone reveals nothing.
    for (const message of MESSAGES) {
      const v = encodedState({ message }).blochVector(ALICE)
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-12)
    }
  })

  it('never touches Bob’s half, which stays maximally mixed too', () => {
    for (const message of MESSAGES) {
      const v = encodedState({ message }).blochVector(BOB)
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1e-12)
    }
  })

  it('produces four mutually orthogonal states — the four Bell states', () => {
    const states = MESSAGES.map((message) => encodedState({ message }))
    for (let i = 0; i < states.length; i++) {
      near(overlap(states[i], states[i]), 1, 1e-12)
      for (let j = i + 1; j < states.length; j++) {
        expect(overlap(states[i], states[j])).toBeLessThan(1e-24)
      }
    }
  })
})

describe('the decoding', () => {
  it('returns the message with probability exactly one', () => {
    for (const message of MESSAGES) {
      const probs = decodedProbabilities({ message })
      near(probs[message], 1, 1e-12)
      for (const other of MESSAGES) {
        if (other !== message) expect(probs[other]).toBeLessThan(1e-24)
      }
    }
    near(decodeSuccess(true), 1, 1e-12)
  })

  it('is a plain unitary circuit — no measurement branching needed', () => {
    for (const message of MESSAGES) {
      const circuit = superdenseCircuit({ message })
      // Two prep ops, up to two encode ops, two decode ops.
      expect(circuit.ops.length).toBe(4 + encodingOps(message).length)
      const p = simulate(circuit).probabilities()
      near(p[parseInt(message, 2)], 1, 1e-12)
    }
  })

  it('is exactly the preparation run backwards', () => {
    // CX then H undoes H then CX only because the order reverses. Stating it as
    // a test because getting it wrong produces a decoder that still works for
    // two of the four messages, which is the kind of bug a demo hides.
    expect(DECODE_OPS.map((o) => o.name)).toEqual([...PAIR_OPS].reverse().map((o) => o.name))
  })
})

describe('without the shared pair', () => {
  it('the four encodings collapse onto two', () => {
    const states = MESSAGES.map((message) => encodedState({ message, entangled: false }))
    // "00" and "01" differ only by a Z acting on |0⟩, which does nothing;
    // "10" and "11" differ only by a Z acting on |1⟩, which is a global phase.
    near(overlap(states[0], states[1]), 1, 1e-12)
    near(overlap(states[2], states[3]), 1, 1e-12)
    // The two families are still distinguishable from each other — one bit.
    expect(overlap(states[0], states[2])).toBeLessThan(1e-24)
  })

  it('halves what gets through: one bit, not two', () => {
    near(decodeSuccess(false), 0.5, 1e-12)
    for (const message of MESSAGES) {
      const probs = decodedProbabilities({ message, entangled: false })
      near(probs[message], 0.5, 1e-12)
      // The uncertainty is a clean coin flip between two labels, not a smear.
      expect(MESSAGES.filter((m) => probs[m] > 1e-9)).toHaveLength(2)
    }
  })

  it('the surviving bit is the one Alice wrote with X, not with Z', () => {
    // Z acts trivially on |0⟩, so the phase bit is the one that is lost. That
    // is the concrete reason the pair matters: entanglement is what turns a
    // relative phase into something measurable.
    for (const message of MESSAGES) {
      const probs = decodedProbabilities({ message, entangled: false })
      const readable = MESSAGES.filter((m) => probs[m] > 1e-9)
      // Both surviving labels agree on the first bit — Alice's X bit.
      expect(new Set(readable.map((m) => m[0])).size).toBe(1)
      expect(readable[0][0]).toBe(message[0])
    }
  })
})

describe('the stage model matches the circuit', () => {
  it('every stage frame indexes a real frame, for every message and both variants', () => {
    for (const entangled of [true, false]) {
      for (const message of MESSAGES) {
        const options = { message, entangled }
        const frames = superdenseFrames(options)
        expect(frames).toHaveLength(superdenseCircuit(options).ops.length + 1)
        for (const stage of SUPERDENSE_STAGES) {
          expect(stage.frame(options)).toBeGreaterThanOrEqual(0)
          expect(stage.frame(options)).toBeLessThan(frames.length)
        }
      }
    }
  })

  it('sending the qubit changes nothing — the transit stage shares its frame', () => {
    const options = { message: MESSAGES[3] }
    const encode = SUPERDENSE_STAGES.find((s) => s.id === 'encode')!
    const send = SUPERDENSE_STAGES.find((s) => s.id === 'send')!
    expect(send.frame(options)).toBe(encode.frame(options))
  })

  it('stages only ever move forward', () => {
    for (const message of MESSAGES) {
      const frames = SUPERDENSE_STAGES.map((s) => s.frame({ message }))
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1])
      }
    }
  })
})

describe('the page is registered', () => {
  const HREF = '/visualizations/superdense-coding'

  it('appears in the catalogue with the right shape', () => {
    const entry = VISUALIZATIONS.find((v) => v.href === HREF)
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('Intermediate')
    expect(entry?.accent).toBe('amber')
    expect(entry?.title).toBe('Superdense Coding')
    expect(entry?.hook.length).toBeGreaterThan(30)
  })

  it('has the three files a visualization route needs', () => {
    for (const file of ['page.tsx', 'layout.tsx', 'opengraph-image.tsx']) {
      expect(existsSync(resolve(__dirname, '../../app', HREF.slice(1), file))).toBe(true)
    }
  })
})
