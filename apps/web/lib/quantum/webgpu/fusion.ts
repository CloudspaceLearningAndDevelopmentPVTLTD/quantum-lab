/**
 * fusion.ts — collapse runs of single-qubit gates on one qubit into one matrix.
 *
 * A GPU pays a fixed cost per dispatch (command encoding, a full pass over the
 * statevector). H·T·H·S on the same qubit is four passes for what one 2×2
 * matrix product does in one. This pass folds them.
 *
 * Reordering rule: gates on different qubits commute, so a single-qubit gate
 * can be delayed until the next op that touches ITS qubit. Each qubit keeps a
 * pending matrix; a multi-qubit op (controlled, swap) flushes the pending
 * matrices of every qubit it touches, in qubit order, before it is emitted.
 * The end of the circuit flushes everything in qubit order. This is exactly
 * why fusion cannot change the state: within each qubit's own timeline the
 * order is preserved, and across qubits only commuting gates are reordered.
 *
 * Matrix product convention: applying A then B is the matrix B·A. matmul(b, a)
 * below is B·A, so the pending product is always `matmul(next, pending)`.
 */

import type { Complex, Matrix2x2 } from '@/lib/quantum'
import type { BackendOp } from '../backend'

const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })

/** B·A — the matrix of "apply A, then apply B". */
export function matmul(b: Matrix2x2, a: Matrix2x2): Matrix2x2 {
  const [b00, b01, b10, b11] = b
  const [a00, a01, a10, a11] = a
  return [
    add(mul(b00, a00), mul(b01, a10)),
    add(mul(b00, a01), mul(b01, a11)),
    add(mul(b10, a00), mul(b11, a10)),
    add(mul(b10, a01), mul(b11, a11)),
  ]
}

export const IDENTITY: Matrix2x2 = [
  { re: 1, im: 0 }, { re: 0, im: 0 },
  { re: 0, im: 0 }, { re: 1, im: 0 },
]

export function fuseSingleQubitGates(ops: readonly BackendOp[]): BackendOp[] {
  const out: BackendOp[] = []
  const pending = new Map<number, Matrix2x2>()

  const flush = (qubits: number[]): void => {
    for (const q of [...qubits].sort((x, y) => x - y)) {
      const m = pending.get(q)
      if (!m) continue
      out.push({ kind: 'gate', matrix: m, target: q })
      pending.delete(q)
    }
  }

  for (const op of ops) {
    switch (op.kind) {
      case 'gate': {
        const prev = pending.get(op.target)
        pending.set(op.target, prev ? matmul(op.matrix, prev) : op.matrix)
        break
      }
      case 'controlled':
        flush([...op.controls, op.target])
        out.push(op)
        break
      case 'swap':
        flush([op.a, op.b])
        out.push(op)
        break
    }
  }
  flush([...pending.keys()])
  return out
}
