/**
 * session.ts — who is sitting this paper.
 *
 * SERVER ONLY.
 *
 * There are two kinds of candidate and the difference between them is the whole
 * point of this file:
 *
 *   A SIGNED-IN USER is identified by a Supabase access token, verified by
 *   Supabase, exactly as `/api/billing/*` and `/api/orgs/*` do it. Their
 *   attempts are keyed on their account id, which is why an attempt resumes on
 *   a different machine, in a different browser, after the laptop died — the
 *   thing localStorage could never do. Only a user can be issued a certificate.
 *
 *   A GUEST is identified by an httpOnly cookie holding 128 bits of random.
 *   This is a PRACTICE identity and nothing more. It is not signed, and it does
 *   not need to be: forging one gets you somebody else's anonymous practice
 *   attempt, which contains no answer key (the server holds those), grants no
 *   entitlement (a guest resolves to the free plan, so the advanced paper is
 *   refused with a 402 before a single question is drawn), and can never become
 *   a certificate. What guest mode preserves is the property that actually
 *   matters: the questions are still served without answers and the score is
 *   still computed on the server from stored answers.
 *
 * Guest mode is why `/certify/foundations-cert` still works on a deployment
 * with no auth configured. It is not a loophole in the credential — the
 * credential requires an account, and `issueCertificate` refuses a guest.
 */

import { verifiedCaller } from '@/lib/security/auth'
import type { AttemptSubject } from './types'

const GUEST_COOKIE = 'ql_exam_guest'

/** One year. A practice identity that expired mid-sitting would be worse. */
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** `guest_` + 32 hex chars. Anything else in the cookie is ignored. */
const GUEST_ID = /^guest_[0-9a-f]{32}$/

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

function newGuestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `guest_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export interface ResolvedSubject {
  subject: AttemptSubject
  /** Set when a new guest cookie has to be sent back with the response. */
  setCookie?: string
}

/**
 * Resolve the caller.
 *
 * A valid access token always wins over a guest cookie: someone who signs in
 * mid-visit becomes themselves, and their old guest attempts stay behind rather
 * than being adopted. Adopting them would mean a certificate could be earned
 * under an identity that was anonymous when the questions were answered.
 */
export async function resolveSubject(req: Request): Promise<ResolvedSubject> {
  const caller = await verifiedCaller(req)
  if (caller) return { subject: { kind: 'user', id: caller.id } }

  const existing = readCookie(req, GUEST_COOKIE)
  if (existing && GUEST_ID.test(existing)) {
    return { subject: { kind: 'guest', id: existing } }
  }

  const id = newGuestId()
  // `secure` is omitted deliberately: this cookie has to work on
  // http://localhost during development, and it protects a practice session,
  // not a credential. SameSite=Lax is enough to keep it off cross-site
  // requests; httpOnly keeps it out of any script that manages to run.
  const setCookie = `${GUEST_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GUEST_COOKIE_MAX_AGE}`
  return { subject: { kind: 'guest', id }, setCookie }
}

/** Attach a pending guest cookie to a response. No-op when there is none. */
export function withSubjectCookie(res: Response, resolved: ResolvedSubject): Response {
  if (!resolved.setCookie) return res
  res.headers.append('set-cookie', resolved.setCookie)
  return res
}
