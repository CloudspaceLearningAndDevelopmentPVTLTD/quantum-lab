/**
 * POST /api/exams/[examId]/certificate — issue the credential.
 *
 * Refuses unless a Supabase-verified user owns a submitted, passed attempt at
 * this exam. A guest sitting cannot produce one: a certificate names a person,
 * and an anonymous cookie is not a person.
 *
 * Issued once and immutable. Re-posting returns the same certificate rather
 * than minting a second, so the number on a downloaded PDF keeps resolving.
 */

import { claimCertificate } from '@/lib/exams/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, props: { params: Promise<{ examId: string }> }): Promise<Response> {
 const params = await props.params;
 return claimCertificate(req, params.examId)
}
