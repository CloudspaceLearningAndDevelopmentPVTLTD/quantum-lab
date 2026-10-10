/**
 * platform/secretBox.ts — AES-256-GCM for secrets stored in platform_settings.
 *
 * SERVER ONLY. Provider API keys an admin types into /admin/platform are
 * encrypted here before they reach Supabase, so a database dump (or an
 * over-broad Supabase dashboard login) yields ciphertext, and the key that
 * opens it lives only in the web app's environment.
 *
 * Key material, in order of preference:
 *   1. SETTINGS_ENCRYPTION_KEY — 64 hex chars (32 bytes) or any string, which
 *      is hashed to 32 bytes. Set this: rotating it re-encrypts nothing, so
 *      stored keys become unreadable until re-entered (the console says so).
 *   2. Derived from SUPABASE_SERVICE_ROLE_KEY. Same secrecy class (a leaked
 *      service-role key already opens the table), so no new secret is required
 *      to get started — deploy.sh wires the first one automatically anyway.
 *
 * Wire format: `v1.<iv>.<ciphertext>.<tag>`, each base64url.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'v1'

function keyBytes(): Buffer | null {
  const explicit = (process.env.SETTINGS_ENCRYPTION_KEY ?? '').trim()
  if (explicit) {
    if (/^[0-9a-f]{64}$/i.test(explicit)) return Buffer.from(explicit, 'hex')
    return createHash('sha256').update(explicit, 'utf8').digest()
  }
  const derived = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (derived) return createHash('sha256').update(`qubit16-settings:${derived}`, 'utf8').digest()
  return null
}

/** True when secrets can be stored. False → the console refuses to save keys. */
export function secretBoxAvailable(): boolean {
  return keyBytes() !== null
}

export function seal(plaintext: string): string {
  const key = keyBytes()
  if (!key) throw new Error('No SETTINGS_ENCRYPTION_KEY (or SUPABASE_SERVICE_ROLE_KEY) to encrypt with.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, b64(iv), b64(ct), b64(tag)].join('.')
}

/** Returns null when the box cannot be opened (wrong key, tampered, malformed). */
export function open(sealed: string): string | null {
  const key = keyBytes()
  if (!key) return null
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, unb64(parts[1]))
    decipher.setAuthTag(unb64(parts[3]))
    const pt = Buffer.concat([decipher.update(unb64(parts[2])), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null
  }
}

export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}.`) && value.split('.').length === 4
}

const b64 = (b: Buffer) => b.toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url')
