'use client'

import { useMemo, useState } from 'react'

export interface HistogramDatum {
  label: string
  value: number
}

/**
 * Measurement-outcome histogram.
 *
 * This is ONE series (counts per basis state), so it uses a single hue —
 * no rainbow across bars, and no legend box (the title names the series).
 * Bars carry a hover tooltip; the top outcomes are direct-labelled.
 */
export function Histogram({
  data,
  title,
  total,
  unit = 'shots',
  highlight,
  maxBars = 16,
}: {
  data: HistogramDatum[]
  title?: string
  total?: number
  unit?: string
  /** Labels to draw in the accent hue — e.g. the states theory predicts. */
  highlight?: string[]
  maxBars?: number
}) {
  const [hover, setHover] = useState<number | null>(null)

  const { bars, sum, truncated } = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    const sum = sorted.reduce((acc, d) => acc + d.value, 0)
    const shown = sorted.slice(0, maxBars)
    // Keep basis-state order stable left-to-right once we've picked the top N
    shown.sort((a, b) => a.label.localeCompare(b.label))
    return { bars: shown, sum, truncated: sorted.length - shown.length }
  }, [data, maxBars])

  const denom = total ?? sum
  const max = Math.max(...bars.map((b) => b.value), 1)

  /**
   * A11Y: the chart's accessible name used to be the title alone — "Measurement
   * outcomes" tells a screen-reader user that a chart exists and nothing about
   * what it says. Summarise the actual distribution instead. (The full numbers
   * remain available via HistogramTable, which callers can toggle to.)
   */
  const description = (() => {
    const ranked = [...bars].sort((a, b) => b.value - a.value)
    const top = ranked
      .slice(0, 4)
      .map(
        (b) =>
          `${b.label} ${b.value.toLocaleString('en-US')} ${unit}${
            denom ? `, ${((b.value / denom) * 100).toFixed(1)} percent` : ''
          }`
      )
      .join('; ')
    const scope =
      ranked.length > 4
        ? `Top 4 of ${ranked.length} outcomes drawn: `
        : `${ranked.length} outcome${ranked.length === 1 ? '' : 's'}: `
    const tail = truncated > 0 ? ` ${truncated} rarer outcome${truncated === 1 ? '' : 's'} not drawn.` : ''
    return `${title ?? 'Measurement outcomes'}${
      denom ? `, ${denom.toLocaleString('en-US')} ${unit} total` : ''
    }. ${scope}${top}.${tail}`
  })()

  if (!bars.length) {
    return (
      <div className="grid h-40 place-items-center text-sm text-ink-muted">
        Run the circuit to see measurement results.
      </div>
    )
  }

  return (
    <figure className="w-full">
      {title ? (
        <figcaption className="mb-4 text-[13px] font-semibold text-ink-secondary">
          {title}
          {denom ? (
            <span className="ml-2 font-normal text-ink-muted">
              {denom.toLocaleString('en-US')} {unit}
            </span>
          ) : null}
        </figcaption>
      ) : null}

      <div className="flex h-48 items-end gap-[2px]" role="img" aria-label={description}>
        {bars.map((b, i) => {
          const pct = denom ? (b.value / denom) * 100 : 0
          const h = (b.value / max) * 100
          const isHot = highlight?.includes(b.label)
          const isHover = hover === i
          return (
            <div
              key={b.label}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              // RESPONSIVE: a touch screen has no hover, so the per-bar readout
              // (the exact count and percentage) was unreachable on a phone —
              // the only remaining source was HistogramTable, which not every
              // caller renders. Tap pins it; tap again, or tap another bar, to
              // move it. `onPointerDown` covers mouse, pen and touch in one
              // handler, and does not fight the mouse handlers above because a
              // mouse press is always preceded by an enter.
              onPointerDown={() => setHover((current) => (current === i ? null : i))}
            >
              {isHover ? (
                // RESPONSIVE: the tooltip is ~150px wide over a ~85px column at
                // 390px, so centring it on the first or last bar pushed it past
                // the figure's edge. Pin it to the near edge instead.
                <div
                  className={`pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs shadow-lg ${
                    i === 0
                      ? 'left-0'
                      : i === bars.length - 1
                        ? 'right-0'
                        : 'left-1/2 -translate-x-1/2'
                  }`}
                >
                  <span className="font-mono text-q-violet-text">|{b.label}⟩</span>
                  <span className="ml-2 text-ink-secondary">
                    {b.value.toLocaleString('en-US')} · {pct.toFixed(1)}%
                  </span>
                </div>
              ) : null}

              <div
                className="rounded-t transition-[height,opacity] duration-500"
                style={{
                  height: `${Math.max(h, b.value > 0 ? 1.5 : 0)}%`,
                  background: isHot ? 'var(--q-teal)' : 'var(--q-violet)',
                  opacity: hover === null || isHover ? 1 : 0.55,
                }}
              />
            </div>
          )
        })}
      </div>

      {/* Axis labels — only render when they can be read */}
      <div className="mt-2 flex gap-[2px]">
        {bars.map((b) => (
          <div
            key={b.label}
            className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-ink-muted"
            title={b.label}
          >
            {bars.length <= 8 ? `|${b.label}⟩` : b.label}
          </div>
        ))}
      </div>

      {truncated > 0 ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          Showing the {bars.length} most frequent outcomes; {truncated} rarer outcome
          {truncated === 1 ? '' : 's'} not drawn.
        </p>
      ) : null}
    </figure>
  )
}

/** Compact table view of the same data — keeps results accessible without colour. */
export function HistogramTable({ data, total }: { data: HistogramDatum[]; total?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const denom = total ?? sorted.reduce((a, d) => a + d.value, 0)
  return (
    <table className="w-full text-sm">
      {/* A11Y: an unnamed <table> is just "table" in a screen reader's table
          list. The caption is visually hidden because the callers already
          render their own heading above it. */}
      <caption className="sr-only">
        Measurement outcomes by basis state{denom ? `, ${denom.toLocaleString('en-US')} shots total` : ''}
      </caption>
      <thead>
        <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
          {/* A11Y: without scope="col" the header/data relationship is a guess. */}
          <th scope="col" className="py-2 text-left font-bold">
            State
          </th>
          <th scope="col" className="py-2 text-right font-bold">
            Count
          </th>
          <th scope="col" className="py-2 text-right font-bold">
            Probability
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((d) => (
          <tr key={d.label} className="border-b border-line last:border-0">
            {/* A11Y: the basis state is the row header — with scope="row" a
                screen reader reads "|01⟩, Count 254" instead of a bare number.
                tests/e2e/simulator.spec.ts selects `tbody tr th:first-child`
                to match. */}
            <th scope="row" className="py-2 text-left font-mono font-normal text-q-violet-text">
              |{d.label}⟩
            </th>
            <td className="py-2 text-right text-ink-secondary">{d.value.toLocaleString('en-US')}</td>
            <td className="py-2 text-right text-ink-secondary">
              {denom ? ((d.value / denom) * 100).toFixed(1) : '0.0'}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
