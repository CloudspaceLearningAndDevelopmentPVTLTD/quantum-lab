/**
 * completionCard.test.ts — the honesty properties of the self-attested card.
 *
 * Three things matter more than the layout: the SVG must be well-formed XML
 * (a broken card that browsers happen to render would still break the moment
 * someone embeds it), the lesson list must be exactly the completed lessons —
 * never the track's full list padded out — and the wording must carry the
 * "self-reported" disclaimer, because that disclaimer is the entire difference
 * between this card and a fabricated credential.
 *
 * Vitest runs in a plain Node environment (no DOMParser), so well-formedness
 * is checked with a small tag-balancing walk: every element closes, nesting
 * matches, and every bare `&` is an entity. That is not a full XML parser, but
 * it catches the failure modes string concatenation can actually produce here
 * — unclosed tags and unescaped text.
 */

import { describe, expect, it } from 'vitest'
import { CARD_WIDTH, cardHeight, completionCardSvg } from './completionCard'
import { TRACKS, LESSONS } from './lessons'

const FOUNDATIONS = TRACKS.find((t) => t.id === 'foundations')
if (!FOUNDATIONS) throw new Error('fixture requires the foundations track')

const FIXTURE = {
  trackId: 'foundations',
  completedSlugs: [...FOUNDATIONS.lessonSlugs],
  completedAt: '2026-08-16T12:34:56.000Z',
}

function titleOf(slug: string): string {
  const title = LESSONS.find((l) => l.slug === slug)?.title
  if (!title) throw new Error(`no lesson titled for slug ${slug}`)
  return title
}

/** Assert balanced tags and entity-escaped ampersands; throws with detail. */
function assertWellFormed(svg: string): void {
  // Every & must begin an entity — a bare & is the classic concatenation bug.
  const bareAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
  expect(svg).not.toMatch(bareAmp)

  const stack: string[] = []
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g
  let match: RegExpExecArray | null
  let cursor = 0
  while ((match = tag.exec(svg)) !== null) {
    // No stray '<' between tags.
    expect(svg.slice(cursor, match.index)).not.toContain('<')
    cursor = tag.lastIndex
    const [, closing, name, , selfClosing] = match
    if (closing) {
      expect(stack.pop()).toBe(name)
    } else if (!selfClosing) {
      stack.push(name)
    }
  }
  expect(svg.slice(cursor)).not.toContain('<')
  expect(stack).toEqual([])
}

describe('completionCardSvg', () => {
  it('returns null for an unknown track', () => {
    expect(completionCardSvg({ ...FIXTURE, trackId: 'no-such-track' })).toBeNull()
  })

  it('produces well-formed, self-contained SVG', () => {
    const card = completionCardSvg(FIXTURE)
    expect(card).not.toBeNull()
    const svg = card!.svg
    assertWellFormed(svg)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    // Self-contained: no stylesheet classes and no external references —
    // the only URL allowed anywhere is the SVG namespace itself.
    expect(svg).not.toContain('class=')
    expect(svg).not.toContain('href')
    expect(svg).not.toContain('url(')
    expect(svg.match(/https?:\/\//g)).toEqual(['http://'])
  })

  it('reports its own geometry, matching the declared width/height', () => {
    const card = completionCardSvg(FIXTURE)!
    expect(card.width).toBe(CARD_WIDTH)
    expect(card.height).toBe(cardHeight(FIXTURE.completedSlugs.length))
    expect(card.svg).toContain(`width="${card.width}"`)
    expect(card.svg).toContain(`height="${card.height}"`)
    expect(card.fileName).toBe('qubit16-foundations-completion-card')
  })

  it('lists exactly the completed lessons, in track order', () => {
    // Partial progress, deliberately shuffled: the card must list these three
    // (re-ordered to track order) and none of the other four.
    const partial = [
      FOUNDATIONS.lessonSlugs[4]!,
      FOUNDATIONS.lessonSlugs[0]!,
      FOUNDATIONS.lessonSlugs[2]!,
    ]
    const card = completionCardSvg({ ...FIXTURE, completedSlugs: partial })!

    for (const slug of partial) {
      expect(card.svg).toContain(titleOf(slug).replace(/&/g, '&amp;').replace(/'/g, '&apos;'))
    }
    const missing = FOUNDATIONS.lessonSlugs.filter((s) => !partial.includes(s))
    for (const slug of missing) {
      expect(card.svg).not.toContain(titleOf(slug).replace(/&/g, '&amp;').replace(/'/g, '&apos;'))
    }

    // Track order, not the shuffled input order.
    const expectedOrder = FOUNDATIONS.lessonSlugs.filter((s) => partial.includes(s))
    const positions = expectedOrder.map((slug) =>
      card.svg.indexOf(titleOf(slug).replace(/&/g, '&amp;').replace(/'/g, '&apos;'))
    )
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)

    // One tick path per listed lesson.
    expect(card.svg.match(/stroke-linejoin="round"/g)?.length).toBe(partial.length)
    // Honest count label.
    expect(card.svg).toContain(`3 of ${FOUNDATIONS.lessonSlugs.length} lessons`)
    expect(card.height).toBe(cardHeight(3))
  })

  it('ignores completed slugs that are not in the track', () => {
    const card = completionCardSvg({
      ...FIXTURE,
      completedSlugs: ['shor', FOUNDATIONS.lessonSlugs[0]!],
    })!
    expect(card.svg).not.toContain(titleOf('shor'))
    expect(card.svg).toContain(`1 of ${FOUNDATIONS.lessonSlugs.length} lessons`)
  })

  it('carries the self-reported wording and no credential language', () => {
    const card = completionCardSvg(FIXTURE)!
    const lower = card.svg.toLowerCase()
    expect(lower).toContain('self-reported')
    expect(lower).toContain('not a verified credential')
    // The card must never borrow the exam certificates' vocabulary.
    expect(lower).not.toContain('certificate of completion')
    expect(lower).not.toContain('verifiable at')
  })

  it('prints the track name and a stable en-GB date', () => {
    const card = completionCardSvg(FIXTURE)!
    expect(card.svg).toContain('Quantum Foundations')
    expect(card.svg).toContain('16 August 2026')
  })

  it('escapes markup-significant characters from titles', () => {
    // Grover's Search contains an apostrophe in repo data; assert it arrives
    // escaped rather than raw, as a canary for the escaping path.
    const grover = titleOf('grover')
    expect(grover).toContain("'")
    const card = completionCardSvg({
      ...FIXTURE,
      trackId: 'foundations',
      completedSlugs: ['grover'],
    })!
    expect(card.svg).toContain(grover.replace(/'/g, '&apos;'))
    assertWellFormed(card.svg)
  })
})
