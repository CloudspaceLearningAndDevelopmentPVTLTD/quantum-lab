import Link from 'next/link'

type Accent = 'violet' | 'teal' | 'amber' | 'rose' | 'sky'

/**
 * Both halves resolve through CSS custom properties so the card re-themes with
 * no JS: `--q-*-rgb` is the channel triple the tint needs, `--q-*-text` is the
 * contrast-checked text variant for that hue. Hardcoded dark-theme hexes here
 * (the old `text-[#c1bbfe]`) measured ~1.6:1 on a white surface.
 */
const ACCENTS: Record<Accent, { rgb: string; text: string }> = {
  violet: { rgb: 'var(--q-violet-rgb)', text: 'text-q-violet-text' },
  teal: { rgb: 'var(--q-teal-rgb)', text: 'text-q-teal-text' },
  amber: { rgb: 'var(--q-amber-rgb)', text: 'text-q-amber-text' },
  rose: { rgb: 'var(--q-rose-rgb)', text: 'text-q-rose-text' },
  sky: { rgb: 'var(--q-sky-rgb)', text: 'text-q-sky-text' },
}

/**
 * Linked card used across the site for features, concepts and visualizations.
 * Server component: purely presentational, no client state.
 */
export function FeatureCard({
  href,
  icon,
  title,
  description,
  tag,
  accent = 'violet',
  headingLevel = 3,
}: {
  href: string
  icon: string
  title: string
  description: string
  tag?: string
  accent?: Accent
  /**
   * The card's title is a real heading, so it has to fit the page's outline.
   * 3 is right where a grid of cards sits under an <h2> section header (the
   * home page). Pages whose grid hangs directly off the <h1> must pass 2 —
   * otherwise the outline jumps h1 → h3, which tests/e2e/a11y.spec.ts fails.
   */
  headingLevel?: 2 | 3 | 4
}) {
  const { rgb, text } = ACCENTS[accent]
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  return (
    <Link
      href={href}
      className="card card-accent-hover focus-ring block p-5 transition-transform duration-200 hover:-translate-y-0.5"
      style={{ '--card-accent-rgb': rgb } as React.CSSProperties}
    >
      <div
        className="grid h-[44px] w-[44px] place-items-center rounded-xl text-xl"
        style={{ backgroundColor: `rgb(${rgb} / 0.15)` }}
        aria-hidden="true"
      >
        {icon}
      </div>

      <Heading className="mt-4 text-base font-bold text-ink">{title}</Heading>
      <p className="mt-1.5 text-sm text-ink-secondary">{description}</p>

      {tag ? (
        <span
          className={`pill mt-4 inline-flex ${text}`}
          style={{ backgroundColor: `rgb(${rgb} / 0.15)` }}
        >
          {tag}
        </span>
      ) : null}
    </Link>
  )
}
