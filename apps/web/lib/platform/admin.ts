/**
 * platform/admin.ts — who may edit platform-wide settings.
 *
 * SERVER ONLY. A platform admin is NOT an org admin (`team.admin` is a plan
 * feature any Team buyer gets); it is the operator of this deployment. The
 * list is the env var PLATFORM_ADMIN_EMAILS — comma-separated, case-
 * insensitive — matched against the email Supabase returns for the caller's
 * verified token (lib/security/auth.ts), never against anything in the
 * request. Env rather than a table on purpose: a table an admin edits is a
 * table a compromised admin session can lock everyone out of, and the first
 * admin has to come from somewhere anyway.
 */

import { verifiedCaller, type VerifiedCaller } from '@/lib/security/auth'

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'))
}

export function isPlatformAdminEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const e = email.trim().toLowerCase()
  return e.length > 0 && platformAdminEmails(env).includes(e)
}

export type AdminCheck =
  | { ok: true; caller: VerifiedCaller }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'unconfigured' }

/** Verify the token, then the allow-list. Never throws. */
export async function requirePlatformAdmin(req: Request): Promise<AdminCheck> {
  if (platformAdminEmails().length === 0) return { ok: false, reason: 'unconfigured' }
  const caller = await verifiedCaller(req)
  if (!caller) return { ok: false, reason: 'unauthenticated' }
  if (!isPlatformAdminEmail(caller.email)) return { ok: false, reason: 'forbidden' }
  return { ok: true, caller }
}
