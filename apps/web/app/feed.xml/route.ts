import { LESSONS, TRACKS } from '@/lib/lessons'
import { absoluteUrl, SITE } from '@/lib/seo'
import { contentUpdatedAt } from '@/components/seo/content-version'
import { isLessonFree } from '@/lib/lessons/access'

/**
 * /feed.xml — an Atom feed of the course, in teaching order.
 *
 * WHY ATOM AND NOT RSS. RSS 2.0 has no required, unambiguous date field
 * (`pubDate` is optional and RFC-822, which readers parse inconsistently) and
 * no standard way to say "this entry is a summary, not the article". Atom
 * requires `id`, `title` and `updated` on every entry and dates them in RFC-3339.
 * For a feed whose whole job is "follow this course in order", having a
 * guaranteed stable id per lesson is what stops a reader re-showing all eleven
 * entries every time the file changes.
 *
 * WHY THE ENTRIES ARE SUMMARIES, NOT FULL LESSONS. Every lesson has an inline
 * quiz and an embedded live visualization, and neither survives serialization
 * into a feed reader. Shipping the prose alone would be shipping the worse half
 * of the lesson to someone who then has no reason to open the real one. Each
 * entry is the subtitle, the objectives and a link.
 *
 * ORDER: newest-first is the convention, but this feed is a course and its
 * order is pedagogical — lesson 1 must arrive before lesson 2 or the feed is
 * useless for its one purpose. Entries are in teaching order, and `updated` is
 * the same date on all of them for the same reason (see content-version.ts:
 * lessons carry no per-lesson date, and inventing one would be a lie a reader
 * would act on).
 */

export const dynamic = 'force-static'

/** XML text escape. Lesson prose contains `&`, `<` and quotes routinely. */
function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function trackNameFor(slug: string): string {
  return TRACKS.find((track) => track.lessonSlugs.includes(slug))?.name ?? 'Qubit16'
}

export function GET(): Response {
  const updated = contentUpdatedAt().toISOString()
  const selfUrl = absoluteUrl('/feed.xml')

  const entries = LESSONS.map((lesson) => {
    const url = absoluteUrl(`/learn/${lesson.slug}`)
    const objectives = lesson.objectives.map((o) => `<li>${xml(o)}</li>`).join('')
    const summary =
      `<p>${xml(lesson.subtitle)}</p>` +
      `<p>${xml(`${lesson.level} · ${lesson.minutes} min · ${trackNameFor(lesson.slug)}`)}</p>` +
      `<p>What you will be able to do:</p><ul>${objectives}</ul>`

    return `  <entry>
    <title>${xml(lesson.title)}</title>
    <link rel="alternate" type="text/html" href="${xml(url)}"/>
    <id>${xml(url)}</id>
    <updated>${updated}</updated>
    <category term="${xml(trackNameFor(lesson.slug))}"/>
    <category term="${xml(lesson.level)}"/>
    <rights>${isLessonFree(lesson.slug) ? 'Free to read' : 'Part of the advanced track'}</rights>
    <summary type="html">${xml(summary)}</summary>
  </entry>`
  }).join('\n')

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(`${SITE.name} — lessons`)}</title>
  <subtitle>${xml(
    'The Qubit16 course in teaching order: foundations from qubits to Grover, then the advanced track.'
  )}</subtitle>
  <link rel="self" type="application/atom+xml" href="${xml(selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${xml(absoluteUrl('/learn'))}"/>
  <id>${xml(absoluteUrl('/learn'))}</id>
  <updated>${updated}</updated>
  <author><name>${xml(SITE.name)}</name></author>
${entries}
</feed>
`

  return new Response(body, {
    headers: {
      // `application/atom+xml` is what a reader sniffs for; the charset matters
      // because lesson titles contain ⟩, π and — .
      'Content-Type': 'application/atom+xml; charset=utf-8',
      // The feed only changes when a lesson does, which is rare and manual.
      // An hour of shared-cache freshness costs nothing and keeps a badly
      // behaved reader polling every minute off the origin.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
