/**
 * authFetch.ts — the client half of the token-based auth the API routes require.
 *
 * BROWSER ONLY (it reads the browser Supabase client's stored session).
 *
 * The server routes were hardened first: `/api/billing/portal`,
 * `/api/billing/entitlement`, `/api/orgs*` and friends now derive the caller
 * from a Supabase access token and refuse to take a `userId` from a body or a
 * query string as identity (audit findings BILL-1, BILL-2, ORG-1). The browser
 * was still calling them with no credential, which meant a signed-in Pro user
 * saw the free-tier badge and "Manage billing" answered 401 — checklist item 2
 * in docs/SECURITY.md.
 *
 * Every client call to an authenticated route goes through here so the header
 * is attached in exactly one place, in exactly the shape
 * `lib/security/auth.ts` parses:
 *
 *     Authorization: Bearer <session.access_token>
 *
 * When Supabase is not configured, or nobody is signed in, the header is simply
 * omitted and the request goes out anonymously — that is the supported
 * zero-config path, and the routes answer it exactly as they did before.
 */

import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * The current session's access token, or null.
 *
 * `getSession()` reads the persisted session and refreshes it when it is close
 * to expiry, so the token handed out here is the one the server will accept.
 * Never throws.
 */
export async function accessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return null
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * `{ authorization: 'Bearer …' }` when signed in, `{}` otherwise.
 * Useful when a caller is building a header object by hand.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * `fetch` with the caller's access token attached.
 *
 * Header handling: any `init.headers` the caller passed are preserved, and an
 * `authorization` header they set explicitly wins — this helper never silently
 * replaces a credential someone chose deliberately.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('authorization')) {
    const token = await accessToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

export default authFetch
