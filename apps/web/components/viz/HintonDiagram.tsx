/**
 * HintonDiagram — a complex matrix as a grid of squares: side ∝ |m_ij|,
 * colour = arg(m_ij) (or just sign, for a real matrix). The flat companion to
 * MatrixHistogram3D; also what that component falls back to without WebGL.
 *
 * Plain SVG with a fixed viewBox, so it scales to its container's width with
 * no measurement, no effect and no zero-width hazard, and renders on the
 * server. Colours are CSS variables (`var(--ink)` etc.) except the phase ring,
 * which is precomputed in matrixLayout.ts and identical in both themes.
 *
 * Props:
 *   matrix      ComplexMatrix — rows of {re, im}. Any shape; square is typical.
 *   labels      row/column labels. Default: |00…⟩ basis kets when the row count
 *               is a power of two, else the row index.
 *   scale       the magnitude drawn as a full-size square. Pass 1 for a density
 *               matrix so ½ always reads as half; default = largest |m_ij|.
 *   title       short name used in the accessible description ("ρ of qubit A").
 *   showValues  print the number in each cell. Default: true when the grid is
 *               at most 4×4.
 *   showLegend  render the phase/sign key below the grid. Default true.
 *   className   extra classes on the wrapper.
 *
 * Usage:
 *   <HintonDiagram matrix={densityMatrix(amps)} scale={1} title="ρ" />
 */

import { basisLabels } from '@/lib/quantum/densityMatrixView'
import type { ComplexMatrix } from '@/lib/quantum/densityMatrixView'
import {
  columnCount,
  describeMatrix,
  formatEntry,
  hintonLayout,
  hintonSide,
  isRealMatrix,
  labelFor,
  labelStride,
  matrixEntries,
  phaseHex,
  resolveScale,
} from './matrixLayout'
import { PhaseLegend } from './PhaseLegend'

export type HintonDiagramProps = {
  matrix: ComplexMatrix
  labels?: readonly string[]
  scale?: number
  title?: string
  showValues?: boolean
  showLegend?: boolean
  className?: string
}

/** Virtual drawing width; the SVG's viewBox scales it to the container. */
const VIRTUAL_WIDTH = 320

/** Two-decimal coordinates: keeps the markup small and free of float noise. */
const r2 = (v: number) => Math.round(v * 100) / 100

/** Default labels: kets when the dimension is a power of two. */
export function defaultLabels(rows: number): string[] | undefined {
  const n = Math.log2(rows)
  return rows > 0 && Number.isInteger(n) ? basisLabels(n) : undefined
}

export function HintonDiagram({
  matrix,
  labels,
  scale,
  title,
  showValues,
  showLegend = true,
  className,
}: HintonDiagramProps) {
  const rows = matrix.length
  const cols = columnCount(matrix)
  const names = labels ?? defaultLabels(rows)
  const fullScale = resolveScale(matrix, scale)
  const real = isRealMatrix(matrix)
  const entries = matrixEntries(matrix)
  const printValues = showValues ?? (rows <= 4 && cols <= 4)

  // The grid is laid out in a fixed virtual box: labels get a gutter scaled to
  // the label length, and the square cells fill what remains.
  const longest = names ? Math.max(...names.map((s) => s.length), 1) : String(Math.max(rows, cols)).length
  const gutterLeft = Math.min(90, 8 + longest * 7.2)
  const gutterTop = 20
  const L = hintonLayout(rows, cols, VIRTUAL_WIDTH, VIRTUAL_WIDTH, { gutterLeft, gutterTop, pad: 4 })
  const stride = labelStride(Math.max(rows, cols))
  const fontSize = Math.max(7, Math.min(12, L.cell * 0.32))
  const valueSize = Math.max(6, Math.min(11, L.cell * 0.24))

  const description = `${title ? `${title}: ` : ''}Hinton diagram. ${describeMatrix(matrix, names)}`

  if (L.cell <= 0) {
    return (
      <div className={className} role="img" aria-label={description}>
        <p className="text-[12px] text-ink-muted">Nothing to draw.</p>
      </div>
    )
  }

  return (
    <div className={`w-full ${className ?? ''}`}>
      <svg
        viewBox={`0 0 ${r2(L.width)} ${r2(L.height)}`}
        width="100%"
        style={{ display: 'block', maxWidth: `${L.width * 1.6}px`, height: 'auto' }}
        role="img"
        aria-label={description}
      >
        {/* Cell backgrounds and hairlines */}
        <rect
          x={r2(L.originX)}
          y={r2(L.originY)}
          width={r2(L.cell * cols)}
          height={r2(L.cell * rows)}
          fill="var(--surface-2)"
          stroke="var(--line-strong)"
          strokeWidth={1}
          rx={2}
        />
        {Array.from({ length: cols - 1 }, (_, j) => (
          <line
            key={`v${j}`}
            x1={r2(L.originX + L.cell * (j + 1))}
            x2={r2(L.originX + L.cell * (j + 1))}
            y1={r2(L.originY)}
            y2={r2(L.originY + L.cell * rows)}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: rows - 1 }, (_, i) => (
          <line
            key={`h${i}`}
            y1={r2(L.originY + L.cell * (i + 1))}
            y2={r2(L.originY + L.cell * (i + 1))}
            x1={r2(L.originX)}
            x2={r2(L.originX + L.cell * cols)}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}

        {/* Column labels (top) and row labels (left) */}
        {Array.from({ length: cols }, (_, j) =>
          j % stride === 0 ? (
            <text
              key={`c${j}`}
              x={r2(L.originX + L.cell * (j + 0.5))}
              y={r2(L.originY - 6)}
              textAnchor="middle"
              fontSize={fontSize}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill="var(--ink-secondary)"
            >
              {labelFor(names, j)}
            </text>
          ) : null
        )}
        {Array.from({ length: rows }, (_, i) =>
          i % stride === 0 ? (
            <text
              key={`r${i}`}
              x={r2(L.originX - 5)}
              y={r2(L.originY + L.cell * (i + 0.5))}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={fontSize}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill="var(--ink-secondary)"
            >
              {labelFor(names, i)}
            </text>
          ) : null
        )}

        {/* The squares */}
        {entries.map((e) => {
          const side = hintonSide(e.magnitude, fullScale, L.cell)
          if (side <= 0) return null
          const cx = L.originX + L.cell * (e.col + 0.5)
          const cy = L.originY + L.cell * (e.row + 0.5)
          return (
            <rect
              key={`${e.row}-${e.col}`}
              x={r2(cx - side / 2)}
              y={r2(cy - side / 2)}
              width={r2(side)}
              height={r2(side)}
              fill={phaseHex(e.phase)}
              rx={Math.min(2, side * 0.12)}
            >
              <title>{`${labelFor(names, e.row)}⟨${labelFor(names, e.col).replace(/^\|/, '').replace(/⟩$/, '')}| = ${formatEntry(e.re, e.im, 3)}`}</title>
            </rect>
          )
        })}

        {/* Printed values, stroked in the surface colour so they stay legible over any square */}
        {printValues
          ? entries.map((e) => (
              <text
                key={`t${e.row}-${e.col}`}
                x={r2(L.originX + L.cell * (e.col + 0.5))}
                y={r2(L.originY + L.cell * (e.row + 0.5))}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={valueSize}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="var(--ink)"
                stroke="var(--surface)"
                strokeWidth={2.5}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {formatEntry(e.re, e.im)}
              </text>
            ))
          : null}
      </svg>
      {showLegend ? <PhaseLegend mode={real ? 'sign' : 'phase'} className="mt-2" /> : null}
    </div>
  )
}

export default HintonDiagram
