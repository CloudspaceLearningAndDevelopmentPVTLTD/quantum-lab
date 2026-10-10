import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/seo'
import { LESSONS } from '@/lib/lessons'
import { EXAMS } from '@/lib/exams/catalogue'
import { CHALLENGES } from '@/lib/challenges/catalogue'
import { VISUALIZATIONS } from '@/components/ui/Hero'
import { WORKBENCH } from '@/lib/workbench'
import { PATHS } from '@/lib/paths/catalogue'
import { contentUpdatedAt } from '@/components/seo/content-version'
import { GLOSSARY } from '@/lib/glossary/terms'

/**
 * sitemap.ts — the machine-readable list of every PUBLIC route.
 *
 * Everything here is derived from the same data the pages render from, so a new
 * lesson, exam, challenge, visualization or workbench tool appears in the sitemap the moment it
 * is added to its catalogue. Never hardcode the counts.
 *
 * DELIBERATELY EXCLUDED, and each is also `noIndex` at the route and disallowed
 * in robots.ts:
 *
 *   /account, /admin  private surfaces
 *   /instructor       an authoring tool that emits unreviewed model output;
 *                     this file used to list it at priority 0.5
 *   /offline          the service worker's navigation fallback
 *   /api/*            machinery
 *
 * KEPT, despite being thin to a crawler: /circuits, /coach and /insights all
 * read from progress stored in the visitor's own browser, so a crawler sees the
 * empty state. They stay because the empty state is itself a real explanation
 * of what the feature does, and because they are linked from the nav — omitting
 * a linked, indexable page from the sitemap does not stop it being crawled, it
 * only hides it from Search Console's coverage report.
 *
 * On `priority`: it is a hint about the relative importance of pages *within
 * this site*, nothing more. Google has said for years that it largely ignores
 * it, and it is not a ranking lever — do not spend time tuning these numbers.
 *
 * On `lastModified`: it is `CONTENT_UPDATED`, a date a human bumps, and NOT
 * `new Date()`. See components/seo/content-version.ts for why that distinction
 * is the difference between a signal and noise.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = contentUpdatedAt()

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/learn'), changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/visualizations'), changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/workbench'), changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/simulator'), changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/challenges'), changeFrequency: 'weekly', priority: 0.8 },
    { url: absoluteUrl('/welcome'), changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/paths'), changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/glossary'), changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/tutor'), changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/certify'), changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/hardware'), changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/pricing'), changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/educators'), changeFrequency: 'monthly', priority: 0.7 },
    { url: absoluteUrl('/about'), changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/help'), changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/contact'), changeFrequency: 'yearly', priority: 0.4 },
    { url: absoluteUrl('/privacy'), changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl('/terms'), changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl('/compare'), changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/compete'), changeFrequency: 'weekly', priority: 0.6 },
    { url: absoluteUrl('/review'), changeFrequency: 'monthly', priority: 0.4 },
    { url: absoluteUrl('/coach'), changeFrequency: 'monthly', priority: 0.4 },
    { url: absoluteUrl('/insights'), changeFrequency: 'monthly', priority: 0.3 },
    { url: absoluteUrl('/circuits'), changeFrequency: 'monthly', priority: 0.3 },
    { url: absoluteUrl('/learn/certificate'), changeFrequency: 'yearly', priority: 0.3 },
  ]

  for (const path of PATHS) {
    entries.push({
      url: absoluteUrl(`/paths/${path.slug}`),
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }

  for (const lesson of LESSONS) {
    entries.push({
      url: absoluteUrl(`/learn/${lesson.slug}`),
      changeFrequency: 'monthly',
      priority: 0.8,
    })
  }

  for (const viz of VISUALIZATIONS) {
    entries.push({
      url: absoluteUrl(viz.href),
      changeFrequency: 'monthly',
      priority: 0.8,
    })
  }

  for (const tool of WORKBENCH) {
    entries.push({
      url: absoluteUrl(tool.href),
      changeFrequency: 'monthly',
      priority: 0.8,
    })
  }

  for (const term of GLOSSARY) {
    entries.push({
      url: absoluteUrl(`/glossary/${term.id}`),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  for (const challenge of CHALLENGES) {
    entries.push({
      url: absoluteUrl(`/challenges/${challenge.id}`),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  for (const exam of EXAMS) {
    entries.push({
      url: absoluteUrl(`/certify/${exam.id}`),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  return entries.map((entry) => ({ ...entry, lastModified }))
}
