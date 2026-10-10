'use client'

/**
 * StatTile — the right form for a single headline number.
 *
 * Per the dataviz form heuristic: one current value (optionally with a trend) is
 * a stat tile, never a one-bar bar chart. The number IS the chart, so there is
 * no plot, no axis, and no hover layer here — the optional sparkline is silent
 * context and the value is always present as text.
 */

import { Sparkline, type Accent } from '@/components/analytics/Sparkline'

export interface StatTileProps {
  label: string
  value: string | number
  /** Signed change vs the previous period, in whatever unit `hint` names. */
  delta?: number
  hint?: string
  accent?: Accent
  sparkline?: number[]
  /**
   * Flip the colour of the delta arrow.
   *
   * Up is NOT automatically good. "Quiz retries", "hints used", or "time to first
   * correct answer" going up is a worse outcome, and painting that green trains
   * people to read the colour instead of the number. The direction of the arrow
   * always follows the sign of the delta; only the colour follows meaning, and
   * the call site is the only place that knows which way is better.
   */
  invertDelta?: boolean
}

function formatValue(value: string | number): string {
  if (typeof value === 'string') return value
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US')
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  accent = 'violet',
  sparkline,
  invertDelta = false,
}: StatTileProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta) && delta !== 0
  const rising = hasDelta && (delta as number) > 0
  const isGood = invertDelta ? !rising : rising
  const deltaColorClass = isGood ? 'text-status-good' : 'text-q-rose-text'

  return (
    <div className="card card-hover p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
        {label}
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        {/* Proportional figures deliberately: tabular-nums makes a large
            standalone number look loose. */}
        <div className="text-3xl font-semibold leading-none text-ink">{formatValue(value)}</div>
        {sparkline && sparkline.length > 0 ? (
          <Sparkline data={sparkline} accent={accent} showArea width={84} height={26} />
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        {/*
          A11Y (WCAG 1.4.1 Use of Colour, Level A). Two things were carried by
          hue alone here. The arrow glyph gives DIRECTION visually, but ▲/▼ are
          read out as "black up-pointing triangle" or skipped entirely depending
          on the screen reader and the user's punctuation level — so it is
          aria-hidden and the direction is spelled out. The MEANING (is this
          movement good or bad — the whole point of `invertDelta`) had no
          non-colour equivalent at all: "hints used ▼ 12" in green and "lessons
          completed ▼ 12" in rose were identical to anyone who cannot separate
          the two hues. Both now say so in text.
        */}
        {hasDelta ? (
          <span className={`font-semibold ${deltaColorClass}`}>
            <span aria-hidden="true">{rising ? '▲' : '▼'}</span>
            <span className="sr-only">{rising ? 'up' : 'down'} </span>
            {Math.abs(delta as number).toLocaleString('en-US')}
            <span className="sr-only">, {isGood ? 'an improvement' : 'a decline'}</span>
          </span>
        ) : null}
        {hint ? <span className="text-ink-secondary">{hint}</span> : null}
      </div>
    </div>
  )
}

/** Matching skeleton, so the dashboard doesn't shift when real data arrives. */
export function StatTileSkeleton({ label }: { label: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
        {label}
      </div>
      <div className="mt-2 h-8 w-20 animate-pulse rounded bg-surface-3" />
      <div className="mt-3 h-3 w-24 animate-pulse rounded bg-surface-2" />
    </div>
  )
}

export default StatTile
