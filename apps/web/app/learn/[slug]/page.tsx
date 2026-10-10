import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LessonShell, type LessonHeader } from '@/components/lesson/LessonShell'
import { allSlugs, getLesson } from '@/lib/lessons'
import { getFullLesson } from '@/lib/lessons/server'
import { isLessonFree, previewBlocks } from '@/lib/lessons/access'
import { pageMetadata } from '@/lib/seo'

interface LessonPageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams(): { slug: string }[] {
  return allSlugs().map((slug) => ({ slug }))
}

/**
 * Routed through `pageMetadata` for two things the hand-written version was
 * missing: a canonical URL (every lesson had none, so a link with a tracking
 * query string was a separate indexable page) and the og:/twitter: pairs a link
 * unfurl needs. It also fixes the separator — this route used "—" where all
 * ~56 others use "·".
 *
 * The description is the lesson's subtitle plus its level and length. The
 * subtitle alone is a hook, not an answer to "should I click this"; the level
 * and the minute count are the two facts a person deciding actually wants, and
 * both come from the lesson record so they cannot drift.
 */
export async function generateMetadata(props: LessonPageProps): Promise<Metadata> {
  const params = await props.params;
  const lesson = getLesson(params.slug)

  // A missing lesson means `notFound()` fires below and Next serves a 404 with
  // its own noindex, so this branch only ever titles the response.
  if (!lesson) return { title: 'Lesson not found · Qubit16' }

  return pageMetadata({
    title: lesson.title,
    description: `${lesson.subtitle} ${/^(8|11|18)/.test(String(lesson.minutes)) ? 'An' : 'A'} ${lesson.minutes}-minute ${lesson.level.toLowerCase()} lesson with a live simulation and a quiz.`,
    path: `/learn/${lesson.slug}`,
    type: 'article',
  })
}

/**
 * THE PAYWALL, SERVER HALF.
 *
 * `previewBlocks(lesson, false)` — `false`, unconditionally and for every
 * request. This is not a placeholder for a check that should go here: the app
 * has no server-readable session (Supabase keeps it in browser storage and the
 * access token rides on fetch headers, see lib/security/auth.ts), so this
 * component cannot identify the caller, and a component that cannot identify
 * the caller must not be the one to decide. The paid blocks are served only by
 * `./content/route.ts`, which verifies the token itself.
 *
 * The consequence is the honest one: the HTML is IDENTICAL for an anonymous
 * visitor, a crawler, and a signed-in Pro subscriber's first paint. Googlebot
 * gets the preview a person gets — no cloaking — and the structured data in
 * `layout.tsx` says `isAccessibleForFree: false` with a `hasPart` selector
 * pointing at the withheld section. Pro subscribers get the rest swapped in by
 * `LessonShell` after mount, from the authenticated route.
 *
 * Foundations lessons are untouched by all of this: `previewBlocks` returns
 * every block for them regardless of the `allowed` argument, so the free track
 * is still served in full, statically, to everyone including crawlers.
 */
export default async function LessonPage(props: LessonPageProps) {
  const params = await props.params;
  // `getFullLesson`, not `getLesson`: this is a Server Component and the only
  // place the body is allowed to be read. `getLesson` returns metadata alone.
  const lesson = getFullLesson(params.slug)
  if (!lesson) notFound()

  const preview = previewBlocks(lesson, false)
  // Built field by field rather than spread-minus-blocks. A client component's
  // props are serialised into the RSC payload embedded in the HTML, so passing
  // `lesson` whole would ship every withheld block inside the very document
  // that is supposed to withhold them. Listing the fields means a new one added
  // to `Lesson` fails to compile here until someone decides whether it is
  // public — which is the right way round for a paywall.
  const meta: LessonHeader = {
    slug: lesson.slug,
    title: lesson.title,
    subtitle: lesson.subtitle,
    level: lesson.level,
    minutes: lesson.minutes,
    prerequisites: lesson.prerequisites,
    objectives: lesson.objectives,
  }

  return (
    <LessonShell
      lesson={meta}
      blocks={preview.visible}
      hiddenCount={preview.hidden}
      locked={!isLessonFree(lesson.slug)}
    />
  )
}
