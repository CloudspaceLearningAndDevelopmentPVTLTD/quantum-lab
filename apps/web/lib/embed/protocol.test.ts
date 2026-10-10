/**
 * protocol.test.ts — the embed's trust boundary, pinned.
 *
 * Three properties matter and each has a section below:
 *
 *  1. THE URL SEAM WORKS: a token produced by the app's own share-link encoder
 *     round-trips through `parseEmbedSearch`, so a /simulator share link can be
 *     pasted into an embed URL unchanged.
 *  2. HOSTILE INPUT DEGRADES, NEVER THROWS: garbage tokens, oversized
 *     payloads, wrong-shaped messages and out-of-bounds circuits all come back
 *     null — the page inside someone else's site must never crash.
 *  3. THE OUTBOUND SHAPE IS CLOSED: `ql:result` carries exactly
 *     {type, counts, shots}. The simulator's RunResult also holds the full
 *     statevector; asserting the KEY SET (not just the values we like) is what
 *     catches the day someone helpfully spreads `...result` into the message.
 */

import { describe, expect, it } from 'vitest'

import {
  EMBED_MAX_QUBITS,
  MAX_INPUT_LENGTH,
  MSG_LOAD,
  MSG_READY,
  MSG_RESULT,
  buildReadyMessage,
  buildResultMessage,
  parseEmbedSearch,
  parseLoadMessage,
} from '@/lib/embed/protocol'
import { encodeCircuit } from '@/lib/share-link'
import { run, toQasm, type Circuit } from '@/lib/quantum'

const BELL: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

describe('parseEmbedSearch', () => {
  it('round-trips a token produced by the share-link encoder', () => {
    const { circuit, readonly } = parseEmbedSearch(`?c=${encodeCircuit(BELL)}`)
    expect(circuit).toEqual(BELL)
    expect(readonly).toBe(false)
  })

  it('accepts the search string with or without the leading "?"', () => {
    const token = encodeCircuit(BELL)
    expect(parseEmbedSearch(`c=${token}`).circuit).toEqual(BELL)
  })

  it('reads readonly=1 and only the exact value "1"', () => {
    const token = encodeCircuit(BELL)
    expect(parseEmbedSearch(`?c=${token}&readonly=1`).readonly).toBe(true)
    expect(parseEmbedSearch(`?c=${token}&readonly=true`).readonly).toBe(false)
  })

  it('returns a null circuit for a missing, malformed or oversized token', () => {
    expect(parseEmbedSearch('').circuit).toBeNull()
    expect(parseEmbedSearch('?c=%%%not-base64%%%').circuit).toBeNull()
    expect(parseEmbedSearch(`?c=${'A'.repeat(MAX_INPUT_LENGTH + 1)}`).circuit).toBeNull()
  })

  it('clamps a circuit wider than the anonymous-tier limit', () => {
    const wide: Circuit = {
      numQubits: EMBED_MAX_QUBITS + 3,
      ops: [
        { name: 'H', qubits: [0] },
        // References a qubit past the clamp, so it must be dropped.
        { name: 'X', qubits: [EMBED_MAX_QUBITS + 1] },
      ],
    }
    const { circuit } = parseEmbedSearch(`?c=${encodeCircuit(wide)}`)
    expect(circuit).not.toBeNull()
    expect(circuit!.numQubits).toBe(EMBED_MAX_QUBITS)
    expect(circuit!.ops).toEqual([{ name: 'H', qubits: [0] }])
  })
})

describe('parseLoadMessage', () => {
  it('parses a well-formed ql:load message', () => {
    const circuit = parseLoadMessage({ type: MSG_LOAD, qasm: toQasm(BELL) })
    expect(circuit).toEqual(BELL)
  })

  it.each([
    ['null', null],
    ['a string', 'ql:load'],
    ['wrong type tag', { type: 'ql:evil', qasm: toQasm(BELL) }],
    ['non-string qasm', { type: MSG_LOAD, qasm: 42 }],
    ['empty qasm', { type: MSG_LOAD, qasm: '' }],
    ['unparseable qasm', { type: MSG_LOAD, qasm: 'OPENQASM 3; not a program' }],
    ['oversized qasm', { type: MSG_LOAD, qasm: 'x'.repeat(MAX_INPUT_LENGTH + 1) }],
  ])('rejects %s without throwing', (_label, payload) => {
    expect(parseLoadMessage(payload)).toBeNull()
  })

  it('clamps loaded circuits to the anonymous-tier qubit limit', () => {
    const wide: Circuit = {
      numQubits: EMBED_MAX_QUBITS + 1,
      ops: [{ name: 'H', qubits: [0] }],
    }
    const circuit = parseLoadMessage({ type: MSG_LOAD, qasm: toQasm(wide) })
    expect(circuit!.numQubits).toBe(EMBED_MAX_QUBITS)
  })

  it('rejects a circuit with no in-bounds ops after clamping', () => {
    const allOut: Circuit = {
      numQubits: EMBED_MAX_QUBITS + 2,
      ops: [{ name: 'H', qubits: [EMBED_MAX_QUBITS + 1] }],
    }
    expect(parseLoadMessage({ type: MSG_LOAD, qasm: toQasm(allOut) })).toBeNull()
  })
})

describe('outbound messages', () => {
  it('ql:result carries EXACTLY {type, counts, shots} — nothing rides along', () => {
    const result = run(BELL, 128, 0, 42)
    const msg = buildResultMessage(result)
    // The key-set assertion is the real test: RunResult also holds the raw
    // statevector and probabilities, and neither may cross the frame boundary
    // implicitly — a host page should get counts because we chose to send
    // counts, not because a spread copied whatever the simulator returns.
    expect(Object.keys(msg).sort()).toEqual(['counts', 'shots', 'type'])
    expect(msg.type).toBe(MSG_RESULT)
    expect(msg.shots).toBe(128)
    expect(Object.values(msg.counts).reduce((a, b) => a + b, 0)).toBe(128)
  })

  it('ql:result counts are a copy, not a live reference into the RunResult', () => {
    const result = run(BELL, 64, 0, 7)
    const msg = buildResultMessage(result)
    expect(msg.counts).not.toBe(result.counts)
    expect(msg.counts).toEqual(result.counts)
  })

  it('ql:ready is the bare handshake', () => {
    expect(buildReadyMessage()).toEqual({ type: MSG_READY })
  })
})
