/**
 * Tests for the API-key credential.
 *
 * This is an authentication path, so the tests are about refusals as much as
 * about acceptances. Each one names the failure it would catch, because a
 * green suite on an auth module is worth exactly as much as the specific
 * mistakes it rules out.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Supabase double ─────────────────────────────────────────────────────────
//
// A tiny query recorder. Each `from()` returns a chain that collects the
// filters applied to it and resolves to whatever `nextResult` holds, so a test
// can assert on the WHERE clause as well as on the return value.

interface Recorded {
  table: string
  op: string
  filters: [string, unknown][]
  payload?: Record<string, unknown>
}

let recorded: Recorded[] = []
let nextResult: { data: unknown; error: { message: string } | null } = { data: null, error: null }

function chain(entry: Recorded) {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.eq = (col: string, val: unknown) => {
    entry.filters.push([col, val])
    return api
  }
  api.is = (col: string, val: unknown) => {
    entry.filters.push([col, val])
    return api
  }
  api.order = self
  api.limit = self
  api.select = self
  api.single = () => Promise.resolve(nextResult)
  api.then = (resolve: (v: typeof nextResult) => unknown) => resolve(nextResult)
  return api
}

vi.mock('@/lib/billing/entitlements', () => ({
  isServiceRoleConfigured: true,
  getServiceSupabase: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        const entry: Recorded = { table, op: 'insert', filters: [], payload }
        recorded.push(entry)
        return chain(entry)
      },
      update: (payload: Record<string, unknown>) => {
        const entry: Recorded = { table, op: 'update', filters: [], payload }
        recorded.push(entry)
        return chain(entry)
      },
      select: (columns: string) => {
        const entry: Recorded = { table, op: 'select', filters: [], payload: { columns } }
        recorded.push(entry)
        return chain(entry)
      },
    }),
  }),
}))

import {
  API_SCOPES,
  ApiKeyStoreError,
  KEY_PREFIX,
  generateKey,
  hashKey,
  mintApiKey,
  normaliseScopes,
  revokeApiKey,
  verifyApiKey,
} from '@/lib/security/apiKeys'

beforeEach(() => {
  recorded = []
  nextResult = { data: null, error: null }
})

describe('generateKey', () => {
  it('carries the scannable prefix', () => {
    // The prefix is what lets a secret scanner, a `git grep` or a human
    // reading a stack trace recognise a leaked key. An anonymous blob of
    // base64 affords none of that.
    expect(generateKey().startsWith(KEY_PREFIX)).toBe(true)
  })

  it('is url-safe, so it survives a shell argument and a YAML file unquoted', () => {
    const body = generateKey().slice(KEY_PREFIX.length)
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('carries 32 bytes of entropy', () => {
    // 32 bytes base64url with the padding stripped is 43 characters. If this
    // ever shrinks, the argument for a fast hash in the schema comment stops
    // holding.
    expect(generateKey().slice(KEY_PREFIX.length)).toHaveLength(43)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateKey()))
    expect(seen.size).toBe(200)
  })
})

describe('hashKey', () => {
  it('is stable and 64 hex characters', async () => {
    const a = await hashKey('qb16_sk_example')
    const b = await hashKey('qb16_sk_example')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for keys differing in one character', async () => {
    expect(await hashKey('qb16_sk_aaa')).not.toBe(await hashKey('qb16_sk_aab'))
  })
})

describe('normaliseScopes', () => {
  it('drops anything this build does not model', () => {
    // The dangerous direction is granting an unrecognised scope. This function
    // structurally cannot: it filters API_SCOPES, it does not filter the input.
    expect(normaliseScopes(['hardware:read', 'billing:write', 'root'])).toEqual(['hardware:read'])
  })

  it('never invents a scope from a non-array', () => {
    for (const junk of [null, undefined, 'hardware:read', 42, {}]) {
      expect(normaliseScopes(junk)).toEqual([])
    }
  })

  it('deduplicates and returns declaration order', () => {
    expect(normaliseScopes(['hardware:submit', 'hardware:read', 'hardware:submit'])).toEqual([
      'hardware:read',
      'hardware:submit',
    ])
  })
})

describe('mintApiKey', () => {
  it('stores the hash and the prefix, never the key', async () => {
    nextResult = {
      data: {
        id: 'k1',
        name: 'ci',
        key_prefix: 'qb16_sk_xxxx',
        scopes: ['hardware:read'],
        created_at: 'now',
        last_used_at: null,
        revoked_at: null,
      },
      error: null,
    }

    const minted = await mintApiKey('user-1', 'ci', ['hardware:read'])

    const insert = recorded.find((r) => r.op === 'insert')
    expect(insert?.payload).toBeDefined()
    // The single most important assertion in this file.
    expect(Object.keys(insert!.payload!)).not.toContain('key')
    expect(insert!.payload!.key_hash).toBe(await hashKey(minted.key))
    expect(String(insert!.payload!.key_prefix)).toHaveLength(16)
    expect(JSON.stringify(insert!.payload)).not.toContain(minted.key)
  })

  it('returns the key exactly once, to the caller', async () => {
    nextResult = {
      data: { id: 'k1', name: 'ci', key_prefix: 'p', scopes: [], created_at: 'now' },
      error: null,
    }
    const minted = await mintApiKey('user-1', 'ci', ['hardware:read'])
    expect(minted.key.startsWith(KEY_PREFIX)).toBe(true)
  })

  it('refuses rather than handing out a key it could not store', async () => {
    // A key the owner has but the database has not is worse than no key: it
    // authenticates nowhere and looks like a platform bug forever.
    nextResult = { data: null, error: { message: 'unique violation' } }
    await expect(mintApiKey('user-1', 'ci', ['hardware:read'])).rejects.toBeInstanceOf(
      ApiKeyStoreError
    )
  })

  it('does not put the key in the error it throws', async () => {
    nextResult = { data: null, error: { message: 'boom' } }
    try {
      await mintApiKey('user-1', 'ci', ['hardware:read'])
      expect.unreachable('should have thrown')
    } catch (err) {
      // A thrown error becomes a log line. A key in a log line is a leaked key.
      expect(String((err as ApiKeyStoreError).why)).not.toContain(KEY_PREFIX)
    }
  })
})

describe('verifyApiKey', () => {
  it('refuses anything without the prefix, without touching the store', async () => {
    // A Supabase JWT arrives on this same header. It must never reach the
    // database as a candidate key.
    expect(await verifyApiKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb')).toBeNull()
    expect(recorded).toHaveLength(0)
  })

  it('refuses an absurdly long value without hashing it', async () => {
    expect(await verifyApiKey(KEY_PREFIX + 'a'.repeat(10_000))).toBeNull()
    expect(recorded).toHaveLength(0)
  })

  it('refuses the bare prefix', async () => {
    expect(await verifyApiKey(KEY_PREFIX)).toBeNull()
    expect(recorded).toHaveLength(0)
  })

  it('looks the key up by hash, never by prefix', async () => {
    // A prefix lookup would return a candidate row for anyone who knew the
    // first 16 characters, and would then need a comparison this code does not
    // have. One indexed lookup on the full hash has no such step to get wrong.
    nextResult = { data: [], error: null }
    const key = generateKey()
    await verifyApiKey(key)

    const select = recorded.find((r) => r.op === 'select')
    expect(select?.filters).toEqual([['key_hash', await hashKey(key)]])
  })

  it('refuses a revoked key', async () => {
    nextResult = {
      data: [{ id: 'k1', user_id: 'u1', scopes: ['hardware:submit'], revoked_at: '2026-01-01' }],
      error: null,
    }
    expect(await verifyApiKey(generateKey())).toBeNull()
  })

  it('accepts a live key and normalises its stored scopes', async () => {
    // Normalising on the way OUT as well as in: a scope removed from
    // API_SCOPES in a later release must stop granting anything on rows that
    // already carry it.
    nextResult = {
      data: [
        { id: 'k1', user_id: 'u1', scopes: ['hardware:submit', 'legacy:everything'], revoked_at: null },
      ],
      error: null,
    }
    const caller = await verifyApiKey(generateKey())
    expect(caller).toEqual({ userId: 'u1', keyId: 'k1', scopes: ['hardware:submit'] })
  })

  it('throws rather than returning null when the store errors', async () => {
    // FAIL CLOSED. Returning null here would read to the route as "anonymous
    // caller", which during a database blip silently downgrades an
    // authenticated script to a 401 it should not retry through.
    nextResult = { data: null, error: { message: 'connection reset' } }
    await expect(verifyApiKey(generateKey())).rejects.toBeInstanceOf(ApiKeyStoreError)
  })
})

describe('revokeApiKey', () => {
  it('scopes the update by user as well as by key id', async () => {
    // Otherwise learning a key id is enough to revoke somebody else's key.
    nextResult = { data: [{ id: 'k1' }], error: null }
    await revokeApiKey('user-1', 'key-1')

    const update = recorded.find((r) => r.op === 'update')
    expect(update?.filters).toEqual([
      ['user_id', 'user-1'],
      ['id', 'key-1'],
      ['revoked_at', null],
    ])
  })

  it('sets a timestamp rather than deleting the row', async () => {
    // A deleted row cannot answer "was this key active when that job was
    // submitted?", which is the question an incident asks.
    nextResult = { data: [{ id: 'k1' }], error: null }
    await revokeApiKey('user-1', 'key-1')

    const update = recorded.find((r) => r.op === 'update')
    expect(typeof update?.payload?.revoked_at).toBe('string')
  })

  it('reports false when there was nothing to revoke', async () => {
    nextResult = { data: [], error: null }
    expect(await revokeApiKey('user-1', 'key-1')).toBe(false)
  })
})

describe('the scope catalogue', () => {
  it('grants nothing outside the hardware surface', () => {
    // A credential that lives in a CI environment variable must not be able to
    // change the subscription it spends against, alter an organisation's
    // membership, or mint a successor to itself. If a scope is ever added
    // here, that decision is what this test is asking you to make on purpose.
    for (const scope of API_SCOPES) {
      expect(scope.startsWith('hardware:')).toBe(true)
    }
  })
})
