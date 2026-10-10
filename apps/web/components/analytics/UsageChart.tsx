'use client'

/**
 * UsageChart — a hand-built SVG time series.
 *
 * Design rules this component enforces rather than leaves to the caller:
 *  · ONE y-axis. Never two. Two measures of different scale belong in two charts.
 *  · A single series gets one hue and NO legend box — the title names it.
 *    Two to four series get a legend AND direct end-labels, so identity is never
 *    carried by colour alone.
 *  · Hues are assigned from the fixed order violet → teal → amber → rose → sky by
 *    series index, never by rank, so filtering a series out cannot repaint the
 *    survivors.
 *  · Recessive horizontal gridlines only; no vertical grid; axis text in muted ink.
 *  · 2px lines, ≥8px end markers with a 2px surface ring, and a crosshair +
 *    tooltip that reports every series at the hovered date.
 *  · A table view, because a tooltip must enhance and never gate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ACCENT_HEX, ACCENT_ORDER, type Accent } from '@/components/analytics/Sparkline'

export interface UsagePoint {
  date: string
  value: number
}

export interface UsageSeries {
  name: string
  data: UsagePoint[]
}

export interface UsageChartProps {
  series: UsageSeries[]
  title: string
  unit?: string
}

// Resolved through CSS custom properties (see docs/THEMING.md) so this SVG
// re-themes for free — `fill`/`stroke` accept `var(...)` directly and the
// browser re-resolves it whenever `<html>`'s class changes. No JS needed.
const SURFACE = 'var(--surface)'
const GRID = 'var(--line)'
/** Past five series there is no honest hue left — fold the tail instead. */
const MAX_SERIES = ACCENT_ORDER.length

const PAD = { top: 14, right: 16, bottom: 26, left: 44 }
/** Extra right-hand gutter reserved for direct end-labels. */
const LABEL_GUTTER = 92

function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => Number.parseInt(part, 10))
  if (!y || !m || !d) return iso
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function niceCeil(value: number): number {
  if (value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude
    if (candidate >= value) return candidate
  }
  return 10 * magnitude
}

export function UsageChart({ series, title, unit }: UsageChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(720)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const shown = useMemo(() => series.slice(0, MAX_SERIES), [series])
  const droppedSeries = series.length - shown.length

  // Every series is drawn against the FIRST series' dates, which is safe because
  // dailySeries() returns a dense, zero-filled, identically-bucketed series.
  const dates = shown[0]?.data.map((p) => p.date) ?? []
  const pointCount = dates.length
  const hasData = shown.length > 0 && pointCount > 0

  const height = 240
  const multi = shown.length >= 2
  const rightPad = PAD.right + (multi ? LABEL_GUTTER : 0)
  const innerW = Math.max(1, width - PAD.left - rightPad)
  const innerH = Math.max(1, height - PAD.top - PAD.bottom)

  const rawMax = hasData
    ? Math.max(...shown.flatMap((s) => s.data.map((p) => p.value)), 0)
    : 0
  const yMax = niceCeil(rawMax)

  const xAt = useCallback(
    (i: number): number => (pointCount <= 1 ? PAD.left + innerW : PAD.left + (i / (pointCount - 1)) * innerW),
    [pointCount, innerW]
  )
  const yAt = useCallback(
    (v: number): number => PAD.top + innerH - (Math.max(0, v) / yMax) * innerH,
    [innerH, yMax]
  )

  const ticks = useMemo(() => {
    const count = 4
    return Array.from({ length: count + 1 }, (_, i) => (yMax / count) * i)
  }, [yMax])

  // X labels: show at most 5 so they never collide.
  const xLabelIndices = useMemo(() => {
    if (pointCount === 0) return []
    const wanted = Math.min(5, pointCount)
    if (wanted === 1) return [0]
    const step = (pointCount - 1) / (wanted - 1)
    return Array.from({ length: wanted }, (_, i) => Math.round(i * step))
  }, [pointCount])

  /**
   * Direct end-labels, nudged apart when lines converge. A nudged label keeps a
   * leader line back to its own end point, so it never detaches from its series.
   */
  const endLabels = useMemo(() => {
    if (!multi || !hasData) return []
    const raw = shown.map((s, i) => ({
      name: s.name,
      color: ACCENT_HEX[ACCENT_ORDER[i] as Accent],
      anchorY: yAt(s.data[s.data.length - 1]?.value ?? 0),
      y: yAt(s.data[s.data.length - 1]?.value ?? 0),
    }))
    const sorted = [...raw].sort((a, b) => a.y - b.y)
    const minGap = 15
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]
      if (sorted[i].y - prev.y < minGap) sorted[i].y = prev.y + minGap
    }
    return sorted
  }, [multi, hasData, shown, yAt])

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (pointCount === 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const ratio = (x - PAD.left) / innerW
      const index = Math.round(ratio * Math.max(1, pointCount - 1))
      setHoverIndex(Math.min(pointCount - 1, Math.max(0, index)))
    },
    [pointCount, innerW]
  )

  const handleKey = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>) => {
      if (pointCount === 0) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const delta = event.key === 'ArrowRight' ? 1 : -1
        setHoverIndex((current) => {
          const next = (current === null ? pointCount - 1 : current) + delta
          return Math.min(pointCount - 1, Math.max(0, next))
        })
      } else if (event.key === 'Escape') {
        setHoverIndex(null)
      }
    },
    [pointCount]
  )

  const unitSuffix = unit ? ` ${unit}` : ''

  if (!hasData) {
    return (
      <figure className="card p-5">
        <figcaption className="text-[13px] font-semibold text-ink-secondary">{title}</figcaption>
        <div className="grid h-40 place-items-center text-sm text-ink-muted">
          No activity recorded yet for this period.
        </div>
      </figure>
    )
  }

  const hoverX = hoverIndex === null ? 0 : xAt(hoverIndex)
  const tooltipLeft = Math.min(Math.max(hoverX, 70), Math.max(70, width - 70))

  return (
    <figure className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <figcaption className="text-[13px] font-semibold text-ink-secondary">
          {title}
          {unit ? <span className="ml-2 font-normal text-ink-muted">{unit}</span> : null}
        </figcaption>
        <button
          type="button"
          className="focus-ring rounded text-[11px] font-semibold text-ink-muted hover:text-ink-secondary"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>

      {/* Legend — present for two or more series; a single series is named by the
          title, so a one-swatch box would just restate it. */}
      {multi ? (
        <ul className="mb-3 flex flex-wrap gap-4 text-xs text-ink-secondary">
          {shown.map((s, i) => (
            <li key={s.name} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-[2px] w-4 rounded-full"
                style={{ background: ACCENT_HEX[ACCENT_ORDER[i] as Accent] }}
              />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}

      {showTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
                <th scope="col" className="py-2 text-left font-bold">
                  Date
                </th>
                {shown.map((s) => (
                  <th key={s.name} scope="col" className="py-2 text-right font-bold">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => (
                <tr key={date} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-ink-secondary">
                    {formatDay(date)}
                  </th>
                  {shown.map((s) => (
                    <td
                      key={s.name}
                      className="py-1.5 text-right text-ink-secondary [font-variant-numeric:tabular-nums]"
                    >
                      {(s.data[i]?.value ?? 0).toLocaleString('en-US')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={containerRef} className="relative w-full">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title}. ${shown.map((s) => s.name).join(', ')} over ${pointCount} days. Use the table view for exact values.`}
            tabIndex={0}
            className="focus-ring w-full touch-none"
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverIndex(null)}
            onKeyDown={handleKey}
            onBlur={() => setHoverIndex(null)}
          >
            {/* Recessive horizontal gridlines — solid hairlines, no vertical grid. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={yAt(t)}
                  y2={yAt(t)}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={yAt(t) + 3}
                  textAnchor="end"
                  className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
                >
                  {Math.round(t).toLocaleString('en-US')}
                </text>
              </g>
            ))}

            {xLabelIndices.map((i) => (
              <text
                key={dates[i]}
                x={xAt(i)}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === pointCount - 1 ? 'end' : 'middle'}
                className="fill-ink-muted text-[10px]"
              >
                {formatDay(dates[i])}
              </text>
            ))}

            {/* Crosshair sits under the marks so it never obscures them. */}
            {hoverIndex !== null ? (
              <line
                x1={hoverX}
                x2={hoverX}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--line-strong)"
                strokeWidth={1}
              />
            ) : null}

            {shown.map((s, i) => {
              const color = ACCENT_HEX[ACCENT_ORDER[i] as Accent]
              const path = s.data
                .map((p, j) => `${j === 0 ? 'M' : 'L'}${xAt(j).toFixed(2)},${yAt(p.value).toFixed(2)}`)
                .join(' ')
              const lastValue = s.data[s.data.length - 1]?.value ?? 0
              return (
                <g key={s.name}>
                  {/* A single series gets a low-alpha area wash for weight; with
                      two or more, overlapping washes would muddy the hues. */}
                  {!multi ? (
                    <path
                      d={`${path} L${xAt(pointCount - 1).toFixed(2)},${(PAD.top + innerH).toFixed(2)} L${xAt(0).toFixed(2)},${(PAD.top + innerH).toFixed(2)} Z`}
                      fill={color}
                      fillOpacity={0.1}
                    />
                  ) : null}
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* End marker: r=4 (8px) with a 2px surface ring. */}
                  <circle
                    cx={xAt(pointCount - 1)}
                    cy={yAt(lastValue)}
                    r={4}
                    fill={color}
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                  {hoverIndex !== null ? (
                    <circle
                      cx={hoverX}
                      cy={yAt(s.data[hoverIndex]?.value ?? 0)}
                      r={4}
                      fill={color}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              )
            })}

            {/* Direct end-labels for 2–4 series. Text wears an ink token; the
                coloured dot beside it carries identity. */}
            {endLabels.map((label) => (
              <g key={label.name}>
                {Math.abs(label.y - label.anchorY) > 1 ? (
                  <line
                    x1={xAt(pointCount - 1) + 5}
                    y1={label.anchorY}
                    x2={PAD.left + innerW + 14}
                    y2={label.y}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                ) : null}
                <circle cx={PAD.left + innerW + 18} cy={label.y} r={3} fill={label.color} />
                <text
                  x={PAD.left + innerW + 26}
                  y={label.y + 3.5}
                  className="fill-ink-secondary text-[11px] font-semibold"
                >
                  {label.name}
                </text>
              </g>
            ))}
          </svg>

          {hoverIndex !== null ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line-strong bg-surface-3 px-2.5 py-2 text-xs shadow-lg"
              style={{ left: tooltipLeft, top: 4 }}
              role="status"
            >
              <div className="mb-1 text-[11px] text-ink-muted">{formatDay(dates[hoverIndex])}</div>
              {shown.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2 whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    className="inline-block h-[2px] w-3 rounded-full"
                    style={{ background: ACCENT_HEX[ACCENT_ORDER[i] as Accent] }}
                  />
                  <span className="font-semibold text-ink [font-variant-numeric:tabular-nums]">
                    {(s.data[hoverIndex]?.value ?? 0).toLocaleString('en-US')}
                    {unitSuffix}
                  </span>
                  <span className="text-ink-secondary">{s.name}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {droppedSeries > 0 ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          Showing the first {shown.length} series; {droppedSeries} more not drawn — past five
          there is no distinguishable hue left.
        </p>
      ) : null}
    </figure>
  )
}

export default UsageChart
