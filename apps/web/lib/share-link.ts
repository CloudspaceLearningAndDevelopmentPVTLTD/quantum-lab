/**
 * share-link.ts — backend-free permalinks.
 *
 * A circuit is serialised to OpenQASM and then base64url-encoded into the URL,
 * so a shared link needs no database, no account and no network round-trip.
 * Every browser API is SSR-guarded and nothing here throws.
 */

import { fromQasm, toQasm, type Circuit } from '@/lib/quantum'

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff
  return bytes
}

function toBase64(binary: string): string | null {
  if (typeof btoa === 'function') return btoa(binary)
  // Node/SSR fallback so encoding also works during prerender.
  const B = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer
  if (B) return B.from(binary, 'binary').toString('base64')
  return null
}

function fromBase64(b64: string): string | null {
  if (typeof atob === 'function') return atob(b64)
  const B = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer
  if (B) return B.from(b64, 'base64').toString('binary')
  return null
}

/** Encode a circuit as a compact, URL-safe token. Returns '' on failure. */
export function encodeCircuit(circuit: Circuit): string {
  try {
    const qasm = toQasm(circuit)
    const bytes = new TextEncoder().encode(qasm)
    const b64 = toBase64(bytesToBinaryString(bytes))
    if (b64 === null) return ''
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return ''
  }
}

/** Decode a token produced by encodeCircuit. Returns null on any failure. */
export function decodeCircuit(token: string): Circuit | null {
  if (!token) return null
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = fromBase64(padded)
    if (binary === null) return null
    const qasm = new TextDecoder().decode(binaryStringToBytes(binary))
    const circuit = fromQasm(qasm)
    if (!circuit || circuit.ops.length === 0) return null
    return circuit
  } catch {
    return null
  }
}

/** Build a full /simulator permalink. Falls back to a relative URL during SSR. */
export function buildShareUrl(circuit: Circuit, origin?: string): string {
  const base =
    origin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}/simulator?c=${encodeCircuit(circuit)}`
}
