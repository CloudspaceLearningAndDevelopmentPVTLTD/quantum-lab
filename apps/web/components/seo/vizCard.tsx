import { ogCard, ogAlt, type OgAccent, type OgCardInput } from './og'
import { VISUALIZATIONS } from '@/components/ui/Hero'

/**
 * The social card for one visualization route, built from that route's own
 * entry in `VISUALIZATIONS` — title, hook, level and accent all come straight
 * from the catalogue the page itself renders from.
 *
 * Each of the eight `app/visualizations/<slug>/opengraph-image.tsx` files is a
 * short call into this, keyed by its own href. Retitle a visualization in
 * `components/ui/Hero.tsx` and its card, its page metadata and its sitemap
 * entry all follow in the same edit.
 *
 * Imports `VISUALIZATIONS` only — deliberately not the lesson corpus, which is
 * ~180 kB of source and would land in eight separate edge bundles for nothing.
 */

function inputFor(href: string): OgCardInput {
  const viz = VISUALIZATIONS.find((v) => v.href === href)

  // An href with no catalogue entry means someone added a route directory
  // without adding the visualization to VISUALIZATIONS. Render a valid generic
  // card rather than throwing: an image route that errors takes the page's
  // whole metadata response with it, and that is far worse than a plain card.
  if (!viz) {
    return {
      eyebrow: 'Interactive',
      title: 'Qubit16',
      kicker: 'Interactive quantum simulations, computed live in your browser',
    }
  }

  return {
    eyebrow: `${viz.level} · Interactive`,
    title: viz.title,
    kicker: viz.hook,
    accent: viz.accent as OgAccent,
  }
}

export function vizCardAlt(href: string): string {
  return ogAlt(inputFor(href))
}

export function vizCard(href: string) {
  return ogCard(inputFor(href))
}
