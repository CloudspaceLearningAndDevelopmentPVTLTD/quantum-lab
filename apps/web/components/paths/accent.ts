import type { PathAccent } from '@/lib/paths/catalogue'

/**
 * Accent → CSS custom properties, resolved at runtime so both themes work.
 * Same scheme as components/ui/FeatureCard: `rgb` for tints, `text` for the
 * contrast-checked text variant of that hue.
 */
export const PATH_ACCENT: Record<PathAccent, { rgb: string; text: string }> = {
  violet: { rgb: 'var(--q-violet-rgb)', text: 'text-q-violet-text' },
  teal: { rgb: 'var(--q-teal-rgb)', text: 'text-q-teal-text' },
  amber: { rgb: 'var(--q-amber-rgb)', text: 'text-q-amber-text' },
  rose: { rgb: 'var(--q-rose-rgb)', text: 'text-q-rose-text' },
  sky: { rgb: 'var(--q-sky-rgb)', text: 'text-q-sky-text' },
}
