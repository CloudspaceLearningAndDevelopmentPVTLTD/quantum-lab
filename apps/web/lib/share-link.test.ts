/**
 * share-link.ts — the permalink a learner sends to someone else.
 *
 * Two things are being proved here, and they are different things:
 *
 *  1. IT WORKS. A circuit encoded on one machine decodes to the same circuit
 *     on another. Sharing is the one feature whose failure mode is invisible
 *     to the person who triggers it — the sender sees a URL, and only the
 *     recipient sees an empty editor.
 *
 *  2. NOTHING PRIVATE RIDES ALONG. The token is asserted to be EXACTLY the
 *     OpenQASM of the circuit and nothing else: no saved-circuit name, no id,
 *     no timestamp, no device or session identifier. That is a property of
 *     `toQasm`, and it is exactly the kind of property that decays quietly the
 *     next time somebody adds a helpful field to the serializer — so it is
 *     checked by decoding the token back to text rather than by reading the
 *     implementation.
 */

import { describe, expect, it } from 'vitest'

import { buildShareUrl, decodeCircuit, encodeCircuit } from '@/lib/share-link'
import { toQasm, type Circuit } from '@/lib/quantum'

const BELL: Circuit = {
  numQubits: 2,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'CX', qubits: [0, 1] },
  ],
}

const PARAMETRISED: Circuit = {
  numQubits: 3,
  ops: [
    { name: 'H', qubits: [0] },
    { name: 'RY', qubits: [1], theta: Math.PI / 4 },
    { name: 'CX', qubits: [1, 2] },
    { name: 'RZ', qubits: [2], theta: -Math.PI / 3 },
    { name: 'X', qubits: [0] },
  ],
}

/** Decode a token back to the QASM text it carries, without the app's parser. */
function tokenText(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

describe('encode → decode', () => {
  it('round-trips a Bell pair exactly', () => {
    const decoded = decodeCircuit(encodeCircuit(BELL))
    expect(decoded).toEqual(BELL)
  })

  it('round-trips rotation angles closely enough to reproduce the physics', () => {
    const decoded = decodeCircuit(encodeCircuit(PARAMETRISED))
    expect(decoded).not.toBeNull()
    expect(decoded?.numQubits).toBe(PARAMETRISED.numQubits)
    expect(decoded?.ops.map((op) => op.name)).toEqual(PARAMETRISED.ops.map((op) => op.name))
    expect(decoded?.ops.map((op) => op.qubits)).toEqual(PARAMETRISED.ops.map((op) => op.qubits))
    for (let i = 0; i < PARAMETRISED.ops.length; i += 1) {
      const original = PARAMETRISED.ops[i].theta
      if (original === undefined) continue
      // Not `toEqual`: the QASM writer emits π fractions and the reader parses
      // them back, so equality here is numeric, not textual.
      expect(decoded?.ops[i].theta).toBeCloseTo(original, 12)
    }
  })

  it('produces a token that survives a URL unescaped', () => {
    const token = encodeCircuit(PARAMETRISED)
    // base64url: no '+', no '/', no '=' padding. A '+' in a query string
    // decodes as a space, which is how a shared link silently loses a gate.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(token)).toBe(token)
  })

  it('returns null rather than throwing on anything unusable', () => {
    expect(decodeCircuit('')).toBeNull()
    expect(decodeCircuit('!!!not base64!!!')).toBeNull()
    // Valid base64, not QASM.
    expect(decodeCircuit(Buffer.from('hello there').toString('base64url'))).toBeNull()
    // Valid QASM with no operations is not worth opening an editor for.
    expect(decodeCircuit(encodeCircuit({ numQubits: 2, ops: [] }))).toBeNull()
  })
})

describe('what the link carries', () => {
  it('carries the circuit QASM and literally nothing else', () => {
    const text = tokenText(encodeCircuit(PARAMETRISED))
    expect(text).toBe(toQasm(PARAMETRISED))
  })

  it('carries no identifier, name, timestamp or origin', () => {
    // A circuit as it exists in the saved-circuits library: the store keeps a
    // name and an id alongside the QASM, and neither may reach the URL.
    const text = tokenText(encodeCircuit(PARAMETRISED)).toLowerCase()
    for (const forbidden of [
      'name',
      'id',
      'user',
      'email',
      'session',
      'token',
      'http',
      'localhost',
      'saved',
      'author',
    ]) {
      expect(text, `share token leaked "${forbidden}"`).not.toContain(forbidden)
    }
    // And no ISO timestamp of any kind.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('buildShareUrl', () => {
  it('builds an absolute /simulator permalink that decodes back', () => {
    const url = buildShareUrl(BELL, 'https://quantum.example')
    expect(url.startsWith('https://quantum.example/simulator?c=')).toBe(true)

    const token = new URL(url).searchParams.get('c') ?? ''
    expect(decodeCircuit(token)).toEqual(BELL)
  })

  it('falls back to a relative URL with no origin and no window', () => {
    // SSR: `window` is undefined in this environment, which is the branch.
    expect(buildShareUrl(BELL).startsWith('/simulator?c=')).toBe(true)
  })
})
