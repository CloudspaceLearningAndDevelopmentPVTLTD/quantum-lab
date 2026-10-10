'use client'

import { useId, useState } from 'react'
import { fitLine } from '@/lib/quantum/alphaDecay'

/**
 * GeigerNuttallPlot — log₁₀(half-life) against Z_d/√Q, one point per nuclide the reader has
 * added. Filled markers are measured half-lives, hollow ones are the Gamow prediction at the
 * same abscissa, and once two measured points exist a least-squares line is drawn through
 * them. The line is the thing to watch: it is what Geiger and Nuttall found empirically in
 * 1911, seventeen years before anyone could explain it.
 *
 * SVG, because there are at most nine points and one line — nothing here needs a canvas.
 * Each point carries a <title> for hover and the page beneath renders the same numbers as a
 * table, so nothing is colour-alone or hover-alone.
 */

export type GnPoint = {
  id: string
  /** Z_d/√Q. */
  x: number
  /** log₁₀ of the measured half-life in seconds. */
  measured: number
  /** log₁₀ of the predicted half-life in seconds. */
  predicted: number
  measuredLabel: string
  predictedLabel: string
}

const W = 640
const H = 360
const PAD = { l: 52, r: 18, t: 16, b: 44 }

type Props = {
  points: GnPoint[]
  /** Highlight this nuclide. */
  activeId?: string
}

export default function GeigerNuttallPlot({ points, activeId }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const titleId = useId()
  const descId = useId()

  // Fixed axes so the picture does not rescale as points arrive: the whole alpha-emitter
  // family fits inside these.
  const xMin = 26
  const xMax = 48
  const yMin = -9
  const yMax = 21
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const xOf = (x: number) => PAD.l + ((x - xMin) / (xMax - xMin)) * plotW
  const yOf = (y: number) => PAD.t + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const fit = fitLine(points.map((p) => ({ x: p.x, y: p.measured })))
  const fitPredicted = fitLine(points.map((p) => ({ x: p.x, y: p.predicted })))

  const yTicks: { v: number; label: string }[] = [
    { v: -6, label: '1 μs' },
    { v: -3, label: '1 ms' },
    { v: 0, label: '1 s' },
    { v: 2.94, label: '15 min' },
    { v: 4.94, label: '1 day' },
    { v: 7.5, label: '1 year' },
    { v: 10.5, label: '1000 y' },
    { v: 13.5, label: '1 My' },
    { v: 16.5, label: '1 Gy' },
  ]
  const xTicks = [28, 32, 36, 40, 44, 48]

  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[420px]"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>Geiger–Nuttall plot: log half-life against Z over root Q</title>
        <desc id={descId}>
          {points.length === 0
            ? 'No nuclides plotted yet.'
            : `${points.length} nuclide${points.length === 1 ? '' : 's'} plotted. ` +
              (fit
                ? `Measured points fit a line of slope ${fit.slope.toFixed(2)} decades per unit of Z over root Q.`
                : 'Add a second nuclide to draw the line.')}
        </desc>

        {/* Grid and axes */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yOf(t.v)}
              y2={yOf(t.v)}
              stroke="currentColor"
              className="text-ink-muted"
              strokeOpacity={0.15}
            />
            <text
              x={PAD.l - 8}
              y={yOf(t.v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-muted font-mono text-[10px]"
            >
              {t.label}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text
            key={v}
            x={xOf(v)}
            y={H - PAD.b + 16}
            textAnchor="middle"
            className="fill-ink-muted font-mono text-[10px]"
          >
            {v}
          </text>
        ))}
        <text
          x={PAD.l + plotW / 2}
          y={H - 8}
          textAnchor="middle"
          className="fill-ink-secondary text-[11px] font-semibold"
        >
          Z_daughter / √Q (Q in MeV)
        </text>
        <text
          transform={`translate(12 ${PAD.t + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-ink-secondary text-[11px] font-semibold"
        >
          half-life (log scale)
        </text>

        {/* Fit through the predictions, faint, and through the measurements, solid */}
        {fitPredicted ? (
          <line
            x1={xOf(xMin)}
            x2={xOf(xMax)}
            y1={yOf(fitPredicted.intercept + fitPredicted.slope * xMin)}
            y2={yOf(fitPredicted.intercept + fitPredicted.slope * xMax)}
            className="stroke-q-amber"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeOpacity={0.6}
          />
        ) : null}
        {fit ? (
          <line
            x1={xOf(xMin)}
            x2={xOf(xMax)}
            y1={yOf(fit.intercept + fit.slope * xMin)}
            y2={yOf(fit.intercept + fit.slope * xMax)}
            className="stroke-q-violet"
            strokeWidth={2}
          />
        ) : null}

        {/* Points */}
        {points.map((p) => {
          const active = p.id === activeId || p.id === hover
          return (
            <g
              key={p.id}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <title>
                {`${p.id}: measured ${p.measuredLabel}, Gamow model ${p.predictedLabel}`}
              </title>
              {/* Tie line between prediction and measurement */}
              <line
                x1={xOf(p.x)}
                x2={xOf(p.x)}
                y1={yOf(p.measured)}
                y2={yOf(p.predicted)}
                stroke="currentColor"
                className="text-ink-muted"
                strokeOpacity={0.4}
              />
              {/* Bigger invisible hit target */}
              <circle cx={xOf(p.x)} cy={yOf(p.measured)} r={14} fill="transparent" />
              <circle
                cx={xOf(p.x)}
                cy={yOf(p.predicted)}
                r={active ? 6 : 5}
                className="fill-surface-2 stroke-q-amber"
                strokeWidth={2}
              />
              <circle
                cx={xOf(p.x)}
                cy={yOf(p.measured)}
                r={active ? 6 : 5}
                className="fill-q-teal stroke-surface-2"
                strokeWidth={2}
              />
              <text
                x={xOf(p.x) + 9}
                y={yOf(p.measured) - 8}
                className={`font-mono text-[11px] ${active ? 'fill-ink font-bold' : 'fill-ink-secondary'}`}
              >
                {p.id}
              </text>
            </g>
          )
        })}

        {/* Legend, top-left: the points climb from bottom-left to top-right, so this corner
            stays empty however many nuclides are plotted. */}
        <g transform={`translate(${PAD.l + 10} ${PAD.t + 6})`}>
          <circle cx={6} cy={6} r={5} className="fill-q-teal stroke-surface-2" strokeWidth={2} />
          <text x={16} y={7} dominantBaseline="middle" className="fill-ink-secondary text-[11px]">
            measured half-life
          </text>
          <circle cx={6} cy={24} r={5} className="fill-surface-2 stroke-q-amber" strokeWidth={2} />
          <text x={16} y={25} dominantBaseline="middle" className="fill-ink-secondary text-[11px]">
            Gamow prediction
          </text>
          <line x1={0} x2={12} y1={42} y2={42} className="stroke-q-violet" strokeWidth={2} />
          <text x={16} y={43} dominantBaseline="middle" className="fill-ink-secondary text-[11px]">
            fit through measured
          </text>
        </g>
      </svg>
    </div>
  )
}
