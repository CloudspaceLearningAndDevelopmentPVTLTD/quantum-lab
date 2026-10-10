import { NextResponse } from 'next/server'
import { verifiedCaller } from '@/lib/security/auth'
import { isPlatformAdminEmail, platformAdminEmails } from '@/lib/platform/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/me — "am I a platform admin?" for the UI, so the console
 * link is shown to the right people and nobody else. The answer is a boolean
 * plus whether admins are configured at all; it never lists the admins.
 */
export async function GET(req: Request): Promise<Response> {
  const configured = platformAdminEmails().length > 0
  const caller = await verifiedCaller(req)
  const admin = Boolean(caller && configured && isPlatformAdminEmail(caller.email))
  return NextResponse.json({ admin, configured }, { status: 200 })
}
