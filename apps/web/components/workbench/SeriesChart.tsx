'use client'

/**
 * SeriesChart — a few line series with error bars, on a linear or log₂ y axis.
 *
 * Shared by the workbench pages whose result is "a quantity against a swept
 * parameter, for several settings": entropy against measurement rate per
 * system size, gradient variance against qubit count per cost function.
 *
 * Every point is drawn with its error bar when it has one, because on those
 * pages the error bar is half the result. Series are told apart by colour AND
 * by a legend label with the same marker, never by colour alone.
 */

export type SeriesAccent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'

export interface ChartSeries {
  label: string
  accent: SeriesAccent
  points: { x: number; y: number; err?: number }[]
}

const ACCENT_CLASS: Record<SeriesAccent, string> = {
  violet: 'text-q-violet',
  teal: 'text-q-teal',
  amber: 'text-q-amber',
  rose: 'text-q-rose',
  sky: 'text-q-sky',
}

export const SERIES_ACCENTS: readonly SeriesAccent[] = ['sky', 'amber', 'teal', 'rose', 'violet']

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo]
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

export function SeriesChart({
  series,
  xLabel,
  yLabel,
  ariaLabel,
  yScale = 'linear',
  refX,
  xTicks,
}: {
  series: ChartSeries[]
  xLabel: string
  yLabel: string
  ariaLabel: string
  /** 'log2' plots log₂(y) and labels ticks as powers of two; y ≤ 0 points are dropped. */
  yScale?: 'linear' | 'log2'
  /** A labelled vertical reference line, e.g. a literature value. */
  refX?: { x: number; label: string }
  xTicks?: number[]
}) {
  const W = 620
  const H = 300
  const pad = { l: 56, r: 16, t: 14, b: 42 }
  const ty = (y: number) => (yScale === 'log2' ? Math.log2(y) : y)

  const drawn = series.map((s) => ({
    ...s,
    points: s.points.filter((p) => Number.isFinite(p.y) && (yScale === 'linear' || p.y > 0)),
  }))
  const all = drawn.flatMap((s) => s.points)
  if (all.length === 0) return null

  const xsAll = all.map((p) => p.x)
  const x0 = Math.min(...xsAll, refX?.x ?? Infinity)
  const x1 = Math.max(...xsAll, refX?.x ?? -Infinity)
  const lows = all.map((p) => (yScale === 'linear' ? p.y - (p.err ?? 0) : Math.log2(p.y)))
  const highs = all.map((p) => (yScale === 'linear' ? p.y + (p.err ?? 0) : Math.log2(p.y + (p.err ?? 0))))
  let y0 = yScale === 'linear' ? Math.min(0, ...lows) : Math.floor(Math.min(...lows))
  let y1 = yScale === 'linear' ? Math.max(...highs) : Math.ceil(Math.max(...highs))
  if (y1 === y0) {
    y0 -= 1
    y1 += 1
  }

  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r)
  const sy = (v: number) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b)
  const yTicks =
    yScale === 'linear'
      ? niceTicks(y0, y1)
      : Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((_, i, a) => i % Math.ceil(a.length / 7) === 0)
  const ticksX = xTicks ?? niceTicks(x0, x1, 6)

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 8} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-muted)">
              {yScale === 'log2' ? `2^${v}` : v}
            </text>
          </g>
        ))}
        {ticksX.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
            {v}
          </text>
        ))}
        <text x={(W + pad.l - pad.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">
          {xLabel}
        </text>
        <text
          x={14}
          y={(H - pad.b + pad.t) / 2}
          textAnchor="middle"
          fontSize={11}
          fill="var(--ink-muted)"
          transform={`rotate(-90 14 ${(H - pad.b + pad.t) / 2})`}
        >
          {yLabel}
        </text>

        {refX ? (
          <g>
            <line
              x1={sx(refX.x)}
              x2={sx(refX.x)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="var(--ink-muted)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={sx(refX.x) + 6} y={pad.t + 10} fontSize={11} fill="var(--ink-muted)">
              {refX.label}
            </text>
          </g>
        ) : null}

        {drawn.map((s) => (
          <g key={s.label} className={ACCENT_CLASS[s.accent]} stroke="currentColor" fill="currentColor">
            <path
              d={s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(ty(p.y))}`).join(' ')}
              fill="none"
              strokeWidth={2}
            />
            {s.points.map((p) => {
              const lo = yScale === 'linear' ? p.y - (p.err ?? 0) : Math.max(p.y - (p.err ?? 0), p.y / 4)
              const hi = p.y + (p.err ?? 0)
              return (
                <g key={p.x}>
                  {p.err ? (
                    <line x1={sx(p.x)} x2={sx(p.x)} y1={sy(ty(lo))} y2={sy(ty(hi))} strokeWidth={1.5} opacity={0.6} />
                  ) : null}
                  <circle cx={sx(p.x)} cy={sy(ty(p.y))} r={3.5} stroke="none">
                    <title>{`${s.label} — ${xLabel} ${p.x}: ${p.y.toPrecision(3)}${p.err ? ` ± ${p.err.toPrecision(2)}` : ''}`}</title>
                  </circle>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-secondary">
        {drawn.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full bg-current ${ACCENT_CLASS[s.accent]}`} />
            {s.label}
          </li>
        ))}
      </ul>
    </figure>
  )
}
