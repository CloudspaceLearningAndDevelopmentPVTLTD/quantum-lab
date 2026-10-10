/**
 * GET /api/exams/summary — the caller's exam history, for /certify.
 *
 * Replaces the localStorage reads that used to fill in "your best" on the
 * certification index. Best score, whether they have passed, whether a paper is
 * running right now, and the certificate number if one was issued.
 *
 * A static segment sitting beside `[examId]`: Next matches the literal first,
 * and no exam is called "summary" (see lib/exams/catalogue.ts). Do not add one.
 */

import { examSummary } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  return examSummary(req)
}
