/**
 * deeperExplain.ts — the logic behind "Explain this differently" on lesson pages
 * (components/lesson/DeeperExplain.tsx).
 *
 * Split out of the component for the same reason the rest of lib/ exists: this
 * repo's vitest run is a plain Node environment (see vitest.config.ts), so the
 * request shape, the response interpretation, and the "which sections get a
 * button" decision live here as pure functions the tests can exercise with a
 * mocked fetch, while the .tsx file stays a thin view over them.
 *
 * PAYWALL NOTE: everything here works purely from what the page has already
 * delivered to the browser — a lesson slug and a section heading. Nothing in
 * this module reads lesson bodies, and for a paid lesson the component only
 * ever sees the blocks the entitled page rendered. That is why the context
 * hint carries the heading, not the section text.
 */

import type { LessonBlock } from '@/lib/lessons/types'

// ────────────────────────────────────────────────────────────
// Depths
// ────────────────────────────────────────────────────────────

/** The two re-explanation depths offered on every section (QPlayLearn's pattern). */
export type Depth = 'simpler' | 'mathematical'

export const DEPTH_LABEL: Record<Depth, string> = {
  simpler: 'Simpler',
  mathematical: 'More mathematical',
}

/**
 * Map each depth onto the tutor levels /api/agent already understands, so the
 * route's own LEVEL_GUIDANCE does the register-shifting server-side instead of
 * this client trying to smuggle a second system prompt through a user message.
 */
const DEPTH_LEVEL: Record<Depth, 'beginner' | 'advanced'> = {
  simpler: 'beginner',
  mathematical: 'advanced',
}

const DEPTH_ASK: Record<Depth, string> = {
  simpler:
    'Explain the ideas of this section again in the SIMPLEST possible terms — everyday analogies, no equations, as if I had never seen the maths.',
  mathematical:
    'Explain the ideas of this section again MORE MATHEMATICALLY — show the actual states, operators, or derivations behind the prose, in Dirac notation where it helps.',
}

// ────────────────────────────────────────────────────────────
// Request
// ────────────────────────────────────────────────────────────

/** The subset of the POST /api/agent body this feature sends. */
export interface DeeperExplainBody {
  messages: { role: 'user'; content: string }[]
  level: 'beginner' | 'advanced'
}

/**
 * Build the POST /api/agent payload for one section at one depth.
 *
 * The context hint (lesson slug + section heading + chosen depth) rides at the
 * top of the single user turn — the route accepts no client-supplied system
 * prompt by design (see its INJ-1 notes), and a labelled context line is what
 * its own prompt tells the model to expect from the app.
 */
export function buildDeeperExplainBody(
  slug: string,
  heading: string,
  depth: Depth,
): DeeperExplainBody {
  const content =
    `[Lesson context — slug: "${slug}", section: "${heading}", requested depth: ${depth}]\n` +
    `I am reading the section "${heading}" of that lesson. ${DEPTH_ASK[depth]}`
  return {
    messages: [{ role: 'user', content }],
    level: DEPTH_LEVEL[depth],
  }
}

// ────────────────────────────────────────────────────────────
// Response interpretation
// ────────────────────────────────────────────────────────────

export type TutorSource = 'agent' | 'direct' | 'offline'

/** What the component renders after a request settles. */
export type DeeperExplainResult =
  | { kind: 'reply'; reply: string; offline: boolean; source?: TutorSource }
  /** 429 from the route's rate limiter — friendly copy, not an error state. */
  | { kind: 'busy' }
  | { kind: 'error'; message: string }

const EMPTY_REPLY_MESSAGE =
  'I did not get an answer back that time. Try asking again.'

function asSource(value: unknown): TutorSource | undefined {
  return value === 'agent' || value === 'direct' || value === 'offline'
    ? value
    : undefined
}

/**
 * Interpret a settled /api/agent response. Mirrors ChatPanel's contract with
 * the route — any 200 carries a `reply` — plus the one branch ChatPanel leaves
 * implicit: a 429 (the route's rate limiter) becomes a distinct `busy` state so
 * the panel can say "the tutor is busy" instead of pasting the refusal into the
 * answer slot as if it were an explanation.
 */
export function interpretDeeperExplainResponse(
  status: number,
  body: unknown,
): DeeperExplainResult {
  const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

  if (status === 429 || rec.code === 'rate_limited') return { kind: 'busy' }

  const reply = typeof rec.reply === 'string' ? rec.reply.trim() : ''
  if (!reply) return { kind: 'error', message: EMPTY_REPLY_MESSAGE }

  return {
    kind: 'reply',
    reply,
    offline: rec.offline === true || rec.source === 'offline',
    source: asSource(rec.source),
  }
}

// ────────────────────────────────────────────────────────────
// Fetch wrappers (injectable, so tests mock fetch without a DOM)
// ────────────────────────────────────────────────────────────

/** The sliver of fetch this module needs — both real fetch and a test double fit. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** POST one section-depth question and interpret whatever comes back. */
export async function requestDeeperExplanation(
  slug: string,
  heading: string,
  depth: Depth,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<DeeperExplainResult> {
  try {
    const res = await fetchImpl('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildDeeperExplainBody(slug, heading, depth)),
      signal,
    })
    return interpretDeeperExplainResponse(res.status, await res.json())
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach the tutor. Check your connection and try again.',
    }
  }
}

/**
 * Ask GET /api/agent which tier would answer right now — the same probe
 * ChatPanel makes — so the panel can be honest up front when only the offline
 * FAQ is live instead of pretending a canned answer engaged with the section.
 * `null` means the probe failed; the panel simply shows no tier note.
 */
export async function probeTutorTier(
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<TutorSource | null> {
  try {
    const res = await fetchImpl('/api/agent', { method: 'GET', signal })
    if (!res.ok) return null
    const body = await res.json()
    const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    return asSource(rec.source) ?? null
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────
// Where the button mounts
// ────────────────────────────────────────────────────────────

/**
 * The section boundary a block defines, or null when it defines none. A titled
 * prose block is what a "section" of a lesson IS in this content model — every
 * other kind (callout, code, embed, keypoints, quiz) belongs to the section
 * above it. LessonShell renders one DeeperExplain after each block this names.
 */
export function sectionHeading(block: LessonBlock): string | null {
  return block.kind === 'prose' && block.title ? block.title : null
}

/** Every section boundary in a block list, in order — used by the tests. */
export function sectionAnchors(blocks: LessonBlock[]): { index: number; heading: string }[] {
  const anchors: { index: number; heading: string }[] = []
  blocks.forEach((block, index) => {
    const heading = sectionHeading(block)
    if (heading) anchors.push({ index, heading })
  })
  return anchors
}
