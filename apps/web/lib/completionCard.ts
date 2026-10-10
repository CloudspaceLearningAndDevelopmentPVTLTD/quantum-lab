/**
 * completionCard.ts — the self-attested track-completion card.
 *
 * ── WHY THIS IS NOT A BADGE. ────────────────────────────────────────────────
 *
 * Track completion lives in localStorage (`lib/lessons/progress.ts`): the
 * SERVER NEVER SEES IT, so a server-issued Open Badge assertion claiming "this
 * person completed the Foundations track" would be attesting to something the
 * issuer cannot know. The Open Badge machinery in `lib/certificate.ts` is
 * therefore reserved for the exam certificates, where the server actually
 * graded the work and `/verify/<id>` can answer for it.
 *
 * What track completion honestly supports is a CLIENT-GENERATED card: rendered
 * in the learner's own browser from the learner's own progress, carrying
 * "self-reported" in its printed wording so the claim and its provenance
 * travel together. That is the IBM/Credly-style free shareable micro-badge,
 * minus the part Credly can do and we cannot — third-party attestation.
 *
 * This module is a PURE STRING BUILDER, no DOM: the same function runs in a
 * Node test and in the browser click handler on /learn/certificate. The SVG is
 * self-contained (inline presentation attributes only, no CSS classes, no
 * external fonts or images) so it survives being emailed, embedded or opened
 * from disk, and it is theme-neutral in the sense that it paints its own
 * background rather than inheriting the site's.
 */

import { LESSONS, TRACKS } from './lessons'
import { formatCertificateDate } from './certificate'

// Fixed palette, deliberately independent of the site theme (see header).
const BG = '#0b0f1c'
const INK = '#eef2ff'
const INK_SECONDARY = '#8fa3c8'
const INK_MUTED = '#5b6d8f'
const VIOLET = '#a99dff'
const VIOLET_LIGHT = '#c1bbfe'
const TICK = '#2fd6a5'

const SANS = 'ui-sans-serif, system-ui, sans-serif'

/** Card geometry. Width is fixed; height grows with the lesson list. */
export const CARD_WIDTH = 900
const LESSONS_TOP = 264
const ROW_HEIGHT = 36
const FOOTER_HEIGHT = 118

export function cardHeight(lessonCount: number): number {
  return LESSONS_TOP + lessonCount * ROW_HEIGHT + FOOTER_HEIGHT
}

/**
 * Minimal XML text escaping. Enough for text nodes and quoted attribute
 * values, which are the only places user-influenced strings (track and lesson
 * titles — repo data today, but escaping is cheaper than trusting) end up.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface CompletionCardInput {
  trackId: string
  /** Slugs the learner has finished, as loaded from local progress. */
  completedSlugs: string[]
  /** ISO-8601 timestamp to print as the completion date. */
  completedAt: string
}

export interface CompletionCard {
  svg: string
  width: number
  height: number
  /** Suggested download file name, extension excluded. */
  fileName: string
}

/**
 * Build the card, or null for an unknown track.
 *
 * The lesson list is the INTERSECTION of the track's lessons (in track order)
 * with `completedSlugs` — the card only ever lists work actually marked done,
 * so a caller who passes partial progress gets a card that says exactly that
 * much and no more. /learn/certificate only offers the download once every
 * lesson is complete, but the honesty is enforced here, not there.
 */
export function completionCardSvg(input: CompletionCardInput): CompletionCard | null {
  const track = TRACKS.find((t) => t.id === input.trackId)
  if (!track) return null

  const done = new Set(input.completedSlugs)
  const completedInOrder = track.lessonSlugs.filter((slug) => done.has(slug))
  const titles = completedInOrder.map(
    (slug) => LESSONS.find((lesson) => lesson.slug === slug)?.title ?? slug
  )

  const width = CARD_WIDTH
  const height = cardHeight(titles.length)
  const dateLabel = formatCertificateDate(input.completedAt)
  const countLabel = `${titles.length} of ${track.lessonSlugs.length} lessons`

  const rows = titles
    .map((title, i) => {
      const y = LESSONS_TOP + i * ROW_HEIGHT
      // Tick drawn as a stroked path so it renders identically everywhere —
      // a ✓ glyph would depend on whatever font the viewer happens to have.
      return (
        `<path d="M64 ${y - 5} l6 7 l12 -14" fill="none" stroke="${TICK}" ` +
        `stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<text x="98" y="${y}" fill="${INK}" font-family="${SANS}" ` +
        `font-size="17">${esc(title)}</text>`
      )
    })
    .join('\n  ')

  const footerTop = LESSONS_TOP + titles.length * ROW_HEIGHT + 12

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Self-reported completion card: ${esc(track.name)} track, ${countLabel}, ${esc(dateLabel)}">
  <rect width="${width}" height="${height}" fill="${BG}"/>
  <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="14" fill="none" stroke="${VIOLET}" stroke-opacity="0.7" stroke-width="2"/>
  <text x="56" y="78" fill="${VIOLET_LIGHT}" font-family="${SANS}" font-size="18" font-weight="700" letter-spacing="5">&#9883; QUANTUM LAB</text>
  <text x="${width - 56}" y="78" text-anchor="end" fill="${INK_SECONDARY}" font-family="${SANS}" font-size="14">${esc(dateLabel)}</text>
  <text x="56" y="118" fill="${INK_SECONDARY}" font-family="${SANS}" font-size="13" font-weight="700" letter-spacing="6">TRACK COMPLETION &#183; SELF-REPORTED</text>
  <text x="56" y="172" fill="${INK}" font-family="${SANS}" font-size="38" font-weight="700">${esc(track.name)}</text>
  <text x="56" y="204" fill="${INK_SECONDARY}" font-family="${SANS}" font-size="16">Completed the ${esc(track.name)} track &#183; ${countLabel}</text>
  <line x1="56" y1="228" x2="${width - 56}" y2="228" stroke="${VIOLET}" stroke-opacity="0.3" stroke-width="1"/>
  ${rows}
  <line x1="56" y1="${footerTop}" x2="${width - 56}" y2="${footerTop}" stroke="${VIOLET}" stroke-opacity="0.3" stroke-width="1"/>
  <text x="56" y="${footerTop + 30}" fill="${INK_MUTED}" font-family="${SANS}" font-size="13">Self-reported: this card was generated in the learner&#8217;s browser from progress stored on their own device.</text>
  <text x="56" y="${footerTop + 52}" fill="${INK_MUTED}" font-family="${SANS}" font-size="13">It is not a verified credential. Qubit16 issues verifiable certificates only for server-graded exams.</text>
  <text x="${width - 56}" y="${footerTop + 82}" text-anchor="end" fill="${INK_MUTED}" font-family="${SANS}" font-size="12">quantum-lab &#183; self-directed study</text>
</svg>`

  return {
    svg,
    width,
    height,
    fileName: `qubit16-${track.id}-completion-card`,
  }
}
