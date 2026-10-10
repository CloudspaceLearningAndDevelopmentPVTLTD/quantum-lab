/**
 * /api/exams/[examId]/attempt — the paper.
 *
 * GET  → the caller's situation with this exam: no attempt, one in progress
 *        (with the paper, answers stripped of every key), or a graded result.
 * POST → start a paper, or hand back the one already running.
 *
 * Thin on purpose: every gate is in `lib/exams/service.ts`, where the whole
 * chain can be read in one place. The one thing worth noticing here is what the
 * GET response does NOT contain — no `correctIds`, no `correctNumber`, no
 * `tolerance`, no `explanation`. `lib/exams/boundary.test.ts` asserts that by
 * walking the actual response body, so it fails if a future edit spreads an
 * `ExamQuestion` into the payload.
 *
 * `dynamic = 'force-dynamic'`: the response depends on a bearer token and a
 * cookie. A cached exam paper would be one candidate's attempt served to
 * another.
 */

import { currentState, startAttempt } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ examId: string }>
}

export async function GET(req: Request, props: Ctx): Promise<Response> {
  const params = await props.params;
  return currentState(req, params.examId)
}

export async function POST(req: Request, props: Ctx): Promise<Response> {
  const params = await props.params;
  return startAttempt(req, params.examId)
}
