'use client'

/**
 * CostEstimate — what one submission would actually cost.
 *
 * The API's `note` is rendered verbatim: it is the only place that says these
 * are indicative published rates rather than a quote, and paraphrasing a price
 * disclaimer is how people end up surprised by an invoice.
 */

import { useEffect, useRef } from 'react'
import { announce } from '@/lib/a11y/announce'
import type { CostEstimate as CostEstimateData } from '@/lib/hardware/types'

export interface CostEstimateProps {
  estimate: CostEstimateData | null
  shots: number
  loading: boolean
}

/** Threshold above which a real-money submission gets an explicit caution line. */
const CAUTION_USD = 1

function money(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`
}

export function CostEstimate({ estimate, shots, loading }: CostEstimateProps) {
  /*
   * A11Y (WCAG 4.1.3). This panel is repriced asynchronously by two controls
   * that live elsewhere on the page — the device radiogroup and the shots
   * segmented control. A sighted user watches the number move; without this a
   * screen-reader user changes shots from 1,000 to 20,000 and is told nothing,
   * then presses Submit. This is the one number on the site that is denominated
   * in the user's own money, so it announces every time it settles.
   *
   * Keyed on the rendered sentence rather than on the props, so a re-render
   * that produces the same price says nothing, and `loading` is skipped so the
   * skeleton frame between two estimates does not interrupt.
   */
  const spoken = useRef<string | null>(null)
  useEffect(() => {
    if (loading || !estimate) return
    const message = estimate.is_free
      ? `Estimated cost: free, for ${estimate.shots.toLocaleString('en-US')} shots on ${estimate.backend}.`
      : `Estimated cost: ${money(estimate.estimated_total)} ${estimate.currency} for ${estimate.shots.toLocaleString('en-US')} shots on ${estimate.backend}.${
          estimate.estimated_total > CAUTION_USD
            ? ' This is real money on a real device.'
            : ''
        }`
    if (spoken.current === message) return
    spoken.current = message
    announce(message)
  }, [estimate, loading])

  if (loading) {
    return (
      <div className="card p-4" aria-busy="true">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-3" />
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-surface-3" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-surface-3" />
        <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-surface-3" />
      </div>
    )
  }

  if (!estimate) {
    return (
      <div className="card p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Estimated cost
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Pick a device to price {shots.toLocaleString('en-US')} shots.
        </p>
      </div>
    )
  }

  if (estimate.is_free) {
    return (
      <div className="card p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          Estimated cost
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-q-teal-text">Free</span>
          <span className="text-xs text-ink-muted">
            {estimate.shots.toLocaleString('en-US')} shots on {estimate.backend}
          </span>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-secondary">{estimate.note}</p>
      </div>
    )
  }

  const over = estimate.estimated_total > CAUTION_USD

  return (
    <div className="card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
        Estimated cost
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-ink">
          {money(estimate.estimated_total)}
        </span>
        <span className="text-xs uppercase text-ink-muted">{estimate.currency}</span>
      </div>

      <dl className="mt-3 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-secondary">
            Per shot × {estimate.shots.toLocaleString('en-US')}
          </dt>
          <dd className="font-mono text-ink">
            {money(estimate.per_shot, 5)} → {money(estimate.per_shot * estimate.shots, 4)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-secondary">Task fee</dt>
          <dd className="font-mono text-ink">{money(estimate.task_fee)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-line pt-1.5">
          <dt className="font-semibold text-ink-secondary">Total</dt>
          <dd className="font-mono font-bold text-ink">{money(estimate.estimated_total)}</dd>
        </div>
      </dl>

      {over ? (
        <p className="mt-3 text-[12px] font-semibold leading-relaxed text-q-amber-text">
          This submission is over {money(CAUTION_USD)} of real money on a real device. Simulate it
          first if you are still iterating — you cannot un-charge a QPU task.
        </p>
      ) : null}

      <p className="mt-2.5 text-[12px] leading-relaxed text-ink-secondary">{estimate.note}</p>
    </div>
  )
}

export default CostEstimate
