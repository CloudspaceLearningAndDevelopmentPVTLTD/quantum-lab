'use client'

import { basisLabel, maxAbsEntry, type DensityMatrix } from '@/lib/quantum/densityMatrix'
import { cAbs, type Complex } from '@/lib/quantum'

/**
 * DensityMatrixView — ρ as numbers, with the cells tinted by |ρᵢⱼ|.
 *
 * Diagonal entries are populations (real, sum to 1) and tint violet;
 * off-diagonal entries are coherences and tint teal. A cell's tint fades with
 * its magnitude, so a dephased state reads as "the teal drained out" before
 * anyone reads a digit. Rendered as a real <table> so the row and column kets
 * are proper headers for a screen reader; a 4×4 matrix of complex numbers is
 * wider than a phone, so it scrolls inside its own box.
 */

/** Fade a CSS custom property toward transparent; works on hex, rgb and hsl. */
function tint(cssVar: string, alpha: number): string {
  return `color-mix(in srgb, ${cssVar} ${Math.round(alpha * 100)}%, transparent)`
}

/** "0.50", "0.35 − 0.35i", "−0.50i": the shortest honest rendering. */
export function formatEntry(a: Complex, digits = 2): string {
  const eps = 0.5 * 10 ** -digits
  const re = Math.abs(a.re) < eps ? 0 : a.re
  const im = Math.abs(a.im) < eps ? 0 : a.im
  const num = (v: number) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(digits)
  if (im === 0) return num(re)
  const imPart = `${Math.abs(im).toFixed(digits)}i`
  if (re === 0) return `${im < 0 ? '−' : ''}${imPart}`
  return `${num(re)} ${im < 0 ? '−' : '+'} ${imPart}`
}

export function DensityMatrixView({
  matrix,
  title,
  caption,
  digits = 2,
  compact = false,
}: {
  matrix: DensityMatrix
  /** Short heading shown above the grid, e.g. "ρ" or "ρ_A = Tr_B ρ". */
  title: string
  /** Screen-reader caption; also rendered as a muted line under the title. */
  caption?: string
  digits?: number
  compact?: boolean
}) {
  const scale = Math.max(maxAbsEntry(matrix), 1e-9)
  const cell = compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[12px] sm:text-[13px]'

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-bold text-ink">{title}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-muted">
          {matrix.dim}×{matrix.dim}
        </span>
      </div>
      {caption ? <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">{caption}</p> : null}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="border-collapse font-mono">
          <caption className="sr-only">
            {title}: the {matrix.dim} by {matrix.dim} density matrix. Rows and columns are labelled
            by computational basis states. Diagonal entries are populations; off-diagonal entries
            are coherences.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                row
              </th>
              {matrix.rho.map((_, j) => (
                <th
                  key={j}
                  scope="col"
                  className="px-2 pb-1 text-center text-[11px] font-semibold text-ink-muted"
                >
                  ⟨{basisLabel(matrix, j).slice(1, -1)}|
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rho.map((row, i) => (
              <tr key={i}>
                <th
                  scope="row"
                  className="pr-2 text-right text-[11px] font-semibold text-ink-muted"
                >
                  {basisLabel(matrix, i)}
                </th>
                {row.map((a, j) => {
                  const mag = cAbs(a) / scale
                  const diagonal = i === j
                  const bg = tint(diagonal ? 'var(--q-violet)' : 'var(--q-teal)', 0.06 + 0.4 * mag)
                  return (
                    <td
                      key={j}
                      className={`${cell} whitespace-nowrap border border-line text-center tabular-nums ${
                        diagonal ? 'font-bold text-ink' : 'text-ink-secondary'
                      }`}
                      style={{ backgroundColor: bg }}
                    >
                      {formatEntry(a, digits)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default DensityMatrixView
