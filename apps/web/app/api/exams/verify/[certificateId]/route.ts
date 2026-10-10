/**
 * GET /api/exams/verify/[certificateId] — public certificate verification.
 *
 * DELIBERATELY UNAUTHENTICATED. The point of a credential is that a stranger
 * can check it, so this route takes no token and asks for none.
 *
 * It answers exactly one question — did this person pass this exam on this date
 * — and returns nothing else: no score, no account id, no email, no attempt
 * history, and no signal about how many times the holder sat the paper. An
 * unknown number gets a 200 saying no certificate was issued with it, not a
 * 404, because "we checked and there is none" is the successful answer to the
 * question that was asked.
 */

import { verifyCertificate } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, props: { params: Promise<{ certificateId: string }> }): Promise<Response> {
  const params = await props.params;
  return verifyCertificate(req, params.certificateId)
}
