/**
 * circuitEdit.ts — pure, framework-free edits to a Circuit's op list.
 *
 * `circuit.ops` is a flat ordered array, not a 2D grid: op *i* is drawn in
 * column *i* (see the matching comment in CircuitGrid.tsx). That means every
 * edit here — moving a gate, retargeting its qubits, inserting or removing
 * one — is an ordinary array operation, never a column-shift over a grid.
 *
 * Every function returns a NEW Circuit (ops is a fresh array) and never
 * mutates its input, so callers can hand the result straight to the same
 * onChange(circuit) prop CircuitGrid already uses for every other mutation.
 */
import { GATE_BY_NAME, type Circuit, type GateOp } from '@/lib/quantum'

function assertIndexInRange(index: number, length: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`${label} ${index} is out of range for a circuit with ${length} op(s).`)
  }
}

/**
 * Move the op at `fromIndex` to `toIndex`, splicing it out and back in.
 *
 * `toIndex` is the index the op should occupy AFTER the move, in the
 * resulting array — the same "drop it here" meaning a drag-and-drop gesture
 * wants. Moving an op to its own position is a no-op (still returns a new
 * Circuit/ops array, but with equal contents).
 */
export function moveOp(circuit: Circuit, fromIndex: number, toIndex: number): Circuit {
  assertIndexInRange(fromIndex, circuit.ops.length, 'moveOp: fromIndex')
  assertIndexInRange(toIndex, circuit.ops.length, 'moveOp: toIndex')
  const ops = circuit.ops.slice()
  const [op] = ops.splice(fromIndex, 1)
  ops.splice(toIndex, 0, op)
  return { ...circuit, ops }
}

/**
 * Replace the qubits of the op at `index` with `newQubits`, validating that
 * the new list is still legal for that op's gate:
 *   - arity: a variadic gate (MCX, UNITARY, ADDK/MULK/QFT/IQFT, BARRIER)
 *     accepts any count ≥ its spec's minimum arity; anything else must match
 *     exactly.
 *   - range: every qubit index must be within [0, circuit.numQubits).
 *   - distinctness: a gate whose operands must all be different wires (any
 *     gate with arity > 1 — CX's control vs target, CCX's two controls and
 *     target, SWAP's two wires, a register block's controls vs register, …)
 *     rejects a newQubits list with a repeated index. A true arity-1 gate has
 *     nothing to be distinct FROM and is exempt.
 * Throws a clear, specific error instead of producing an invalid op.
 */
export function retargetOp(circuit: Circuit, index: number, newQubits: number[]): Circuit {
  assertIndexInRange(index, circuit.ops.length, 'retargetOp: index')
  const op = circuit.ops[index]
  const spec = GATE_BY_NAME[op.name]
  if (!spec) throw new Error(`retargetOp: unknown gate ${op.name}`)

  const minArity = spec.arity
  if (spec.variadic) {
    if (newQubits.length < minArity) {
      throw new Error(
        `retargetOp: ${op.name} needs at least ${minArity} qubit(s), got ${newQubits.length}.`
      )
    }
  } else if (newQubits.length !== minArity) {
    throw new Error(
      `retargetOp: ${op.name} needs exactly ${minArity} qubit(s), got ${newQubits.length}.`
    )
  }

  for (const q of newQubits) {
    if (!Number.isInteger(q) || q < 0 || q >= circuit.numQubits) {
      throw new Error(
        `retargetOp: qubit ${q} is out of range for a ${circuit.numQubits}-qubit circuit.`
      )
    }
  }

  if (newQubits.length > 1) {
    const seen = new Set<number>()
    for (const q of newQubits) {
      if (seen.has(q)) {
        throw new Error(`retargetOp: ${op.name} needs distinct qubits, but ${q} repeats.`)
      }
      seen.add(q)
    }
  }

  const ops = circuit.ops.slice()
  ops[index] = { ...op, qubits: newQubits }
  return { ...circuit, ops }
}

/**
 * Splice a new op in at `index` (0..ops.length inclusive — `index ===
 * ops.length` appends). Used for dropping a palette gate directly onto a
 * specific grid position.
 */
export function insertOpAt(circuit: Circuit, index: number, op: GateOp): Circuit {
  if (!Number.isInteger(index) || index < 0 || index > circuit.ops.length) {
    throw new Error(`insertOpAt: index ${index} is out of range for a circuit with ${circuit.ops.length} op(s).`)
  }
  const ops = circuit.ops.slice()
  ops.splice(index, 0, op)
  return { ...circuit, ops }
}

/**
 * Remove the op at `index`. The single source of truth for per-cell removal
 * — CircuitGrid.tsx's keyboard/click removal path calls this instead of
 * duplicating the `filter` logic inline.
 */
export function removeOpAt(circuit: Circuit, index: number): Circuit {
  assertIndexInRange(index, circuit.ops.length, 'removeOpAt: index')
  return { ...circuit, ops: circuit.ops.filter((_, i) => i !== index) }
}
