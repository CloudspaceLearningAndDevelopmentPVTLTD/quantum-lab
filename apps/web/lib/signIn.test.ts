/**
 * signIn.test.ts — the two pieces of the sign-in flow that are logic rather
 * than markup: the `?next=` guard (an open redirect riding on our own sign-in
 * email if it is wrong) and the one-time move of browser-saved circuits into
 * the account (which must never lose or duplicate a circuit).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── a tiny fake of the Supabase surface circuit-store uses ─────────────────
const db: {
  rows: { user_id: string; name: string; qasm: string }[]
  failInsertAfter: number
  sessionUser: string | null
} = { rows: [], failInsertAfter: Infinity, sessionUser: 'user-1' }

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: { session: db.sessionUser ? { user: { id: db.sessionUser } } : null },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: async (_col: string, userId: string) => ({
          data: db.rows.filter((r) => r.user_id === userId),
          error: null,
        }),
      }),
    }),
  }),
}))

// Inserts go through POST /api/circuits (where the plan limit is enforced).
vi.mock('@/lib/authFetch', () => ({
  authFetch: async (_url: string, init: RequestInit) => {
    const f = JSON.parse(String(init.body)) as { name: string; qasm: string }
    if (db.rows.length >= db.failInsertAfter) {
      return new Response(JSON.stringify({ error: 'limit', code: 'limit_reached' }), { status: 403 })
    }
    const row = { user_id: db.sessionUser ?? '', name: f.name, qasm: f.qasm }
    db.rows.push(row)
    return new Response(JSON.stringify({ circuit: { id: String(db.rows.length), ...row } }), {
      status: 201,
    })
  },
}))

const store = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
})

const { safeNextPath } = await import('@/components/auth/useSession')
const { signInHref } = await import('@/components/auth/AccountButton')
const { migrateLocalCircuits } = await import('@/lib/circuit-store')

function local(id: string, name: string, qasm = 'OPENQASM 2.0;', createdAt = '2026-01-01') {
  return { id, name, qasm, numQubits: 1, createdAt, updatedAt: createdAt }
}
function readLocal(): { id: string }[] {
  return JSON.parse(store.get('quantum-lab.circuits') ?? '[]')
}

describe('safeNextPath', () => {
  it('accepts same-origin paths, with a query', () => {
    expect(safeNextPath('/simulator')).toBe('/simulator')
    expect(safeNextPath('/admin?invite=abc')).toBe('/admin?invite=abc')
  })

  it.each([
    ['protocol-relative', '//evil.example/x'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['javascript', 'javascript:alert(1)'],
    ['relative', 'simulator'],
    ['control character', '/a\nb'],
    ['a loop back to the account page', '/account?next=/x'],
    ['empty', ''],
    ['missing', null],
  ])('refuses %s', (_label, value) => {
    expect(safeNextPath(value)).toBeNull()
  })
})

describe('signInHref', () => {
  it('returns to the current page', () => {
    expect(signInHref('/hardware')).toBe('/account?next=%2Fhardware')
  })
  it('does not add a pointless next for home or the account page', () => {
    expect(signInHref('/')).toBe('/account')
    expect(signInHref('/account')).toBe('/account')
  })
})

describe('migrateLocalCircuits', () => {
  beforeEach(() => {
    store.clear()
    db.rows = []
    db.failInsertAfter = Infinity
    db.sessionUser = 'user-1'
  })

  it('moves every local circuit into the account and clears them locally', async () => {
    store.set('quantum-lab.circuits', JSON.stringify([local('a', 'Bell'), local('b', 'GHZ')]))
    expect(await migrateLocalCircuits('user-1')).toBe(2)
    expect(db.rows.map((r) => r.name).sort()).toEqual(['Bell', 'GHZ'])
    expect(readLocal()).toEqual([])
  })

  it('does not duplicate a circuit the account already has', async () => {
    db.rows = [{ user_id: 'user-1', name: 'Bell', qasm: 'OPENQASM 2.0;' }]
    store.set('quantum-lab.circuits', JSON.stringify([local('a', 'Bell')]))
    await migrateLocalCircuits('user-1')
    expect(db.rows).toHaveLength(1)
    expect(readLocal()).toEqual([])
  })

  it('keeps what could not be uploaded (e.g. over the plan limit) in the browser', async () => {
    db.failInsertAfter = 1
    store.set(
      'quantum-lab.circuits',
      JSON.stringify([local('a', 'first', 'q1', '2026-01-01'), local('b', 'second', 'q2', '2026-01-02')])
    )
    expect(await migrateLocalCircuits('user-1')).toBe(1)
    expect(readLocal().map((c) => c.id)).toEqual(['b'])
  })

  it('does nothing when the session belongs to someone else', async () => {
    db.sessionUser = 'user-2'
    store.set('quantum-lab.circuits', JSON.stringify([local('a', 'Bell')]))
    expect(await migrateLocalCircuits('user-1')).toBe(0)
    expect(readLocal()).toHaveLength(1)
  })
})
