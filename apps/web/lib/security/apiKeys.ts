/**
 * security/apiKeys.ts — the credential a SCRIPT presents.
 *
 * SERVER ONLY. Never import from a client component: it reads the
 * service-role key.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every capability on this platform used to be reachable only by hand. A
 * researcher could submit a circuit to real hardware by clicking, and could not
 * put that submission in a loop, in a CI job, or in a paper's reproduction
 * instructions. That is the difference between a tool somebody looks at and a
 * tool somebody uses. the internal competitive review §3.2.
 *
 * ── What a key is ───────────────────────────────────────────────────────────
 *
 *     qb16_sk_<43 url-safe base64 characters>
 *              └── 32 bytes from crypto.getRandomValues
 *
 * The prefix is not decoration. It is what makes a leaked key findable: a
 * secret scanner, a `git grep`, or a human reading a stack trace can recognise
 * `qb16_sk_` on sight, which an anonymous blob of base64 does not afford.
 * GitHub's `ghp_`, Stripe's `sk_live_` and Slack's `xoxb-` all exist for this.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 *
 * The SHA-256 hash, and the first 16 characters in the clear so a listing can
 * say `qb16_sk_7Fq2…` beside the key's name. Never the key. It is shown to its
 * owner exactly once, at creation; a lost key is replaced, not recovered.
 *
 * SHA-256 rather than bcrypt or argon2 is deliberate and is explained at
 * length in supabase/schema-integrations.sql: slow hashes exist to make
 * guessing *human-chosen* secrets expensive, and this key is 32 bytes of
 * CSPRNG output. There is no dictionary to run against 256 bits of entropy,
 * and a deliberately slow hash on the verification path would add real work to
 * every authenticated API request in exchange for defending against an attack
 * that cannot be mounted.
 *
 * ── What a key may NOT do ───────────────────────────────────────────────────
 *
 * Mint another key, or reach any route that manages the account itself. See
 * `app/api/keys/route.ts`. A key is a credential for the programmatic surface,
 * not a session.
 */

import { getServiceSupabase, isServiceRoleConfigured } from '@/lib/billing/entitlements'

/**
 * The visible marker on every key.
 *
 * `sk` for "secret key", matching the convention a reader will already know
 * from Stripe. If a publishable/restricted class is ever added it takes its
 * own infix rather than overloading this one.
 */
export const KEY_PREFIX = 'qb16_sk_'

/** How much of the key the listing shows. Enough to disambiguate, far too little to guess. */
const DISPLAY_PREFIX_CHARS = 16

/** 32 bytes. Anything less is a smaller number for no saving. */
const KEY_BYTES = 32

/**
 * Longest key string we will even hash.
 *
 * A real key is 51 characters. This bound exists so a caller cannot make the
 * server hash a megabyte by putting it in an Authorization header.
 */
const MAX_KEY_CHARS = 128

/**
 * What a key is allowed to do.
 *
 * Deliberately narrow. These name the PROGRAMMATIC surface and nothing else:
 * there is no `billing:*`, no `orgs:*` and no `keys:*`, because a credential
 * that sits in a CI environment variable must not be able to change the
 * subscription it spends against, alter who is in an organisation, or issue a
 * successor to itself that outlives its own revocation.
 */
export const API_SCOPES = ['hardware:read', 'hardware:submit'] as const

export type ApiScope = (typeof API_SCOPES)[number]

/** Human wording for each scope, for the key-creation UI. */
export const SCOPE_LABELS: Record<ApiScope, string> = {
  'hardware:read': 'Read devices, cost estimates, transpiled circuits and your own job history.',
  'hardware:submit': 'Submit jobs to real quantum hardware. This spends your monthly allowance.',
}

/** One key as the owner sees it in a listing. Never carries the key itself. */
export interface ApiKeyRecord {
  id: string
  name: string
  /** `qb16_sk_7Fq2…` — an identifier, not a secret. */
  keyPrefix: string
  scopes: ApiScope[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** The one and only time the key itself is returned. */
export interface MintedApiKey extends ApiKeyRecord {
  /** Shown once. Not stored, not recoverable, not logged. */
  key: string
}

/** A caller authenticated by a key rather than by a session. */
export interface ApiKeyCaller {
  userId: string
  keyId: string
  scopes: ApiScope[]
}

/** The key store is not configured, or could not answer. */
export class ApiKeyStoreError extends Error {
  constructor(readonly why: string) {
    super('API keys are unavailable right now.')
    this.name = 'ApiKeyStoreError'
  }
}

/** True when this deployment can issue and verify keys at all. */
export function apiKeysConfigured(): boolean {
  return isServiceRoleConfigured
}

/**
 * The service-role client, or a thrown `ApiKeyStoreError`.
 *
 * Throwing rather than returning null because every caller here has to refuse
 * on failure: an unverifiable key must not authenticate, and a key that cannot
 * be recorded must not be handed out.
 */
function keyStore() {
  if (!isServiceRoleConfigured) {
    throw new ApiKeyStoreError('SUPABASE_SERVICE_ROLE_KEY is not configured.')
  }
  const supabase = getServiceSupabase()
  if (!supabase) throw new ApiKeyStoreError('the Supabase service client could not be built.')
  return supabase
}

/**
 * SHA-256 of a key, as lowercase hex.
 *
 * Web Crypto rather than `node:crypto` so this module keeps working if a route
 * that uses it is ever moved to the edge runtime.
 *
 * @param key The full key string.
 * @returns 64 hex characters.
 */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a new key string.
 *
 * `crypto.getRandomValues`, never `Math.random` — the latter is seeded from
 * something an attacker can often reason about, and is not a CSPRNG in any
 * engine. base64url so the key survives a URL, a shell argument and a YAML
 * file without quoting or escaping.
 *
 * @returns The full key, prefix included.
 */
export function generateKey(): string {
  const bytes = new Uint8Array(KEY_BYTES)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${KEY_PREFIX}${body}`
}

/**
 * Keep only the scopes this build knows about.
 *
 * Applied on the way IN (at creation) and on the way OUT (at verification).
 * Both, not either: a scope removed from `API_SCOPES` in a later release must
 * stop granting anything on rows that already carry it, and filtering only at
 * creation would leave those rows granting a capability the code no longer
 * models.
 *
 * @param raw Whatever was supplied or stored.
 * @returns The recognised scopes, deduplicated, in declaration order.
 */
export function normaliseScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return []
  const wanted = new Set(raw.filter((s): s is string => typeof s === 'string'))
  return API_SCOPES.filter((scope) => wanted.has(scope))
}

/**
 * Issue a key for one account.
 *
 * @param userId The Supabase-verified owner. Never a body field.
 * @param name What the owner called it.
 * @param scopes What it may do.
 * @returns The record plus the key itself — the only time it is ever returned.
 * @throws ApiKeyStoreError When the store is absent or refuses the insert.
 */
export async function mintApiKey(
  userId: string,
  name: string,
  scopes: ApiScope[]
): Promise<MintedApiKey> {
  const supabase = keyStore()
  const key = generateKey()
  const keyHash = await hashKey(key)
  const keyPrefix = key.slice(0, DISPLAY_PREFIX_CHARS)

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      user_id: userId,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes,
    })
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
    .single()

  if (error || !data) {
    // The message, not the key. A key must never reach a log line.
    throw new ApiKeyStoreError(`the key could not be stored: ${error?.message ?? 'no row returned'}`)
  }

  return { ...toRecord(data), key }
}

/**
 * One account's keys, newest first. Revoked ones included.
 *
 * Revoked keys stay in the listing because their absence is the same signal as
 * "never existed", and an owner reviewing what they have issued needs to see
 * that a key was revoked rather than wonder whether they imagined it.
 *
 * @param userId The Supabase-verified owner.
 * @returns The records. Never the keys.
 * @throws ApiKeyStoreError When the store cannot answer.
 */
export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const supabase = keyStore()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw new ApiKeyStoreError(`the key listing was refused: ${error.message}`)
  return (Array.isArray(data) ? data : []).map(toRecord)
}

/**
 * Revoke one key.
 *
 * A timestamp, not a delete: a deleted row cannot answer "was this key active
 * when that job was submitted?", which is the question an incident asks.
 *
 * `user_id` is in the WHERE clause, so a caller cannot revoke a key they do
 * not own even if they learn its id.
 *
 * @param userId The Supabase-verified owner.
 * @param keyId The key to revoke.
 * @returns True when a row was revoked, false when there was nothing to revoke.
 * @throws ApiKeyStoreError When the store cannot answer.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const supabase = keyStore()
  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', keyId)
    .is('revoked_at', null)
    .select('id')

  if (error) throw new ApiKeyStoreError(`the revocation was refused: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/**
 * Resolve a presented key to its owner, or null.
 *
 * Returns null for every "no" — malformed, unknown, revoked — with no
 * distinction between them, because a caller who can tell "this key does not
 * exist" from "this key was revoked" has an oracle.
 *
 * THROWS `ApiKeyStoreError` when the store cannot answer, and the caller must
 * NOT read that as a valid key. It is the same fail-closed rule as
 * `lib/billing/usage.ts`: an unknown answer on a credential path is a refusal.
 *
 * @param presented The raw string from the Authorization header.
 * @returns The caller, or null when the key is not valid.
 * @throws ApiKeyStoreError When the store is absent or errors.
 */
export async function verifyApiKey(presented: string): Promise<ApiKeyCaller | null> {
  const key = presented.trim()
  // Cheap structural checks first, so junk never reaches the database. They
  // leak nothing: the prefix is public and the length is fixed by the format.
  if (!key.startsWith(KEY_PREFIX) || key.length > MAX_KEY_CHARS) return null
  if (key.length <= KEY_PREFIX.length) return null

  const supabase = keyStore()
  const keyHash = await hashKey(key)
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, user_id, scopes, revoked_at')
    .eq('key_hash', keyHash)
    .limit(1)

  if (error) throw new ApiKeyStoreError(`the key lookup was refused: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return null

  const record = row as Record<string, unknown>
  if (record.revoked_at) return null

  const userId = typeof record.user_id === 'string' ? record.user_id : ''
  const keyId = typeof record.id === 'string' ? record.id : ''
  if (!userId || !keyId) return null

  // Normalised on the way out as well as in — see `normaliseScopes`.
  return { userId, keyId, scopes: normaliseScopes(record.scopes) }
}

/**
 * Stamp `last_used_at`. Fire and forget.
 *
 * NEVER awaited on the request path and never allowed to throw. Its only
 * purpose is letting an owner answer "is this key still in use?" before
 * revoking it, so minute-level accuracy is ample and a failed write costs
 * nothing that matters. Making it block would put a database round trip in
 * front of every authenticated API request to maintain a field nobody reads in
 * real time.
 *
 * @param keyId The key that was just used.
 */
export function touchApiKey(keyId: string): void {
  if (!keyId) return
  void (async () => {
    try {
      const supabase = keyStore()
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyId)
    } catch {
      // Deliberately silent. The caller's request already succeeded or failed
      // on its own merits and this is bookkeeping.
    }
  })()
}

/**
 * Map a database row onto the wire shape.
 *
 * @param row An `api_keys` row as PostgREST returned it.
 * @returns The record.
 */
function toRecord(row: unknown): ApiKeyRecord {
  const r = (row ?? {}) as Record<string, unknown>
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  return {
    id: String(r.id ?? ''),
    name: text(r.name) ?? '',
    keyPrefix: text(r.key_prefix) ?? '',
    scopes: normaliseScopes(r.scopes),
    createdAt: text(r.created_at) ?? '',
    lastUsedAt: text(r.last_used_at),
    revokedAt: text(r.revoked_at),
  }
}
