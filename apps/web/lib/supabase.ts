/**
 * supabase.ts — OPTIONAL backend wiring.
 *
 * Qubit16 works completely without a Supabase project. When
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are absent (the
 * default), `isSupabaseConfigured` is false, `getSupabase()` returns null, and
 * every feature that would otherwise persist to the cloud falls back to browser
 * localStorage (see lib/circuit-store.ts). Nothing in this module throws at
 * import time, so the app builds and runs with an empty environment.
 *
 * To turn on accounts and cross-device sync, follow supabase/README.md.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase-config'

// Re-exported so existing callers keep one import. Code that runs on every page
// should import it from '@/lib/supabase-config' instead — see that file.
export { isSupabaseConfigured }

let client: SupabaseClient | null = null

/**
 * Lazily create (and memoise) the Supabase client.
 * Returns null when Supabase is not configured — callers must handle null.
 * Never throws.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (client) return client
  try {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  } catch {
    // A malformed URL or key should degrade to local-only mode, not crash the app.
    client = null
  }
  return client
}

/** Shape of a row in public.circuits — mirrors supabase/schema.sql. */
export interface SavedCircuitRow {
  id: string
  user_id: string
  name: string
  description: string | null
  qasm: string
  num_qubits: number
  created_at: string
  updated_at: string
  is_public: boolean
}
