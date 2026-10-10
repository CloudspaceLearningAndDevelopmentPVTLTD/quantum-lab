# Weekly gate-golf competition

`/compete` runs one public gate-golf puzzle per ISO week, with a shared
leaderboard. It is the community/events layer on top of the existing challenge
engine — a QGSS/QHack-lite that needs **no operator**: nobody schedules a
competition, ever.

## How a week's puzzle comes to exist

The competition is a pure function of the clock (`apps/web/lib/compete/engine.ts`):

1. The current UTC instant is mapped to its ISO week key, e.g. `2026-W35`.
2. The key is hashed with FNV-1a — the same seeding style as the daily
   challenge pick on `/challenges` — into a seed.
3. The seed drives `generateChallenge()` (`lib/challenges/generate.ts`), which
   only ever returns puzzles it has **proven solvable by execution**. The
   reference solution's length becomes par.
4. The result is re-badged as a `gate-golf` challenge with the generator's
   hints stripped, because they contain the reference solution — the answer key.

Same week, same puzzle, on every instance, across redeploys. The window is
Monday 00:00 UTC to the next Monday 00:00 UTC; the API stamps `serverNow` and
`endsAt` so the page's countdown is anchored to the server clock, not the
visitor's.

## Entering, and why scores can be trusted

`POST /api/compete` requires a Supabase-verified bearer token and is rate
limited per account (12/minute). The body carries the circuit as OpenQASM —
the same text the simulator exports and the share links encode. The server:

- re-parses the QASM with the app's own parser (`fromQasm`),
- re-runs it through the real grader (`lib/challenges/grade.ts`),
- **recomputes the gate count itself**. A client-claimed `gates` value that
  disagrees with the recount rejects the entry; it is never "corrected".

Only your best entry per week is stored (strictly fewer gates replaces; ties
keep the earlier row, so `submitted_at` marks when the standing score was
first achieved). The leaderboard ranks by gate count, then submission time.

`GET /api/compete` is public: puzzle, deadline, top 20 (display name, gates,
time — never account ids, never anyone's QASM), plus your own standing and
your own circuit when signed in. Your circuit reopens in the simulator via the
existing share-link format.

## Storage

`apps/web/lib/compete/store.ts` follows the exam-store pattern: Supabase via
the service role when `SUPABASE_SERVICE_ROLE_KEY` is set, otherwise an
in-process Map. The fallback keeps grading server-side but is not durable —
responses carry `durable: false` and the page says so.

Schema: `supabase/schema-competitions.sql` — `competitions` (an audit row per
week, written lazily) and `competition_entries` (one row per account per
week). RLS is on with **no table policies**; the service role is the only
write path. The public read path is the `competition_leaderboard` view, which
exposes display name, gate count and time only. As with the other schema
files, the SQL has never been run against a live project — check before
trusting.

## Tests

`apps/web/lib/compete/engine.test.ts` (week derivation, determinism, no answer
leakage, par honesty, recount rejection), `store.test.ts` (best-only writes,
ordering, fallback), `routes.test.ts` (anonymous GET, 401 POST).
