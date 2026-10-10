/**
 * supabase-config.ts — whether a Supabase project is configured, WITHOUT the client.
 *
 * Split out of lib/supabase.ts so that code on every page (the header's
 * AccountButton, via useSession) can ask "are accounts on?" without statically
 * importing `@supabase/supabase-js`. That import is ~26 kB gzip of auth,
 * PostgREST and realtime clients; when the nav pulled it in through
 * lib/supabase.ts it landed in the first load of every route.
 *
 * Nothing here may import `@supabase/supabase-js` — that is the whole point.
 */

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

/** True only when BOTH environment variables are present and non-empty. */
export const isSupabaseConfigured: boolean =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
