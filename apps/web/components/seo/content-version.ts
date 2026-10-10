/**
 * When the course content last actually changed.
 *
 * WHY THIS IS A CONSTANT AND NOT `new Date()`:
 *
 * `app/sitemap.ts` used to stamp every entry with `new Date()`, which means the
 * sitemap claimed that all 45 URLs had been modified at the moment the crawler
 * fetched it. That is false for a site whose lessons are static TypeScript
 * literals, and it is the specific pattern crawlers learn to distrust — once
 * lastmod is noise, it stops being a recrawl signal for the pages that really
 * did change. Google's documentation is explicit that they ignore lastmod when
 * a site's values are demonstrably unreliable.
 *
 * There is no git mtime available at build time (the build runs from a copied
 * tree, and `next build` on Vercel does a shallow clone with rewritten mtimes),
 * so the honest signal is a date a human bumps.
 *
 * BUMP THIS when you add, remove or materially rewrite a lesson, a
 * visualization, a challenge or an exam. Do not bump it for a CSS change, a
 * typo fix, or a refactor — a lastmod that moves for cosmetic edits is the same
 * lie in slower motion.
 *
 * Format is YYYY-MM-DD, parsed as UTC midnight.
 */
export const CONTENT_UPDATED = '2026-10-03'

/** `CONTENT_UPDATED` as a Date, at UTC midnight. */
export function contentUpdatedAt(): Date {
  return new Date(`${CONTENT_UPDATED}T00:00:00.000Z`)
}
