'use client'

/**
 * ColumnProbe — Quirk-style inline readout for one grid column.
 *
 * Hover (or park the keyboard cursor on) a column and a pill appears under
 * each wire showing that qubit's chance of reading |1⟩ AFTER the column —
 * the state "flows" left to right and this is a tap on the pipe. The numbers
 * come from lib/column-probe.ts (pure, tested); this file only draws.
 *
 * Rendered as an SVG <g> inside CircuitGrid's own <svg> so the pills scroll,
 * zoom and align with the column for free. Geometry (column centre x, wire
 * y's, column width) is passed in — CircuitGrid owns those constants and
 * tests/e2e/helpers.ts hardcodes them, so they are not duplicated here.
 *
 * A11Y: the whole group is aria-hidden and pointer-transparent. It is a
 * visual affordance only — the same readout reaches screen readers through
 * the aria-live seam (CircuitGrid announces describeColumnProbe() when the
 * grid cursor changes column), and letting the pills catch the mouse would
 * flicker the hover they follow.
 *
 * Motion: none. The pills appear and disappear with no transition, so there
 * is nothing to gate behind prefers-reduced-motion.
 */

import { formatProbePct, type ColumnProbeReadout } from '@/lib/column-probe'

const PILL_W = 34
const PILL_H = 14

export default function ColumnProbe({
  x,
  rowYs,
  colWidth,
  readout,
}: {
  /** Centre x of the probed column, in the grid SVG's coordinates. */
  x: number
  /**
   * Wire centre y for each qubit, index = qubit. `undefined` skips that row's
   * pill — CircuitGrid does this for a wire that sits under a wide gate's own
   * label (a register block or 2-qubit matrix), where the pill would
   * otherwise land on top of that text.
   */
  rowYs: Array<number | undefined>
  /** Column width — sizes the header underline. */
  colWidth: number
  /** The numbers to show; null renders nothing (frames not ready). */
  readout: ColumnProbeReadout | null
}) {
  if (!readout) return null
  return (
    <g aria-hidden="true" pointerEvents="none">
      {/* thin marker along the column's right edge — "you are reading here" */}
      <line
        x1={x + colWidth / 2 - 1}
        y1={rowYs.length ? (rowYs[0] ?? 0) - 22 : 0}
        x2={x + colWidth / 2 - 1}
        y2={rowYs.length ? (rowYs[rowYs.length - 1] ?? 0) + 22 : 0}
        stroke="var(--q-teal)"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        opacity={0.7}
      />
      {readout.p1s.map((p, q) => {
        const y = rowYs[q]
        if (y === undefined) return null
        // Sit in the lower padding of the cell, clear of the 34px gate box.
        const top = y + 18
        return (
          <g key={q}>
            <rect
              x={x - PILL_W / 2}
              y={top}
              width={PILL_W}
              height={PILL_H}
              rx={PILL_H / 2}
              fill="var(--surface-3)"
              stroke="var(--q-teal)"
              strokeWidth={1}
              opacity={0.95}
            />
            <text
              x={x}
              y={top + PILL_H / 2 + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              className="font-mono"
              fill="var(--q-teal-text)"
            >
              {formatProbePct(p)}
            </text>
          </g>
        )
      })}
    </g>
  )
}
