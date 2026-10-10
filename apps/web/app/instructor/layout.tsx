import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

/**
 * `/instructor` is a course-authoring tool, not a page anyone should reach from
 * a search for quantum computing. It composes model prompts from lesson data
 * and returns drafts that are explicitly not fact-checked — see the warning the
 * page itself renders. Indexing it puts unreviewed model output about quantum
 * mechanics into search results under this site's name.
 *
 * So: `noIndex` here, `/instructor` in the robots.ts disallow list, and no
 * sitemap entry. Three places, because each one covers a hole the others do not
 * — robots.txt stops a polite crawler fetching it, the meta tag stops a page
 * that was reached by a link from being indexed, and the sitemap omission stops
 * us actively submitting it. The page stays fully reachable to anyone with the
 * URL; this is not an access control.
 *
 * The metadata previously lived in page.tsx. It moved here so the canonical and
 * the robots directive come from `pageMetadata` like every other route's.
 */
export const metadata: Metadata = pageMetadata({
  title: 'Instructor',
  description:
    'Set lessons, challenges and exams for a cohort with a due date, see who has finished them, export a gradebook CSV, and draft course material with the co-pilot.',
  path: '/instructor',
  noIndex: true,
})

export default function InstructorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
