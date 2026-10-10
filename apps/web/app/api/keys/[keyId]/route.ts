/**
 * DELETE /api/keys/{keyId} — revoke one API key.
 *
 * Identity comes from a Supabase SESSION token, not from a key. See the header
 * of `../route.ts`: a credential that could revoke keys could revoke the
 * account's other keys, and one that could mint them could outlive its own
 * revocation.
 *
 * Revocation is a timestamp, not a delete — `lib/security/apiKeys.ts` explains
 * why. The key stops working immediately; the row survives so an incident can
 * still answer "was this key active when that job was submitted?".
 */

import { NextResponse } from 'next/server'
import { rateLimit, callerKey, retryAfterHeaders } from '@/lib/rateLimit'
import { signInRequiredResponse, verifiedCallerId } from '@/lib/security/auth'
import { ApiKeyStoreError, apiKeysConfigured, revokeApiKey } from '@/lib/security/apiKeys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REVOKE_LIMIT = { limit: 20, windowMs: 60_000 }

/** Supabase ids are UUIDs. Checked before the store is touched. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  req: Request,
  props: { params: Promise<{ keyId: string }> }
): Promise<Response> {
  const caller = await verifiedCallerId(req)
  if (!caller) return signInRequiredResponse()

  const decision = await rateLimit(callerKey(req.headers, 'api-keys-del', caller), REVOKE_LIMIT)
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: retryAfterHeaders(decision) }
    )
  }

  const { keyId } = await props.params
  if (!UUID.test(keyId ?? '')) {
    return NextResponse.json({ error: 'Not a key id.' }, { status: 400 })
  }

  if (!apiKeysConfigured()) {
    return NextResponse.json(
      { error: 'API keys are unavailable on this deployment.' },
      { status: 503 }
    )
  }

  try {
    // `revokeApiKey` scopes by user_id, so a caller cannot revoke a key they
    // do not own even knowing its id.
    const revoked = await revokeApiKey(caller, keyId)
    if (!revoked) {
      // Somebody else's key, a key that never existed, and a key that was
      // already revoked all answer the same 404. A distinct response for
      // "exists but not yours" would make this route an oracle for real key
      // ids, and one for "already revoked" would confirm a key had existed.
      return NextResponse.json({ error: 'No such key.' }, { status: 404 })
    }
    return NextResponse.json({ revoked: true }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    if (err instanceof ApiKeyStoreError) {
      console.error(`[api/keys/${keyId}] ${err.why}`)
      return NextResponse.json({ error: 'API keys are unavailable right now.' }, { status: 503 })
    }
    throw err
  }
}
