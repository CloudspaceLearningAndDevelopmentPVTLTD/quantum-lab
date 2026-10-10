/**
 * circuitLayout.ts — the pixel geometry CircuitGrid.tsx draws the SVG editor
 * with.
 *
 * Pulled out of CircuitGrid.tsx (a pure extraction, no behavior change) so a
 * separate SVG-export package can lay out a circuit identically without
 * importing a React component. Keep the exported names and semantics
 * unchanged — CircuitGrid.tsx and that export package both depend on them.
 */

export const COL_W = 52
export const ROW_H = 56
export const LABEL_W = 46
export const PAD_TOP = 18
export const PAD_BOTTOM = 18
export const TRAILING_COLS = 4
export const BOX = 34
/**
 * Height of a classical wire row. Shorter than a qubit row on purpose: a
 * classical bit is a lesser thing than a qubit, and the drawing should say so
 * before the label does. These rows are NOT part of the editable grid — you
 * cannot place a gate on a wire that carries a bit — so they add no cells and
 * no tab stops.
 */
export const CROW_H = 32

export const colX = (col: number) => LABEL_W + col * COL_W + COL_W / 2
export const rowY = (q: number) => PAD_TOP + q * ROW_H + ROW_H / 2
