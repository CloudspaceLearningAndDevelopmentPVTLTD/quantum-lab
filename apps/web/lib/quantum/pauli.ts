/**
 * Exact Pauli-sum expectation values and statevector downloads for researchers.
 *
 * The hardware page already lets a researcher submit observables to a QPU,
 * where ⟨P⟩ comes back as a shot estimate. The simulator holds the exact state,
 * so it can answer the same question with no sampling error — and with the
 * exact numbers downloadable, a result can be checked in NumPy/Qiskit without
 * re-running anything. Verified against Qiskit's SparsePauliOp and Statevector
 * (see services/api/tests/test_js_extended_crosscheck.py for the engine itself).
 *
 * Conventions, the same as everywhere else in lib/quantum:
 *  - qubit 0 is the LEAST significant bit of a basis index;
 *  - a full-width label such as "XZI" is read like Qiskit's: the RIGHTMOST
 *    character acts on qubit 0, so "XZI" is X on qubit 2 and Z on qubit 1.
 */

import type { Complex, StateVector } from '../quantum'

export interface PauliTerm {
  coefficient: number
  /** Qubit → 'X' | 'Y' | 'Z'. Absent qubits carry the identity. */
  ops: Record<number, 'X' | 'Y' | 'Z'>
}

export type ParseResult =
  | { ok: true; terms: PauliTerm[] }
  | { ok: false; error: string }

/** Bounds: the input is user-typed, so it must not be a way to stall the page. */
export const MAX_TERMS = 256
const MAX_INPUT = 20_000

/**
 * Parse a Pauli sum. Accepted forms, mixable within one sum:
 *   "Z0 Z1"            sparse factors (qubit index after the letter)
 *   "0.5*X0X1 - 0.3 Y2" coefficients, + and −, optional '*'
 *   "ZZI"              a full-width label, rightmost character = qubit 0
 *   "I" / "1"          the identity
 */
export function parsePauliSum(text: string, numQubits: number): ParseResult {
  const src = text.trim()
  if (!src) return { ok: false, error: 'Enter an observable, e.g. Z0 Z1 or 0.5*X0X1 - Y2' }
  if (src.length > MAX_INPUT) return { ok: false, error: 'Observable is too long' }

  // Split into signed terms at top-level + / − that are not part of a number's exponent.
  const pieces: string[] = []
  let current = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const prev = src.slice(0, i).trimEnd().slice(-1)
    const isExponentSign = (ch === '+' || ch === '-') && /[eE]/.test(prev) && /\d/.test(src.slice(0, i).trimEnd().slice(-2, -1))
    if ((ch === '+' || ch === '-') && !isExponentSign && current.trim() !== '') {
      pieces.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  if (current.trim()) pieces.push(current)
  if (pieces.length > MAX_TERMS) return { ok: false, error: `At most ${MAX_TERMS} terms` }

  const terms: PauliTerm[] = []
  for (const raw of pieces) {
    let s = raw.replace(/\s+/g, ' ').trim()
    let sign = 1
    while (s.startsWith('+') || s.startsWith('-')) {
      if (s[0] === '-') sign = -sign
      s = s.slice(1).trim()
    }
    let coefficient = 1
    const num = s.match(/^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)\s*\*?\s*/)
    if (num) {
      coefficient = Number(num[1])
      s = s.slice(num[0].length)
    }
    if (!Number.isFinite(coefficient)) return { ok: false, error: `Bad coefficient in "${raw.trim()}"` }
    coefficient *= sign
    const body = s.replace(/[\s*⊗]/g, '')
    const ops: PauliTerm['ops'] = {}

    if (body === '' || body === 'I' || body === '1') {
      if (!num && body === '' ) return { ok: false, error: `Empty term in "${raw.trim()}"` }
    } else if (/^[IXYZixyz]+$/.test(body) && !/\d/.test(body)) {
      if (body.length !== numQubits) {
        return {
          ok: false,
          error: `"${body}" has ${body.length} letters but the circuit has ${numQubits} qubits. Use sparse form like Z0 X3 instead.`,
        }
      }
      const upper = body.toUpperCase()
      for (let k = 0; k < upper.length; k++) {
        const p = upper[upper.length - 1 - k]
        if (p !== 'I') ops[k] = p as 'X' | 'Y' | 'Z'
      }
    } else {
      const factor = /([IXYZixyz])(\d+)/g
      let consumed = ''
      let m: RegExpExecArray | null
      while ((m = factor.exec(body))) {
        consumed += m[0]
        const q = Number(m[2])
        if (q >= numQubits) return { ok: false, error: `Qubit ${q} does not exist (the circuit has ${numQubits})` }
        const p = m[1].toUpperCase() as 'I' | 'X' | 'Y' | 'Z'
        if (p === 'I') continue
        if (ops[q]) return { ok: false, error: `Qubit ${q} appears twice in "${raw.trim()}"` }
        ops[q] = p
      }
      if (consumed !== body) return { ok: false, error: `Could not read "${raw.trim()}". Use e.g. Z0 Z1, 0.5*X0X1, or ZZI` }
    }
    terms.push({ coefficient, ops })
  }
  return { ok: true, terms }
}

/** ⟨ψ|P|ψ⟩ for one Pauli string (coefficient not applied). Exact; real for a Pauli. */
export function pauliStringExpectation(amps: readonly Complex[], ops: PauliTerm['ops']): number {
  let xMask = 0
  let zMask = 0
  let nY = 0
  for (const [qs, p] of Object.entries(ops)) {
    const bit = 1 << Number(qs)
    if (p === 'X') xMask |= bit
    else if (p === 'Z') zMask |= bit
    else { xMask |= bit; zMask |= bit; nY++ }
  }
  // P|i⟩ = i^{nY} · (−1)^{popcount(i & zMask)} · |i ⊕ xMask⟩  (Y = iXZ on each qubit)
  let re = 0
  let im = 0
  for (let i = 0; i < amps.length; i++) {
    const a = amps[i]
    if (a.re === 0 && a.im === 0) continue
    const b = amps[i ^ xMask]
    const sign = popcount(i & zMask) & 1 ? -1 : 1
    // conj(b) · a
    re += sign * (b.re * a.re + b.im * a.im)
    im += sign * (b.re * a.im - b.im * a.re)
  }
  // multiply by i^{nY}
  switch (nY & 3) {
    case 0: return re
    case 1: return -im
    case 2: return -re
    default: return im
  }
}

/** ⟨ψ|H|ψ⟩ for a parsed Pauli sum, plus each term's own ⟨P⟩. */
export function pauliSumExpectation(
  state: StateVector,
  terms: readonly PauliTerm[],
): { value: number; perTerm: number[] } {
  const amps = state.amplitudes()
  const perTerm = terms.map((t) => pauliStringExpectation(amps, t.ops))
  const value = perTerm.reduce((s, v, k) => s + terms[k].coefficient * v, 0)
  return { value, perTerm }
}

/** Human form of a term, sparse, e.g. "-0.5·X0 Z3". */
export function formatTerm(t: PauliTerm): string {
  const factors = Object.entries(t.ops)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([q, p]) => `${p}${q}`)
    .join(' ')
  return `${t.coefficient}·${factors || 'I'}`
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

// ─── Statevector downloads ──────────────────────────────────────────────────

const CONVENTION =
  'qubit 0 is the least significant bit of index; bitstring is printed most significant qubit first (Qiskit order)'

/** CSV: index, bitstring, re, im, probability — every basis state, full precision. */
export function statevectorCsv(state: StateVector): string {
  const amps = state.amplitudes()
  const lines = [`# qubit16 exact statevector, ${state.numQubits} qubits. ${CONVENTION}.`, 'index,bitstring,re,im,probability']
  for (let i = 0; i < amps.length; i++) {
    const a = amps[i]
    lines.push(`${i},${state.label(i)},${a.re},${a.im},${a.re * a.re + a.im * a.im}`)
  }
  return `${lines.join('\n')}\n`
}

/** JSON with the circuit's QASM alongside, so the numbers carry their own provenance. */
export function statevectorJson(state: StateVector, qasm: string, note?: string): string {
  const amps = state.amplitudes()
  return JSON.stringify(
    {
      format: 'qubit16-statevector/v1',
      numQubits: state.numQubits,
      convention: CONVENTION,
      ...(note ? { note } : {}),
      qasm,
      amplitudes: amps.map((a) => [a.re, a.im]),
      probabilities: amps.map((a) => a.re * a.re + a.im * a.im),
    },
    null,
    1,
  )
}
