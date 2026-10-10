/**
 * access.test.ts — the org authorisation gate, exercised through the real route
 * handlers (audit finding ORG-1, both halves).
 *
 * What is deliberately NOT mocked: lib/orgs/access.ts, lib/security/auth.ts and
 * the route handlers themselves — those are the code under test. Supabase (auth
 * + the org_members read) and lib/orgs/store.ts are stubbed so the test states
 * exactly who exists, who is a member of what, and with which role.
 *
 * The assertions that matter:
 *   · no token                     → 401
 *   · valid token, not a member    → 403 (and no data in the body)
 *   · valid token, wrong role      → 403
 *   · suspended seat               → 403 even with an owner/admin role
 *   · admin cannot mint an owner   → 403 (privilege escalation)
 *   · a userId in the body/query never selects the identity
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ────────────────────────────────────────────────────────────
// Fixture state, rewritten per test
// ────────────────────────────────────────────────────────────

interface MemberRow {
  org_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'invited' | 'suspended'
}

const state: {
  /** token → user id, i.e. what Supabase would validate. */
  tokens: Map<string, string>
  rows: MemberRow[]
} = { tokens: new Map(), rows: [] }

const OWNER = '00000000-0000-0000-0000-0000000000a1'
const ADMIN = '00000000-0000-0000-0000-0000000000a2'
const MEMBER = '00000000-0000-0000-0000-0000000000a3'
const OUTSIDER = '00000000-0000-0000-0000-0000000000a4'
const ORG = 'org-acme'

// ── Supabase auth (lib/security/auth.ts reads this) ──────────

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        const id = state.tokens.get(token)
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
  }),
}))

// ── The server-side org_members read (lib/orgs/access.ts) ────

function serviceClientStub() {
  return {
    from(_table: string) {
      const filters: Record<string, string> = {}
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value
          return builder
        },
        maybeSingle: async () => {
          const row = state.rows.find(
            (r) => r.org_id === filters.org_id && r.user_id === filters.user_id
          )
          return { data: row ?? null, error: null }
        },
      }
      return builder
    },
  }
}

vi.mock('@/lib/billing/entitlements', () => ({
  getServiceSupabase: () => serviceClientStub(),
}))

// ── The store: data, not authorisation ───────────────────────

const storeMembers = [
  { id: 'm-owner', orgId: ORG, userId: OWNER, email: 'o@acme.test', role: 'owner', status: 'active', joinedAt: '2020-01-01T00:00:00.000Z' },
  { id: 'm-admin', orgId: ORG, userId: ADMIN, email: 'a@acme.test', role: 'admin', status: 'active', joinedAt: '2020-01-02T00:00:00.000Z' },
  { id: 'm-member', orgId: ORG, userId: MEMBER, email: 'm@acme.test', role: 'member', status: 'active', joinedAt: '2020-01-03T00:00:00.000Z' },
]

vi.mock('@/lib/orgs/store', () => ({
  listMembers: async () => storeMembers,
  seatUsage: async () => ({ used: 3, total: 25, available: 22 }),
  addMember: async (orgId: string, email: string, role: string, status: string) => ({
    id: 'm-new',
    orgId,
    userId: '',
    email,
    role,
    status,
    joinedAt: '2024-01-01T00:00:00.000Z',
  }),
  removeMember: async () => true,
  setMemberRole: async () => storeMembers[2],
  setMemberStatus: async () => storeMembers[2],
  isSeatLimitError: () => false,
  listOrgs: async (userId: string | null) => (userId === OWNER ? [{ id: ORG }] : []),
  createOrg: async () => ({ id: ORG }),
  planCanOwnSeats: (planId: string) => planId === 'team' || planId === 'edu',
}))

// Imported after the mocks are registered.
const members = await import('@/app/api/orgs/members/route')
const orgs = await import('@/app/api/orgs/route')

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

function withToken(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function get(url: string, token?: string): Request {
  return new Request(url, { headers: withToken(token) })
}

function json(method: string, url: string, body: unknown, token?: string): Request {
  return new Request(url, { method, headers: withToken(token), body: JSON.stringify(body) })
}

const BASE = 'https://example.test'

beforeEach(() => {
  state.tokens = new Map([
    ['tok-owner', OWNER],
    ['tok-admin', ADMIN],
    ['tok-member', MEMBER],
    ['tok-outsider', OUTSIDER],
  ])
  state.rows = [
    { org_id: ORG, user_id: OWNER, role: 'owner', status: 'active' },
    { org_id: ORG, user_id: ADMIN, role: 'admin', status: 'active' },
    { org_id: ORG, user_id: MEMBER, role: 'member', status: 'active' },
    // OUTSIDER is a member of a DIFFERENT org — a seat somewhere is not a seat here.
    { org_id: 'org-other', user_id: OUTSIDER, role: 'owner', status: 'active' },
  ]
})

// ────────────────────────────────────────────────────────────
// GET /api/orgs/members — the email harvest
// ────────────────────────────────────────────────────────────

describe('GET /api/orgs/members', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await members.GET(get(`${BASE}/api/orgs/members?orgId=${ORG}`))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/Sign-in required/)
  })

  it('rejects a forged token with 401', async () => {
    const res = await members.GET(get(`${BASE}/api/orgs/members?orgId=${ORG}`, 'tok-nonsense'))
    expect(res.status).toBe(401)
  })

  it('rejects an authenticated non-member with 403 and no data', async () => {
    const res = await members.GET(get(`${BASE}/api/orgs/members?orgId=${ORG}`, 'tok-outsider'))
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.members).toBeUndefined()
    expect(String(body.error)).not.toContain('@acme.test')
  })

  it('lets an ordinary member read the list', async () => {
    const res = await members.GET(get(`${BASE}/api/orgs/members?orgId=${ORG}`, 'tok-member'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { members: unknown[] }
    expect(body.members).toHaveLength(3)
  })

  it('rejects a suspended seat with 403', async () => {
    state.rows = [{ org_id: ORG, user_id: ADMIN, role: 'admin', status: 'suspended' }]
    const res = await members.GET(get(`${BASE}/api/orgs/members?orgId=${ORG}`, 'tok-admin'))
    expect(res.status).toBe(403)
  })
})

// ────────────────────────────────────────────────────────────
// POST /api/orgs/members — "add myself as owner"
// ────────────────────────────────────────────────────────────

describe('POST /api/orgs/members', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await members.POST(
      json('POST', `${BASE}/api/orgs/members`, { orgId: ORG, email: 'x@acme.test', role: 'owner' })
    )
    expect(res.status).toBe(401)
  })

  it('rejects an authenticated non-member with 403 — the ORG-1 attack', async () => {
    const res = await members.POST(
      json(
        'POST',
        `${BASE}/api/orgs/members`,
        { orgId: ORG, email: 'attacker@evil.test', role: 'owner', status: 'active' },
        'tok-outsider'
      )
    )
    expect(res.status).toBe(403)
  })

  it('rejects an ordinary member trying to manage seats with 403', async () => {
    const res = await members.POST(
      json('POST', `${BASE}/api/orgs/members`, { orgId: ORG, email: 'x@acme.test' }, 'tok-member')
    )
    expect(res.status).toBe(403)
  })

  it('refuses to let an admin mint an owner', async () => {
    const res = await members.POST(
      json(
        'POST',
        `${BASE}/api/orgs/members`,
        { orgId: ORG, email: 'x@acme.test', role: 'owner' },
        'tok-admin'
      )
    )
    expect(res.status).toBe(403)
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/owner/i)
  })

  it('lets an admin add an ordinary member', async () => {
    const res = await members.POST(
      json(
        'POST',
        `${BASE}/api/orgs/members`,
        { orgId: ORG, email: 'x@acme.test', role: 'member' },
        'tok-admin'
      )
    )
    expect(res.status).toBe(201)
  })
})

// ────────────────────────────────────────────────────────────
// PATCH / DELETE — privilege changes
// ────────────────────────────────────────────────────────────

describe('PATCH and DELETE /api/orgs/members', () => {
  it('will not let an admin demote an owner', async () => {
    const res = await members.PATCH(
      json(
        'PATCH',
        `${BASE}/api/orgs/members`,
        { orgId: ORG, memberId: 'm-owner', role: 'member' },
        'tok-admin'
      )
    )
    expect(res.status).toBe(403)
  })

  it('rejects a non-member DELETE with 403', async () => {
    const res = await members.DELETE(
      get(`${BASE}/api/orgs/members?orgId=${ORG}&memberId=m-member`, 'tok-outsider')
    )
    expect(res.status).toBe(403)
  })

  it('rejects an unauthenticated DELETE with 401', async () => {
    const res = await members.DELETE(
      get(`${BASE}/api/orgs/members?orgId=${ORG}&memberId=m-member`)
    )
    expect(res.status).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────
// GET /api/orgs — a userId in the query is not an identity
// ────────────────────────────────────────────────────────────

describe('GET /api/orgs', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await orgs.GET(get(`${BASE}/api/orgs?userId=${OWNER}`))
    expect(res.status).toBe(401)
  })

  it('refuses to list another user by id', async () => {
    const res = await orgs.GET(get(`${BASE}/api/orgs?userId=${OWNER}`, 'tok-outsider'))
    expect(res.status).toBe(403)
  })

  it('lists the caller their own organisations', async () => {
    const res = await orgs.GET(get(`${BASE}/api/orgs?userId=${OWNER}`, 'tok-owner'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgs: unknown[] }
    expect(body.orgs).toHaveLength(1)
  })
})
