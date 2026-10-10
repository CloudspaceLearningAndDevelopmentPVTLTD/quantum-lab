/**
 * column-probe.ts — per-qubit |1⟩ probabilities "after this column".
 *
 * The circuit grid's inline probe (Quirk's signature interaction: point at a
 * column, see the state right there) needs one number per qubit for whichever
 * column the pointer or the keyboard cursor is on. The frames already exist —
 * page.tsx runs simulateSteps() on every edit for instant feedback — so the
 * probe is a pure lookup plus the reduced-density-matrix math that
 * lib/quantum-phase.ts already owns. Nothing here re-simulates.
 *
 * Column → frame mapping: circuit.ops[i] draws in column i, and
 * simulateSteps() returns frames[0] = |0…0⟩ then one frame per op. So the
 * state AFTER column `col` is frames[col + 1], clamped to the last frame —
 * the trailing empty columns the grid always shows simply read as the final
 * state, which is what a learner pointing "past the end" expects to see.
 *
 * Pure math, no DOM — tested in column-probe.test.ts. The rendering side is
 * components/circuit/ColumnProbe.tsx.
 */

import { allQubitPhaseInfo } from './quantum-phase'
import { type StateVector } from './quantum'

export interface ColumnProbeReadout {
  /** The column probed (as given, clamped at 0). */
  col: number
  /** Index into `frames` actually read — col+1 clamped to the last frame. */
  frameIndex: number
  /** True when the probed column is past the last gate (final-state readout). */
  pastEnd: boolean
  /** P(qubit q reads 1) after this column, LSB-first as everywhere. */
  p1s: number[]
}

/**
 * Read the per-qubit |1⟩ probabilities after column `col` out of the step
 * frames. Returns null for an empty frames array (a render race guard — the
 * caller shows nothing rather than a wrong number).
 */
export function columnProbeReadout(
  frames: StateVector[],
  col: number
): ColumnProbeReadout | null {
  if (frames.length === 0) return null
  const safeCol = Math.max(0, Math.floor(col))
  const frameIndex = Math.min(safeCol + 1, frames.length - 1)
  return {
    col: safeCol,
    frameIndex,
    pastEnd: safeCol + 1 > frames.length - 1,
    // Reuse the phase-disk math rather than summing probabilities again: it is
    // the tested implementation, and p1 is exactly its ρ11.
    p1s: allQubitPhaseInfo(frames[frameIndex]).map((info) => info.p1),
  }
}

/** "82%" for display in a 9px pill — one rounded integer, no decimals. */
export function formatProbePct(p: number): string {
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`
}

/**
 * A11Y: the spoken form of a probe readout, for the shared aria-live seam.
 * Position first (it is what changed), then one clause per qubit. Kept to
 * whole percent — a screen reader spelling out "49.999951 percent" buries
 * the physics in float noise.
 */
export function describeColumnProbe(readout: ColumnProbeReadout): string {
  const where = readout.pastEnd
    ? 'After the last gate'
    : `After column ${readout.col + 1}`
  const parts = readout.p1s.map((p, q) => `qubit ${q} ${formatProbePct(p)}`)
  return `${where}: chance of reading 1 — ${parts.join(', ')}.`
}
