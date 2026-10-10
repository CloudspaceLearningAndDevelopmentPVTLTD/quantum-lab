import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/seo'

/**
 * robots.ts — /robots.txt is GENERATED from this file at build time.
 *
 * Do not add a hand-written public/robots.txt. A static file in public/ is
 * served ahead of the generated route, so it would silently shadow everything
 * below — including the sitemap reference — with no build error to notice.
 *
 * WHAT IS DISALLOWED AND WHY. Each of these also carries `noIndex` in its own
 * route metadata and is absent from the sitemap; the three mechanisms cover
 * different holes and none of them is access control.
 *
 *   /api/       machinery. Not documents.
 *   /account    a signed-in surface. Renders an empty shell to a crawler.
 *   /admin      internal console.
 *   /instructor a course-authoring tool whose output is unreviewed model text
 *               about quantum mechanics. Indexing it publishes that text under
 *               this site's name. Added after it was found in the sitemap.
 *   /offline    the service worker's navigation fallback. As a search result it
 *               is a page that says "you are offline" to someone who is not.
 *
 * Everything else is meant to be found.
 *
 * NO PER-CRAWLER RULES FOR AI BOTS (GPTBot, ClaudeBot, PerplexityBot, etc).
 * `userAgent: '*'` with `allow: '/'` already covers them — they are not a
 * special case that needs naming, and adding explicit rules for them here
 * would only be a way to accidentally narrow what they can see relative to
 * everyone else. `public/llms.txt` (a plain static file, not generated from
 * this file — see its own comment for why) gives AI answer engines a short,
 * honest summary of the site to quote directly, which is the actual
 * AI-visibility lever; robots access was never the gap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/admin', '/instructor', '/offline'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  }
}
