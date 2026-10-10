import type { Metadata } from 'next'
import { pageMetadata, absoluteUrl } from '@/lib/seo'
import { JsonLd } from '@/components/seo/JsonLd'
import { allCourseSchemas } from '@/components/seo/schema'

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Learn Quantum Computing — Foundations and Advanced',
    // Two corrections from the previous copy, both of which this page can be
    // checked against: Quantum Foundations ends at Grover (Shor is the first
    // Advanced lesson), and "the whole course is free" was only ever true of the
    // foundations track — the advanced four sit behind Pro on the pricing page.
    description:
      'A free seven-lesson path from "what is a qubit" to Grover’s search, plus Shor, error correction, VQE and cryptography. Live simulations throughout.',
    path: '/learn',
  }),
  alternates: {
    canonical: absoluteUrl('/learn'),
    // The Atom feed is only discoverable if it is declared. It cannot go in
    // app/layout.tsx (that file belongs to another workstream and a sitewide
    // feed link would be wrong anyway — the feed is the course, not the site),
    // so it is declared on the two pages the course actually lives under.
    types: { 'application/atom+xml': [{ url: absoluteUrl('/feed.xml'), title: 'Qubit16 lessons' }] },
  },
}

/**
 * The Course nodes are emitted here rather than in `page.tsx` because this
 * layout is the only file in the segment this workstream owns.
 *
 * CONSEQUENCE, ON PURPOSE: a layout wraps its children, so these two Course
 * nodes also appear on every `/learn/<slug>` page. That is why each one carries
 * a stable `@id` (`…/learn#course-foundations`) and each lesson's
 * LearningResource points at that `@id` via `isPartOf` — a consumer resolves
 * both copies to one entity instead of inventing two courses. Without the
 * `@id`s this duplication would be a real bug. Do not remove them.
 */
export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={allCourseSchemas()} />
      {children}
    </>
  )
}
