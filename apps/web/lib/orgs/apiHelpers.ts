/**
 * orgs/apiHelpers.ts — the boilerplate every classroom route repeats, written once.
 *
 * SERVER ONLY. Imports lib/orgs/access.ts (which reads the service-role key) and
 * the three catalogues; never import it from a client component.
 *
 * The four routes under app/api/orgs/assignments and app/api/orgs/progress all
 * need the same opening: rate limit → verified caller → org role → storage
 * context. The existing seat routes each keep a private copy of that sequence,
 * which is how one of them once ended up with authentication and no
 * authorisation. One copy here, four call sites, and `guard()` cannot return a
 * storage context without having passed the role check, because the context only
 * exists inside `requireOrgRole`'s success branch.
 */

import { NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SIGN_IN_REQUIRED, verifiedCallerId } from '@/lib/security/auth'
import { MANAGE_ROLES, READ_ROLES, requireOrgRole } from '@/lib/orgs/access'
import { apiError, errorForStatus } from '@/lib/apiError'
import { check, clientKey, retryHeaders } from '@/lib/security/ratelimit'
import type { OrgContext } from '@/lib/orgs/store'
import type { OrgMembership } from '@/lib/orgs/access'
import type { KnownRefs } from '@/lib/orgs/assignments'
import { LESSONS } from '@/lib/lessons'
import { CHALLENGES } from '@/lib/challenges/catalogue'
import { EXAMS } from '@/lib/exams/catalogue'

export { MANAGE_ROLES, READ_ROLES }

/** Every rejection in the one shape lib/apiError.ts defines: `{ error, code }`. */
export function bad(message: string, status: number): Response {
  return errorForStatus(status, message)
}

export function signInRequired(): Response {
  return apiError('unauthorized', { message: SIGN_IN_REQUIRED })
}

/**
 * Coursework needs a database.
 *
 * Unlike the seat routes, these handlers refuse rather than answering emptily
 * when Supabase is unconfigured. The reason is asymmetric consequence: a GET
 * that returns nothing is merely unhelpful, but a POST that "succeeds" into a
 * server-side localStorage that does not exist would tell an instructor their
 * assignment was published when no learner will ever see it. The consoles use
 * the browser store directly in that mode — see lib/orgs/classroomClient.ts.
 */
export function notConfigured(): Response {
  return apiError('not_configured', {
    message:
      'Coursework needs a database. This deployment has no Supabase project configured, ' +
      'so assignments and shared progress are kept in your own browser instead.',
  })
}

export function rateLimit(req: Request, bucket: string, perMinute: number): Response | null {
  const limit = check(clientKey(req.headers, bucket), perMinute, 60_000)
  if (limit.allowed) return null
  return apiError('rate_limited', { headers: retryHeaders(limit) })
}

export interface Guarded {
  callerId: string
  membership: OrgMembership | null
  context: OrgContext | undefined
}

export type GuardResult = { ok: true; access: Guarded } | { ok: false; response: Response }

/**
 * Authenticate, then authorise against ONE org, then hand back the storage
 * context — in that order and no other.
 *
 * `orgId` must come from the request; the point of the check is that naming an
 * org you are not a member of gets you a 403 with the same sentence as naming
 * one that does not exist (see NOT_PERMITTED in access.ts — no membership
 * oracle).
 */
export async function guard(
  req: Request,
  orgId: string,
  allowed: readonly ('owner' | 'admin' | 'member')[]
): Promise<GuardResult> {
  if (!isSupabaseConfigured) return { ok: false, response: notConfigured() }

  const callerId = await verifiedCallerId(req)
  if (!callerId) return { ok: false, response: signInRequired() }

  const access = await requireOrgRole(req, orgId, allowed, callerId)
  if (!access.ok) return { ok: false, response: access.response }

  // Belt and braces: requireOrgRole only returns a null callerId on the
  // zero-config path, which the check above already excluded. If that ever
  // changes, refuse rather than proceed with an unidentified caller.
  if (!access.callerId) return { ok: false, response: signInRequired() }

  return {
    ok: true,
    access: {
      callerId: access.callerId,
      membership: access.membership,
      context: access.context,
    },
  }
}

/** `?orgId=` or `body.orgId`, bounded, or a 400. */
export function orgIdFrom(value: unknown): { ok: true; value: string } | { ok: false; response: Response } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, response: bad('orgId is required.', 400) }
  }
  const trimmed = value.trim()
  if (trimmed.length > 128) return { ok: false, response: bad('orgId is too long.', 400) }
  return { ok: true, value: trimmed }
}

/**
 * Catalogue ids this deployment actually has.
 *
 * Built once per module load: all three catalogues are static arrays, so
 * rebuilding these sets per request would be pure waste. `LESSONS` is the
 * metadata module — importing it here does NOT pull lesson bodies into the
 * graph, which lib/lessons/bundle.test.ts exists to keep true.
 */
export const KNOWN_REFS: KnownRefs = {
  lessons: new Set(LESSONS.map((l) => l.slug)),
  challenges: new Set(CHALLENGES.map((c) => c.id)),
  exams: new Set(EXAMS.map((e) => e.id)),
}

export function jsonOk(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status })
}
