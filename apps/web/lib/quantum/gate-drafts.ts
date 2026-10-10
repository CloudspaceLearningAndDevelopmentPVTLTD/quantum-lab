/**
 * gate-drafts.ts — the placement-time settings a wave-2 gate needs, and the
 * pure checks the editor and the grid both run on them.
 *
 * Kept out of the React component so the verdicts ("not unitary", "N does not
 * fit", "needs 5 qubits") are unit-tested against known inputs rather than
 * discovered in the browser.
 */

import { type Complex, type GateName } from '../quantum'
import {
  gcd,
  parseComplexEntry,
  unitarityError,
  MATRIX_PRESETS,
  MAX_BLOCK_WIDTH,
  UNITARY_TOLERANCE,
} from './gates-extended'

// ────────────────────────────────────────────────────────────
// Drafts
// ────────────────────────────────────────────────────────────

export interface MatrixDraft {
  qubits: 1 | 2
  /** Row-major entries as typed. 4 or 16 of them. */
  entries: string[]
  label: string
}

export interface BlockDraft {
  k: number
  modulus: number
  /** Register width in qubits. */
  width: number
  /** One control qubit, picked first. */
  controlled: boolean
}

export const DEFAULT_MATRIX_DRAFT: MatrixDraft = {
  qubits: 1,
  entries: MATRIX_PRESETS[0].entries.slice(),
  label: 'H',
}

/** +7 mod 15 on four qubits: the Shor example every textbook uses. */
export const DEFAULT_BLOCK_DRAFT: BlockDraft = { k: 7, modulus: 15, width: 4, controlled: false }

/** The smallest register that can hold values 0 … N−1. */
export const minWidthFor = (modulus: number) => Math.max(1, Math.ceil(Math.log2(Math.max(1, modulus))))

export type MatrixResolution =
  | { ok: true; matrix: Complex[]; error: number }
  | { ok: false; message: string }

/** Parse and check a matrix draft. Pure, so the grid can refuse a placement with the same verdict the editor shows. */
export function resolveMatrixDraft(draft: MatrixDraft): MatrixResolution {
  const d = draft.qubits === 1 ? 2 : 4
  if (draft.entries.length !== d * d) return { ok: false, message: `expected ${d * d} entries` }
  const matrix: Complex[] = []
  for (let i = 0; i < draft.entries.length; i++) {
    const z = parseComplexEntry(draft.entries[i])
    if (!z) {
      return { ok: false, message: `Entry row ${Math.floor(i / d) + 1}, column ${(i % d) + 1} (“${draft.entries[i] || 'empty'}”) is not a number. Try 1, -0.5, i, (1+i)/2 or 1/sqrt2.` }
    }
    matrix.push(z)
  }
  const error = unitarityError(matrix)
  if (!(error <= UNITARY_TOLERANCE)) {
    return {
      ok: false,
      message: `Not unitary: ‖U†U − I‖ = ${Number.isFinite(error) ? error.toPrecision(3) : '∞'}. A gate must preserve total probability, so its columns have to be orthonormal.`,
    }
  }
  return { ok: true, matrix, error }
}

/** The verdict on a block draft for a given gate, or null when it can be placed. */
export function blockDraftProblem(name: GateName, draft: BlockDraft, numQubits: number): string | null {
  const controls = draft.controlled ? 1 : 0
  if (!Number.isInteger(draft.width) || draft.width < 1) return 'The register needs at least one qubit.'
  if (draft.width > MAX_BLOCK_WIDTH) return `Registers are limited to ${MAX_BLOCK_WIDTH} qubits.`
  if (draft.width + controls > numQubits) {
    return `A ${draft.width}-qubit register${draft.controlled ? ' plus a control' : ''} needs ${draft.width + controls} qubits; the circuit has ${numQubits}.`
  }
  if (name === 'ADDK' || name === 'MULK') {
    if (!Number.isInteger(draft.modulus) || draft.modulus < 1) return 'N must be a positive whole number.'
    if (!Number.isInteger(draft.k)) return 'k must be a whole number.'
    if (draft.modulus > 1 << draft.width) {
      return `N = ${draft.modulus} does not fit in ${draft.width} qubits (max ${1 << draft.width}). Widen the register.`
    }
    if (name === 'MULK') {
      const kk = ((draft.k % draft.modulus) + draft.modulus) % draft.modulus
      const g = gcd(kk, draft.modulus)
      if (draft.modulus > 1 && g !== 1) {
        return `×${draft.k} mod ${draft.modulus} is not reversible — gcd(${draft.k}, ${draft.modulus}) = ${g}, so two inputs collide and no unitary does this. Pick k coprime to N.`
      }
    }
  }
  return null
}

/** How many wires the learner will pick for the selected gate with these drafts. */
export function effectiveArity(
  name: GateName,
  drafts: { mcxControls: number; matrix: MatrixDraft; block: BlockDraft },
): number {
  switch (name) {
    case 'MCX': return Math.max(1, drafts.mcxControls) + 1
    case 'UNITARY': return drafts.matrix.qubits
    case 'ADDK':
    case 'MULK':
    case 'QFT':
    case 'IQFT': return drafts.block.width + (drafts.block.controlled ? 1 : 0)
    case 'BARRIER': return 0
    default: return -1 // not variadic — use the spec's arity
  }
}

/** Spoken/shown hint for the i-th pick of a variadic gate. */
export function pendingHint(
  name: GateName,
  picked: number,
  drafts: { mcxControls: number; matrix: MatrixDraft; block: BlockDraft },
): string {
  if (name === 'MCX') {
    const n = Math.max(1, drafts.mcxControls)
    return picked < n ? `Pick control ${picked + 1} of ${n}` : 'Pick the target qubit'
  }
  if (name === 'UNITARY') return picked === 0 ? 'Pick the first qubit (low index bit)' : 'Pick the second qubit (high index bit)'
  if (name === 'CSWAP') return ['Pick the control qubit', 'Pick the first qubit to swap', 'Pick the second qubit to swap'][Math.min(picked, 2)]
  const block = drafts.block
  const offset = block.controlled ? 1 : 0
  if (block.controlled && picked === 0) return 'Pick the control qubit'
  const bit = picked - offset
  return bit === 0
    ? `Pick register bit 0 (least significant) of ${block.width}`
    : `Pick register bit ${bit} of ${block.width}`
}
