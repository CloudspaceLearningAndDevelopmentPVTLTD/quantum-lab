/**
 * protocol.ts — the parsing/composition seam behind /embed/circuit.
 *
 * The embed page is a client component that reads its circuit from the URL and
 * talks to its host page over postMessage. Everything that can be tested
 * without a browser lives HERE, as plain functions over plain data, so the
 * page itself is nothing but wiring. Two hard rules shape this module:
 *
 *  1. EVERYTHING ARRIVING IS HOSTILE. The `?c=` token and every postMessage
 *     payload come from an arbitrary web page framing us (postMessage carries
 *     no CSP protection — ANY window that gets a reference to ours can send).
 *     So every input is bounded (length caps), parsed by the same strict
 *     `fromQasm` the simulator uses, and clamped to the anonymous-tier qubit
 *     limit. A bad input degrades to `null`, never to a throw: the embed must
 *     render an empty editor, not a crash inside someone else's page.
 *
 *  2. NOTHING PRIVATE LEAVES. Outbound messages are built here so tests can
 *     assert their exact shape — counts, shots, qasm and a type tag, nothing
 *     else. The embed page runs unauthenticated by design (see docs/EMBED.md),
 *     so there is nothing sensitive to leak, and this module keeps it that way.
 */

import { fromQasm, type Circuit, type RunResult } from '@/lib/quantum'
import { decodeCircuit } from '@/lib/share-link'
import { PLAN_BY_ID } from '@/lib/plans'

/**
 * Embeds run without an account, so they get exactly what an anonymous visitor
 * to /simulator gets. Read from lib/plans.ts rather than typed here for the
 * same reason app/simulator/layout.tsx reads its numbers from there: a copied
 * constant is a lie waiting for the next pricing change.
 */
export const EMBED_MAX_QUBITS = PLAN_BY_ID.free.limits.maxQubits

/** Shots per run. Fixed: an embed is a demo surface, not a workbench. */
export const EMBED_SHOTS = 1024

/**
 * Upper bound on any QASM or token string we will even look at. The widest
 * legitimate program (16 qubits, hundreds of gates) serialises well under 8 KB;
 * beyond that the only senders are bugs and abuse, and `fromQasm` on megabytes
 * of attacker-chosen text is CPU we refuse to spend inside a host's page.
 */
export const MAX_INPUT_LENGTH = 16_384

/** Message types, named once so page, loader and docs cannot drift apart. */
export const MSG_READY = 'ql:ready' as const
export const MSG_LOAD = 'ql:load' as const
export const MSG_RESULT = 'ql:result' as const

export interface ReadyMessage {
  type: typeof MSG_READY
}

export interface ResultMessage {
  type: typeof MSG_RESULT
  counts: Record<string, number>
  shots: number
}

/** What the embed page needs to know, extracted from its own URL. */
export interface EmbedParams {
  /** null = no/invalid token; the page shows an empty editor. */
  circuit: Circuit | null
  /** true = viewer can look and run but not edit. */
  readonly: boolean
}

/** Drop ops that reference qubits outside the allowed register width. */
function clampToLimit(circuit: Circuit): Circuit | null {
  if (circuit.numQubits <= EMBED_MAX_QUBITS) return circuit
  const ops = circuit.ops.filter((op) => op.qubits.every((q) => q >= 0 && q < EMBED_MAX_QUBITS))
  // A circuit whose every op was out of range carries no information — treat
  // it like a bad token rather than rendering a misleadingly empty grid.
  if (ops.length === 0) return null
  return { numQubits: EMBED_MAX_QUBITS, ops }
}

/**
 * Parse the embed page's query string (`window.location.search`, `?` included
 * or not). `?c=` is the exact token `encodeCircuit`/buildShareUrl produce, so
 * a /simulator share link's token drops straight into an embed URL.
 * `?readonly=1` locks the grid.
 */
export function parseEmbedSearch(search: string): EmbedParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const readonly = params.get('readonly') === '1'
  const token = params.get('c') ?? ''
  if (!token || token.length > MAX_INPUT_LENGTH) return { circuit: null, readonly }
  const decoded = decodeCircuit(token)
  return { circuit: decoded ? clampToLimit(decoded) : null, readonly }
}

/**
 * Validate an incoming postMessage payload as a `ql:load` request.
 * Returns the parsed circuit, or null for anything that is not an exact,
 * well-formed, in-bounds load message. `data` is `MessageEvent.data` — i.e.
 * fully attacker-controlled — which is why every property access is guarded
 * and the QASM text goes through the strict parser, never anywhere else.
 */
export function parseLoadMessage(data: unknown): Circuit | null {
  if (typeof data !== 'object' || data === null) return null
  const msg = data as { type?: unknown; qasm?: unknown }
  if (msg.type !== MSG_LOAD) return null
  if (typeof msg.qasm !== 'string') return null
  if (msg.qasm.length === 0 || msg.qasm.length > MAX_INPUT_LENGTH) return null
  const circuit = fromQasm(msg.qasm)
  if (!circuit || circuit.ops.length === 0) return null
  return clampToLimit(circuit)
}

/**
 * Build the message posted to the parent after a run. Constructed field by
 * field — never by spreading `RunResult` — so a future field added to the
 * simulator's result type does not silently start crossing the frame boundary.
 * (protocol.test.ts pins this by asserting the exact key set.)
 */
export function buildResultMessage(result: RunResult): ResultMessage {
  return { type: MSG_RESULT, counts: { ...result.counts }, shots: result.shots }
}

/** The handshake message: tells the host loader the iframe is listening. */
export function buildReadyMessage(): ReadyMessage {
  return { type: MSG_READY }
}
