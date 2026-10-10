import {
  ogCard,
  ogAlt,
  OG_SIZE,
  OG_CONTENT_TYPE,
  type OgAccent,
  type OgCardInput,
} from '@/components/seo/og'
import { LESSONS, TRACKS, getLesson } from '@/lib/lessons'
import type { Level } from '@/lib/lessons/types'

/**
 * One file, eleven cards: the lesson social card, drawn from the lesson's own
 * record in `lib/lessons`.
 *
 * `generateImageMetadata` rather than a bare `alt` export, because `alt` as a
 * module constant cannot depend on `params` — every lesson would have shared
 * one alt string, which is precisely the hand-maintained-and-wrong outcome this
 * whole route exists to avoid.
 *
 * No `generateStaticParams` here on purpose: without it the image renders on
 * demand and is then cached, instead of building eleven PNGs on every deploy
 * for links that may never be shared. If a cold-start unfurl ever measures slow
 * enough to matter, add it — the page's `generateStaticParams` gives the list.
 */

// nodejs, not edge: Next.js 16 no longer allows the edge runtime on a route
// under a segment with `generateStaticParams` (this one is nested under
// app/learn/[slug], whose page.tsx defines it) — "Edge runtime is not
// supported with `generateStaticParams`." The edge runtime is deprecated in
// Next.js 16 regardless (see the other opengraph-image.tsx routes, which stay
// on edge only because they sit under static segments that this restriction
// does not reach).
export const runtime = 'nodejs'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

interface Props {
  params: Promise<{ slug: string }>
}

/** generateImageMetadata's `params` stays synchronous in Next.js 16. */
interface ImageMetadataProps {
  params: { slug: string }
}

/**
 * Accent by level, matching `LEVEL_PILL` on the home page — a Beginner lesson's
 * card is the same teal as its badge in the course list, so a shared link reads
 * as the same object as the row someone clicked. Lessons carry no accent of
 * their own, and adding a per-lesson colour table here would be a
 * hand-maintained list with nothing keeping it honest.
 */
const ACCENT_BY_LEVEL: Record<Level, OgAccent> = {
  Beginner: 'teal',
  Intermediate: 'violet',
  Advanced: 'amber',
}

function inputFor(slug: string): OgCardInput {
  const lesson = getLesson(slug)

  // Unknown slug: the page itself 404s, so this only runs if a crawler asks for
  // the image of a route that does not exist. Return a valid generic card
  // rather than throwing — an image route that errors takes the whole metadata
  // response down with it.
  if (!lesson) {
    return {
      eyebrow: 'Qubit16',
      title: 'Learn quantum computing',
      kicker: 'A free course from qubits to Grover, with a live simulation in every lesson',
    }
  }

  const index = LESSONS.findIndex((l) => l.slug === slug)
  const track = TRACKS.find((t) => t.lessonSlugs.includes(slug))
  const position = track ? track.lessonSlugs.indexOf(slug) + 1 : index + 1

  return {
    eyebrow: track
      ? `${track.name} · Lesson ${position} of ${track.lessonSlugs.length}`
      : `Lesson ${index + 1}`,
    title: lesson.title,
    kicker: `${lesson.level} · ${lesson.minutes} min · ${lesson.objectives.length} learning objectives`,
    accent: ACCENT_BY_LEVEL[lesson.level],
  }
}

export function generateImageMetadata({ params }: ImageMetadataProps) {
  return [
    {
      id: 'lesson',
      alt: ogAlt(inputFor(params.slug)),
      size: OG_SIZE,
      contentType: OG_CONTENT_TYPE,
    },
  ]
}

export default async function Image({ params }: Props) {
  const { slug } = await params
  return ogCard(inputFor(slug))
}
