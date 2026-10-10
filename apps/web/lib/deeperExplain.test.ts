/**
 * Tests for the "explain one level deeper" feature (lib/deeperExplain.ts +
 * components/lesson/DeeperExplain.tsx).
 *
 * The vitest environment here is plain Node (see vitest.config.ts), so the
 * rendering assertions use react-dom/server's static renderer — enough to
 * prove the button exists per section with the right accessible name — and the
 * network behaviour is tested against the injectable fetch wrappers with a
 * mocked fetch, exactly as the component calls them.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeeperExplain } from '@/components/lesson/DeeperExplain'
import type { LessonBlock } from '@/lib/lessons/types'
import {
  buildDeeperExplainBody,
  interpretDeeperExplainResponse,
  probeTutorTier,
  requestDeeperExplanation,
  sectionAnchors,
  sectionHeading,
  type FetchLike,
} from './deeperExplain'

// ── fixtures ─────────────────────────────────────────────────

const BLOCKS: LessonBlock[] = [
  { kind: 'prose', title: 'What superposition is', paragraphs: ['A qubit…'] },
  { kind: 'callout', tone: 'insight', title: 'Not both at once', body: '…' },
  // Untitled prose continues the section above — no new boundary.
  { kind: 'prose', paragraphs: ['More on the same idea.'] },
  { kind: 'code', language: 'qasm', code: 'h q[0];' },
  { kind: 'prose', title: 'Measuring a superposition', paragraphs: ['When we measure…'] },
  { kind: 'keypoints', points: ['One'] },
  { kind: 'quiz', questions: [] },
]

/** A FetchLike that always resolves with the given status and JSON body. */
function fetchReturning(status: number, body: unknown): FetchLike {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

// ── section boundaries ───────────────────────────────────────

describe('sectionAnchors / sectionHeading', () => {
  it('marks exactly the titled prose blocks as section boundaries', () => {
    expect(sectionAnchors(BLOCKS)).toEqual([
      { index: 0, heading: 'What superposition is' },
      { index: 4, heading: 'Measuring a superposition' },
    ])
  })

  it('gives no boundary to untitled prose or non-prose blocks', () => {
    expect(sectionHeading({ kind: 'prose', paragraphs: ['x'] })).toBeNull()
    expect(
      sectionHeading({ kind: 'callout', tone: 'aside', title: 'Titled!', body: 'x' }),
    ).toBeNull()
  })
})

// ── the component renders per section ────────────────────────

describe('DeeperExplain rendering', () => {
  it('renders one collapsed button per section, named for its heading', () => {
    const anchors = sectionAnchors(BLOCKS)
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        anchors.map((a) =>
          createElement(DeeperExplain, { key: a.index, slug: 'superposition', heading: a.heading }),
        ),
      ),
    )
    expect(html.match(/Explain this differently/g)).toHaveLength(anchors.length)
    expect(html).toContain('Explain “What superposition is” differently')
    expect(html).toContain('Explain “Measuring a superposition” differently')
    // Collapsed by default: the depth choices are not in the initial markup.
    expect(html).not.toContain('More mathematical')
  })
})

// ── request payload ──────────────────────────────────────────

describe('buildDeeperExplainBody', () => {
  it('carries the lesson slug, section heading, and depth in the context hint', () => {
    const body = buildDeeperExplainBody('superposition', 'Measuring a superposition', 'simpler')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('slug: "superposition"')
    expect(body.messages[0].content).toContain('section: "Measuring a superposition"')
    expect(body.messages[0].content).toContain('requested depth: simpler')
  })

  it('maps depths onto the tutor levels the route already understands', () => {
    expect(buildDeeperExplainBody('s', 'h', 'simpler').level).toBe('beginner')
    expect(buildDeeperExplainBody('s', 'h', 'mathematical').level).toBe('advanced')
  })

  it('is what requestDeeperExplanation actually POSTs to /api/agent', async () => {
    const fetchImpl = fetchReturning(200, { reply: 'ok', offline: false, source: 'agent' })
    await requestDeeperExplanation('superposition', 'What superposition is', 'mathematical', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method?: string; body?: string },
    ]
    expect(url).toBe('/api/agent')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body ?? '')).toEqual(
      buildDeeperExplainBody('superposition', 'What superposition is', 'mathematical'),
    )
  })
})

// ── response handling ────────────────────────────────────────

describe('response handling', () => {
  it('turns a 429 into the busy state, even though the body carries a reply', async () => {
    // The route's real 429 shape: error + code + reply + source.
    const result = await requestDeeperExplanation(
      's',
      'h',
      'simpler',
      fetchReturning(429, {
        error: 'Too many questions in a row. Wait a moment and ask again.',
        code: 'rate_limited',
        reply: 'You are asking faster than I can think.',
        source: 'offline',
      }),
    )
    expect(result).toEqual({ kind: 'busy' })
  })

  it('surfaces an offline-tier reply as offline, not as a live answer', async () => {
    const result = await requestDeeperExplanation(
      's',
      'h',
      'simpler',
      fetchReturning(200, { reply: 'Canned FAQ answer.', offline: true, source: 'offline' }),
    )
    expect(result).toEqual({
      kind: 'reply',
      reply: 'Canned FAQ answer.',
      offline: true,
      source: 'offline',
    })
  })

  it('passes a live agent reply through with its source', () => {
    expect(
      interpretDeeperExplainResponse(200, { reply: 'Real answer', offline: false, source: 'agent' }),
    ).toEqual({ kind: 'reply', reply: 'Real answer', offline: false, source: 'agent' })
  })

  it('treats an empty or malformed body as an error with honest copy', () => {
    expect(interpretDeeperExplainResponse(200, { reply: '   ' }).kind).toBe('error')
    expect(interpretDeeperExplainResponse(200, null).kind).toBe('error')
  })

  it('turns a thrown fetch into an error result instead of an unhandled rejection', async () => {
    const failing: FetchLike = async () => {
      throw new TypeError('network down')
    }
    const result = await requestDeeperExplanation('s', 'h', 'simpler', failing)
    expect(result.kind).toBe('error')
  })
})

// ── tier probe (the honesty check) ───────────────────────────

describe('probeTutorTier', () => {
  it('reports the offline tier so the panel can say so before the learner asks', async () => {
    const source = await probeTutorTier(
      fetchReturning(200, { agent: false, anthropic: false, source: 'offline' }),
    )
    expect(source).toBe('offline')
  })

  it('returns null on probe failure or nonsense, never a fabricated tier', async () => {
    expect(await probeTutorTier(fetchReturning(500, {}))).toBeNull()
    expect(await probeTutorTier(fetchReturning(200, { source: 'quantum' }))).toBeNull()
    const failing: FetchLike = async () => {
      throw new Error('boom')
    }
    expect(await probeTutorTier(failing)).toBeNull()
  })
})
