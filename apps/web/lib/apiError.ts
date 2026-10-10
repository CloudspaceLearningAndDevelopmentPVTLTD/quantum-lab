/**
 * apiError.ts — the one error shape every handler under app/api/** returns.
 *
 * WHY A SHAPE AT ALL. Before this module the routes disagreed: some returned
 * `{ error: string }`, the hardware proxy returns `{ detail }` (FastAPI's
 * shape, on purpose — see below), the agent route returns `{ reply, error:
 * true }`, and three billing paths returned an error object with NO status
 * argument, so `NextResponse.json({ error: … })` went out as **HTTP 200** and
 * every `res.ok` check in the browser treated a failure as a success. A caller
 * cannot branch on a shape that changes per route, and a support engineer
 * cannot grep for a code that does not exist.
 *
 * THE SHAPE IS FLAT, NOT NESTED:
 *
 *     { "error": "Human-readable sentence.", "code": "rate_limited" }
 *
 * `{ error: { code, message } }` reads better in isolation and was rejected:
 * eight call sites in components/ and app/ already do
 * `typeof body.error === 'string' ? body.error : …` and would silently start
 * rendering nothing. Flat keeps every existing consumer working while adding
 * the machine-readable half. Do not "tidy" this into a nested object without
 * fixing those call sites in the same change.
 *
 * WHAT NEVER CROSSES THE WIRE. `message` is only ever a sentence this codebase
 * wrote. An exception's `.message`, a stack, a Stripe/Supabase/Anthropic error
 * body, and an upstream 500's text are all withheld and sent to
 * lib/observability/report instead. The reason is not tidiness: provider errors
 * routinely embed record ids, key prefixes, table names and SQL, and a learner
 * -facing error box is the worst place to publish them.
 */

import { NextResponse } from 'next/server'
import { reportError } from '@/lib/observability/report'

/**
 * The closed set of machine-readable codes.
 *
 * Closed on purpose, like `EventName` in lib/analytics/events.ts: a union means
 * a client can exhaustively switch, and the whole vocabulary fits on a screen.
 * Adding a code is a deliberate act — extend this object and document it in
 * docs/OPERATIONS.md § "API error codes".
 */
export const API_ERROR_STATUS = {
  /** The request body or query string did not validate. */
  bad_request: 400,
  /** No credential, or one that did not verify. */
  unauthorized: 401,
  /** Authenticated, but not allowed to do this to this resource. */
  forbidden: 403,
  /** The named resource does not exist, or the caller may not know that it does. */
  not_found: 404,
  /** The request conflicts with current state (already accepted, seat taken). */
  conflict: 409,
  /** Body larger than the route's cap; refused before parsing. */
  payload_too_large: 413,
  /** Rate limit. Always accompanied by Retry-After. */
  rate_limited: 429,
  /** The failure is ours and unexplained. Detail is in the error tracker. */
  internal: 500,
  /** A dependency answered, but with a failure we cannot act on. */
  upstream_error: 502,
  /** The feature needs an environment variable this deployment has not set. */
  not_configured: 503,
  /** A dependency did not answer in time, or refused the connection. */
  upstream_unavailable: 504,
} as const

export type ApiErrorCode = keyof typeof API_ERROR_STATUS

/**
 * The sentence sent when a call site does not supply one.
 *
 * Every one of these is safe to show a learner: it says what happened and, where
 * there is one, what to do. None of them names an internal component.
 */
const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  bad_request: 'That request was not in a shape this endpoint accepts.',
  unauthorized: 'Sign in to continue.',
  forbidden: 'Your account does not have access to that.',
  not_found: 'That does not exist, or is no longer available.',
  conflict: 'That has already been done, or conflicts with the current state.',
  payload_too_large: 'That request was too large. Send less at a time.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  internal: 'Something went wrong on our end. Try again in a moment.',
  upstream_error: 'A service this depends on returned an error. Try again shortly.',
  not_configured: 'That feature is not configured on this deployment.',
  upstream_unavailable: 'A service this depends on is not responding. Try again shortly.',
}

/** The wire body. Exported so route tests and clients can type against it. */
export interface ApiErrorBody {
  /** Human-readable, safe to render verbatim. Never an exception message. */
  error: string
  /** Stable across releases. Branch on this, not on the sentence. */
  code: ApiErrorCode
}

export interface ApiErrorOptions {
  /**
   * Overrides the default sentence. ONLY pass text this repository wrote —
   * typically a validation message naming the caller's own field ("shots must
   * be between 1 and 100000"). Never pass `err.message`.
   */
  message?: string
  /** Overrides the code's default status. Needed almost never. */
  status?: number
  /** Extra response headers, e.g. Retry-After from the limiter. */
  headers?: HeadersInit
}

/**
 * Build the standard error response. Does not log — use `failure()` when there
 * is an exception behind it.
 */
export function apiError(code: ApiErrorCode, options: ApiErrorOptions = {}): NextResponse {
  const body: ApiErrorBody = {
    error: options.message ?? DEFAULT_MESSAGE[code],
    code,
  }
  return NextResponse.json(body, {
    status: options.status ?? API_ERROR_STATUS[code],
    headers: options.headers,
  })
}

/**
 * The caller sent something we cannot use. `message` is expected here, because a
 * validation failure the caller can fix is the one case where being specific
 * helps them and tells an attacker nothing they did not already send us.
 */
export function badRequest(message?: string): NextResponse {
  return apiError('bad_request', { message })
}

/**
 * Something threw. Report the detail server-side, return a code and a sentence.
 *
 * `context` goes through `scrubContext` in lib/observability/report before it
 * leaves the process, so a stray `email` key is dropped rather than shipped.
 * Do not put a question, a circuit, or an email in it deliberately — the
 * scrubber is the backstop, not the policy.
 */
export function failure(
  code: ApiErrorCode,
  err: unknown,
  context?: Record<string, unknown>,
  options: ApiErrorOptions = {}
): NextResponse {
  reportError(err, { ...context, apiErrorCode: code })
  return apiError(code, options)
}

/** The reverse map, for `errorForStatus`. Built once at module load. */
const CODE_BY_STATUS = new Map<number, ApiErrorCode>(
  (Object.keys(API_ERROR_STATUS) as ApiErrorCode[]).map((code) => [
    API_ERROR_STATUS[code],
    code,
  ])
)

/**
 * Adapter for handlers that already speak in status numbers.
 *
 * The org routes each kept a private `bad(message, status)` and call it from
 * about forty places. Rewriting every call site to name a code would be a large
 * diff across four files that three other workstreams also touch, for no
 * behavioural gain — so those helpers delegate here instead and the codes are
 * derived from the status they already pass.
 *
 * An unmapped status falls back to `internal` for 5xx and `bad_request` for
 * everything else, which is the conservative reading: an unrecognised 4xx is
 * the caller's problem and an unrecognised 5xx is ours.
 */
export function errorForStatus(status: number, message?: string): NextResponse {
  // 501 is not one of our codes but the invite routes return it for "this
  // deployment has no SUPABASE_SERVICE_ROLE_KEY, so the seat write cannot be
  // made". That is `not_configured` in every respect except the number, and the
  // number is left alone because changing a status is a behaviour change, not a
  // shape change. Anything else 5xx is genuinely ours and unexplained.
  const code =
    status === 501
      ? 'not_configured'
      : (CODE_BY_STATUS.get(status) ?? (status >= 500 ? 'internal' : 'bad_request'))
  return apiError(code, { message, status })
}

/**
 * True when `body` is our error shape. For clients; also used by the health
 * endpoint when it summarises a probe of one of our own routes.
 */
export function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null) return false
  const rec = body as Record<string, unknown>
  return (
    typeof rec.error === 'string' &&
    typeof rec.code === 'string' &&
    Object.prototype.hasOwnProperty.call(API_ERROR_STATUS, rec.code)
  )
}
