/**
 * authFetch.test.ts — the client half of the auth fix (docs/SECURITY.md
 * checklist item 2). The routes reject a request with no credential; these
 * tests pin the one place the credential is attached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session: { token: string | null; throws: boolean } = { token: null, throws: false }

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () => {
        if (session.throws) throw new Error('network')
        return session.token
          ? { data: { session: { access_token: session.token } }, error: null }
          : { data: { session: null }, error: null }
      },
    },
  }),
}))

const { authFetch, authHeaders } = await import('@/lib/authFetch')

let seen: { url: string; headers: Headers } | null = null

beforeEach(() => {
  seen = null
  session.token = 'jwt-abc'
  session.throws = false
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), headers: new Headers(init?.headers) }
    return new Response('{}', { status: 200 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authFetch', () => {
  it('attaches the session access token as a bearer header', async () => {
    await authFetch('/api/billing/entitlement?userId=x')
    expect(seen?.headers.get('authorization')).toBe('Bearer jwt-abc')
  })

  it('keeps the caller’s own headers', async () => {
    await authFetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(seen?.headers.get('content-type')).toBe('application/json')
    expect(seen?.headers.get('authorization')).toBe('Bearer jwt-abc')
  })

  it('sends no credential when nobody is signed in', async () => {
    session.token = null
    await authFetch('/api/orgs/invite', { method: 'POST' })
    expect(seen?.headers.get('authorization')).toBeNull()
  })

  it('never throws when the auth service is unreachable', async () => {
    session.throws = true
    const res = await authFetch('/api/billing/portal', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(seen?.headers.get('authorization')).toBeNull()
  })

  it('does not overwrite an authorization header set deliberately', async () => {
    await authFetch('/api/orgs', { headers: { authorization: 'Bearer explicit' } })
    expect(seen?.headers.get('authorization')).toBe('Bearer explicit')
  })

  it('authHeaders() is empty when signed out and populated when signed in', async () => {
    expect(await authHeaders()).toEqual({ authorization: 'Bearer jwt-abc' })
    session.token = null
    expect(await authHeaders()).toEqual({})
  })
})
