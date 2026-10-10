/**
 * POST /api/exams/[examId]/submit — grade the paper.
 *
 * THE SCORE IS COMPUTED HERE AND NOWHERE ELSE. The body carries an attempt id
 * and a final flush of answers; anything else in it — a `score`, a `passed`, a
 * `userId` — is ignored, because the handler never reads it. The marks come
 * from `gradeExam` against the bank, which lives on this side of the wire.
 *
 * A late submission is REFUSED with 409, and the paper is closed against the
 * answers that were on file at the deadline. The response still carries the
 * result, because leaving a candidate at an error page with no marks would be
 * punishing them for a network hiccup.
 */

import { submitAttempt } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, props: { params: Promise<{ examId: string }> }): Promise<Response> {
 const params = await props.params;
 return submitAttempt(req, params.examId)
}
