/**
 * PUT /api/exams/[examId]/answers — persist answers mid-sitting.
 *
 * This is what replaces the localStorage write on every click. Answers are
 * merged into the server record, so an attempt resumes on another machine with
 * everything the candidate had typed — the thing localStorage could never do.
 *
 * PUT rather than POST because it is idempotent: the same body applied twice
 * leaves the same state, which matters when a flaky connection retries.
 *
 * A write that arrives after the deadline is refused (409) and closes the
 * paper. The server clock decides that, not the browser's.
 */

import { saveAnswers } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: Request, props: { params: Promise<{ examId: string }> }): Promise<Response> {
 const params = await props.params;
 return saveAnswers(req, params.examId)
}
