/**
 * lib/workbench/diff.ts — what changed between two circuits.
 *
 * A circuit is an ordered list of gates, so the natural diff is a line diff
 * over gates: longest common subsequence, then everything not in the
 * subsequence is an insertion or a deletion. Each gate is serialised to a
 * canonical string (name, angle, operands, classical binding) so two ops are
 * "the same" exactly when the simulator would treat them the same.
 *
 * Used by the generate → verify → repair loop to show, attempt by attempt,
 * what the model actually changed in response to the diagnostics — which is
 * often the most informative part of a failed run.
 */

import type { Circuit, GateOp } from '@/lib/quantum'

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffEntry {
  kind: DiffKind
  /** Canonical one-line form of the op. */
  text: string
  op: GateOp
}

export interface CircuitDiff {
  entries: DiffEntry[]
  added: number
  removed: number
  /** Qubit count changed between the two circuits. */
  widthBefore: number
  widthAfter: number
}

/** Canonical text for one op. Angles are rounded so float noise is not a change. */
export function opText(op: GateOp): string {
  const args = op.qubits.map((q) => `q[${q}]`).join(', ')
  const angle = op.theta !== undefined ? `(${formatTheta(op.theta)})` : ''
  const clbit = op.name === 'MEASURE' && op.clbit !== undefined ? ` -> c[${op.clbit}]` : ''
  const cond = op.condition ? `if c[${op.condition.bit}]==${op.condition.value} ` : ''
  return `${cond}${op.name.toLowerCase()}${angle} ${args}${clbit}`
}

function formatTheta(theta: number): string {
  const ratio = theta / Math.PI
  for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) {
    const n = ratio * d
    const r = Math.round(n)
    if (r !== 0 && Math.abs(n - r) < 1e-9) {
      const num = r === 1 ? 'pi' : r === -1 ? '-pi' : `${r}*pi`
      return d === 1 ? num : `${num}/${d}`
    }
  }
  return theta.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * LCS-based diff of `before` → `after`. O(n·m) in gate count, which is
 * nothing for the circuits this workbench handles (tens of gates).
 */
export function diffCircuits(before: Circuit | null, after: Circuit): CircuitDiff {
  const a = before ? before.ops.map(opText) : []
  const b = after.ops.map(opText)
  const n = a.length, m = b.length

  // lcs[i][j] = length of LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const entries: DiffEntry[] = []
  let i = 0, j = 0
  let added = 0, removed = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      entries.push({ kind: 'same', text: b[j], op: after.ops[j] })
      i++; j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      entries.push({ kind: 'removed', text: a[i], op: before!.ops[i] })
      removed++; i++
    } else {
      entries.push({ kind: 'added', text: b[j], op: after.ops[j] })
      added++; j++
    }
  }
  while (i < n) { entries.push({ kind: 'removed', text: a[i], op: before!.ops[i] }); removed++; i++ }
  while (j < m) { entries.push({ kind: 'added', text: b[j], op: after.ops[j] }); added++; j++ }

  return {
    entries,
    added,
    removed,
    widthBefore: before?.numQubits ?? 0,
    widthAfter: after.numQubits,
  }
}

/** Unified-diff style text: `+`, `-` and two spaces for unchanged lines. */
export function formatDiff(diff: CircuitDiff): string {
  const lines = diff.entries.map((e) => `${e.kind === 'added' ? '+' : e.kind === 'removed' ? '-' : ' '} ${e.text}`)
  if (diff.widthBefore !== diff.widthAfter && diff.widthBefore > 0) {
    lines.unshift(`~ qubits ${diff.widthBefore} -> ${diff.widthAfter}`)
  }
  return lines.join('\n')
}
