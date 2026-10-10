'use client'

/**
 * PlanBadge — a one-glance marker of which tier something belongs to.
 *
 * Free deliberately reads as neutral rather than "lesser": it is a complete
 * product, so it gets the quiet surface treatment instead of a warning colour.
 */

import { PLAN_BY_ID, type PlanId } from '@/lib/plans'

type Tone = { className: string; style?: { color: string; background: string } }

/**
 * A11Y (WCAG 1.4.3): these were the literal dark-theme hexes — #c1bbfe on
 * rgba(124,106,249,0.16). Measured against the LIGHT card surface (#ffffff)
 * that composite is 1.47:1 violet / 1.28:1 teal / 1.38:1 amber, i.e. the badge
 * text is effectively invisible for every light-theme user. The `--q-*-text`
 * tokens carry the same dark values (so the dark theme is byte-identical at
 * 8.84 / 9.90 / 9.25:1) and darken in light: 8.32 / 7.04 / 6.78:1.
 * Do not put a literal hex back here — it cannot know which theme it is in.
 */
const TONES: Record<PlanId, Tone> = {
  free: { className: 'bg-surface-3 text-ink-secondary' },
  pro: {
    className: '',
    style: { color: 'var(--q-violet-text)', background: 'rgb(var(--q-violet-rgb) / 0.16)' },
  },
  team: {
    className: '',
    style: { color: 'var(--q-teal-text)', background: 'rgb(var(--q-teal-rgb) / 0.16)' },
  },
  edu: {
    className: '',
    style: { color: 'var(--q-amber-text)', background: 'rgb(var(--q-amber-rgb) / 0.16)' },
  },
}

const SIZES = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-[11px]',
} as const

export function PlanBadge({ planId, size = 'md' }: { planId: PlanId; size?: 'sm' | 'md' }) {
  const tone = TONES[planId]
  return (
    <span className={`pill ${SIZES[size]} ${tone.className}`} style={tone.style}>
      {PLAN_BY_ID[planId].name}
    </span>
  )
}

export default PlanBadge
