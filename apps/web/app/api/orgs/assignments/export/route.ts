/**
 * GET /api/orgs/assignments/export?orgId= — the gradebook CSV.
 *
 * LMS grade passback was removed as unbuildable (docs/ROADMAP.md), so this file
 * is how a mark reaches an institution's own gradebook. It is therefore the one
 * export that has to be boring and exact: one row per (learner × assignment),
 * stable order, four-valued status, and `not_shared` never collapsed into
 * `not_started`. All of that lives in `assignmentsCsv()` in
 * lib/orgs/assignments.ts, with its own tests; this handler is the gate and the
 * headers.
 *
 * Owner or admin of THIS org only. The file contains every learner's email
 * address and their completion record, which makes it the most sensitive
 * response in the classroom feature.
 */

import { MANAGE_ROLES, bad, guard, orgIdFrom, rateLimit } from '@/lib/orgs/apiHelpers'
import { assignmentsCsv, csvFilename, type CohortMemberProgress } from '@/lib/orgs/assignments'
import { listAssignments, listProgress } from '@/lib/orgs/classroomStore'
import { listMembers } from '@/lib/orgs/store'
import { reportError } from '@/lib/observability/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  // Tighter than the JSON routes: this is a whole-cohort dump, and there is no
  // legitimate reason to pull it more than a few times a minute.
  const limited = rateLimit(req, 'orgs-export', 10)
  if (limited) return limited

  try {
    const orgId = orgIdFrom(new URL(req.url).searchParams.get('orgId'))
    if (!orgId.ok) return orgId.response

    const access = await guard(req, orgId.value, MANAGE_ROLES)
    if (!access.ok) return access.response
    const ctx = access.access.context

    const [assignments, members, shared] = await Promise.all([
      listAssignments(orgId.value, ctx),
      listMembers(orgId.value, ctx),
      listProgress(orgId.value, ctx),
    ])
    const byUser = new Map(shared.map((row) => [row.userId, row]))

    const rows: CohortMemberProgress[] = members.map((member) => {
      const row = member.userId ? byUser.get(member.userId) : undefined
      const out: CohortMemberProgress = {
        memberId: member.id,
        email: member.email,
        role: member.role,
        userId: member.userId,
        snapshot: row ? row.snapshot : null,
      }
      if (row) {
        out.sharedAt = row.updatedAt
        out.completedAt = row.completions
      }
      return out
    })

    const body = assignmentsCsv(assignments, rows)
    return new Response(body, {
      status: 200,
      headers: {
        // charset is not optional here: an accented name in a title or an email
        // is mojibake in Excel without it.
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFilename(orgId.value, new Date().toISOString())}"`,
        // A gradebook export must never be served from a cache — not the
        // browser's, not a CDN's. It is per-caller data behind an auth header.
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[api/orgs/assignments/export GET]', err)
    reportError(err, { route: 'api/orgs/assignments/export GET' })
    return bad('Could not build the export. Try again in a moment.', 500)
  }
}
