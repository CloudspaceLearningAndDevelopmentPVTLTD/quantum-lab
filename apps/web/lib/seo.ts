import type { Metadata } from 'next'

/**
 * seo.ts — one place that knows the site's identity and how a page describes
 * itself to a crawler or a link unfurler.
 *
 * IMPORTANT — the classic silent SEO failure: NEXT_PUBLIC_APP_URL must be set
 * in the production environment. It is baked in at build time, so if the
 * production build runs without it, every canonical URL, every og:url and the
 * sitemap all point at http://localhost:3000. Nothing errors, nothing warns,
 * and the pages simply never rank. Set it in the deployment env, not in .env.local.
 */
export const SITE = {
  // Renamed from "Quantum Lab" to match the qubit16.ai domain — see
  // the internal release plan. This constant drives every page title,
  // OG tag and sitemap entry via pageMetadata() below; the handful of
  // routes that hardcode the name directly in JSX (nav brand, welcome
  // page, layout.tsx metadata) were updated alongside this, not derived
  // from it — grep for "Quantum Lab" to catch anything this pass missed.
  name: 'Qubit16',
  // `??` only falls back on null/undefined, not on an empty string — and
  // both the AWS and Azure deploy scripts' pass-1 web build deliberately
  // pass NEXT_PUBLIC_APP_URL="" (the app's own URL isn't known until after
  // its first deploy). That made SITE.url === "", ORIGIN === "", and
  // `new URL(ORIGIN)` below throw ERR_INVALID_URL, crashing the entire
  // production build before either script's pass 2 ever got the real URL
  // baked in. `||` treats "" as falsy too, so pass 1 gets a safe fallback
  // origin and actually produces a buildable image.
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  description:
    'Interactive quantum visualizations, a browser-based circuit simulator, and an AI tutor that explains what you are seeing.',
  locale: 'en_US',
} as const

/** The site origin with any trailing slash removed, so joins never double up. */
const ORIGIN = SITE.url.replace(/\/+$/, '')

/**
 * Absolute URL for an app-relative path. `/` maps to the bare origin so the
 * home page canonical does not gain a redundant trailing slash.
 */
export function absoluteUrl(path: string): string {
  if (!path || path === '/') return ORIGIN
  return `${ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * metadataBase is what lets relative asset paths (the generated
 * /opengraph-image, for one) resolve to absolute URLs — social scrapers reject
 * relative image references outright.
 */
export const METADATA_BASE = new URL(ORIGIN)

/** Where Google cuts a meta description, near enough. docs/SEO.md's house rule. */
export const MAX_DESCRIPTION = 155

/**
 * Fit a description into a search snippet without ending mid-clause.
 *
 * Hand-written descriptions are already short (lib/seo.test.ts holds them to
 * the limit). This exists for the routes that BUILD theirs from catalogue
 * prose — a challenge brief, a lesson subtitle, a path tagline — where the
 * source text is written to be read on the page and runs to several hundred
 * characters. Those were going out whole: 55 pages over the limit, the worst
 * at 687 characters.
 *
 * Whole sentences are kept while they fit. If even the first sentence is too
 * long, it is cut at a word boundary and marked with an ellipsis.
 */
export function clampDescription(text: string, max: number = MAX_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  let end = -1
  for (const match of clean.matchAll(/[.!?](?=\s)/g)) {
    if (match.index + 1 > max) break
    end = match.index + 1
  }
  // A sentence break only counts if it leaves a description worth showing.
  if (end >= 60) return clean.slice(0, end)

  const cut = clean.lastIndexOf(' ', max - 1)
  return `${clean.slice(0, cut > 0 ? cut : max - 1).replace(/[\s,;:—–-]+$/, '')}…`
}

/**
 * The site-wide social card, app/opengraph-image.tsx.
 *
 * Named explicitly because it does NOT cascade the way the file convention
 * suggests: a route that sets its own `openGraph` object replaces the parent's
 * wholesale, image included. Every page built by pageMetadata() does exactly
 * that, so every such page without its own opengraph-image file — 63 of them
 * when this was found — was being shared with no image at all.
 *
 * It must NOT be named on a route that has its own opengraph-image file. The
 * documented rule is that the file wins, and for og:image on a static route it
 * does — but twitter:image stops falling back to the file once any image is
 * configured, and on /learn/<slug> (whose card comes from
 * generateImageMetadata) the configured image replaced the lesson's own card
 * outright. Both were measured, not assumed. Hence hasOwnSocialCard().
 */
const DEFAULT_OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: `${SITE.name} — learn quantum mechanics by playing with it`,
} as const

/**
 * Routes that ship their own opengraph-image file. A pattern rather than a
 * flag on every caller, and lib/seo.test.ts walks app/ to hold it to the
 * filesystem: add a card file somewhere new and that test fails until this
 * list knows about it.
 */
const OWN_SOCIAL_CARD = [/^\/visualizations\/[^/]+$/, /^\/workbench\/[^/]+$/, /^\/learn\/(?!certificate$)[^/]+$/]

export function hasOwnSocialCard(path: string): boolean {
  return OWN_SOCIAL_CARD.some((pattern) => pattern.test(path))
}

export type PageMetadataInput = {
  /** The page's own name. The " · Qubit16" suffix is added here. */
  title: string
  description: string
  /** App-relative route, e.g. '/simulator'. Used for the canonical and og:url. */
  path: string
  type?: 'website' | 'article'
  /** Private surfaces: keeps them out of the index and out of link previews. */
  noIndex?: boolean
}

/**
 * Build a complete Metadata object for a route.
 *
 * Titles follow one pattern — "<page> · Qubit16" — so a search result page
 * reads consistently. The root title is deliberately left alone in
 * app/layout.tsx; the home page is the one place the long-form title earns its
 * length.
 */
export function pageMetadata({
  title,
  description: rawDescription,
  path,
  type = 'website',
  noIndex = false,
}: PageMetadataInput): Metadata {
  const fullTitle = `${title} · ${SITE.name}`
  const url = absoluteUrl(path)
  const description = clampDescription(rawDescription)
  const images = hasOwnSocialCard(path) ? {} : { images: [DEFAULT_OG_IMAGE] }

  return {
    metadataBase: METADATA_BASE,
    title: fullTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE.name,
      type,
      locale: SITE.locale,
      ...images,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      ...images,
    },
    ...(noIndex
      ? { robots: { index: false, follow: false, nocache: true } }
      : {}),
  }
}
