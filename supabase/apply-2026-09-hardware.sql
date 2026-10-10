-- ============================================================
-- qubit16 — schema for the September 2026 hardware changes.
--
-- SAFE TO RE-RUN. Every statement is `if not exists`, so applying
-- this twice is a no-op and applying it to a project that already
-- has some of it only adds what is missing.
--
-- HOW TO APPLY: paste the whole file into the Supabase SQL editor
-- for your project and run it:
--
--   https://supabase.com/dashboard/project/flwyvhsmgrrqpmhcqlzd/sql/new
--
-- Or, with the CLI linked to the project:
--
--   supabase db push
--
-- WHAT BREAKS WITHOUT IT (the deployed code degrades, it does not
-- crash — but two features answer 503 until this runs):
--   * GET /api/hardware/jobs  — the durable job history
--   * /api/keys               — issuing and listing API keys
-- Submitting and polling hardware jobs is UNAFFECTED; those use
-- columns that already exist.
--
-- This is extracted verbatim from supabase/migrations/
-- 20260901000002_billing.sql and 20260901000007_integrations.sql,
-- which remain the canonical source.
-- ============================================================


-- ── The result record ────────────────────────────────────────
-- WHAT WAS MISSING AND WHY IT MATTERED
--
-- These columns did not exist, and the consequence was not
-- subtle: a hardware job's RESULTS were never stored anywhere on
-- this platform. The submitted job ids lived in `localStorage`
-- on /hardware, the counts were fetched from the vendor on each
-- poll and rendered, and nothing was written down. Close the tab
-- and the run was gone; open the site on a second machine and
-- the history was empty; a job that finished overnight was never
-- collected at all, because the only thing that ever advanced a
-- job's status was an open browser tab polling it.
--
-- For a teaching demo that is survivable. For the researcher and
-- the hardware engineer this product wants, it is disqualifying:
-- the entire value of running on a QPU is the record of what came
-- back, and "check the vendor's console" means the platform added
-- nothing to the vendor's console.
--
-- Written by the job-status proxy the first time it observes a
-- terminal state, under the same ownership check that already
-- guards reading them. Service-role only, like every other write
-- to this table.
--
-- `add column if not exists` so this file stays re-runnable.

-- queued | running | done | error | cancelled. Null means no poll
-- has ever observed this job — including every job submitted
-- before these columns existed.
alter table public.hardware_usage
  add column if not exists status text;

-- The measurement histogram, exactly as the vendor reported it:
-- {"00": 512, "11": 488}. jsonb rather than text so a future
-- query can reach inside it without parsing in the application.
alter table public.hardware_usage
  add column if not exists counts jsonb;

-- The circuit that produced those counts, as submitted OpenQASM.
--
-- THIS IS USER CONTENT and it is stored deliberately. Without it
-- the history is a list of histograms with no provenance, which
-- is not a record of an experiment — a researcher cannot tell
-- which of six variants produced which distribution, and cannot
-- re-run one. It is readable only by its owner (RLS below) and
-- by the service role. An operator who considers even that too
-- much can drop this one column; everything else still works and
-- the history degrades to counts without their circuit.
alter table public.hardware_usage
  add column if not exists qasm text;

-- Vendor error text for a job that failed at the device. Kept
-- because "it errored" is not an answer anyone can act on.
alter table public.hardware_usage
  add column if not exists error text;

-- Metered QPU time, in seconds, once the vendor settles it. This
-- is the unit IBM bills in — shots are what the user chose, QPU
-- seconds are what the invoice is made of.
alter table public.hardware_usage
  add column if not exists qpu_seconds numeric;

-- The Qiskit preset pass-manager level the circuit was compiled
-- at, and what that compilation produced. Two runs of the "same"
-- circuit at different levels are different experiments, and the
-- two-qubit count is the single best predictor of how much of the
-- result survived the noise — so a record without them cannot be
-- compared against another record.
alter table public.hardware_usage
  add column if not exists optimization_level integer;
alter table public.hardware_usage
  add column if not exists transpiled_depth integer;
alter table public.hardware_usage
  add column if not exists transpiled_two_qubit_gates integer;

-- When the job reached a terminal state, as observed by us. Not
-- the vendor's completion time: we only learn of it at the next
-- poll, and claiming otherwise would put a precision on this
-- column that it does not have.
alter table public.hardware_usage
  add column if not exists completed_at timestamptz;


-- ── API keys ─────────────────────────────────────────────────
-- One row per issued key. These are the credential a SCRIPT
-- presents, as opposed to the Supabase session token a browser
-- presents; both resolve to the same account through
-- apps/web/lib/security/auth.ts.
--
-- WHY THIS TABLE EXISTS: until it did, every capability on this
-- platform was reachable only by hand. There was no way to put a
-- hardware submission in a loop, in a CI job, or in a paper's
-- reproduction instructions — which is the difference between a
-- thing a researcher looks at and a thing a researcher uses.
-- docs/COMPETITIVE-GAPS.md §3.2.
--
-- ############################################################
-- #  ONLY THE HASH IS STORED. This is the one place this      #
-- #  schema differs from webhook_endpoints above, and the     #
-- #  difference is deliberate.                                #
-- #                                                          #
-- #  webhook_endpoints keeps the raw `secret` because HMAC    #
-- #  signing needs it at dispatch time — the server is the    #
-- #  one doing the signing. An API key is the opposite: the   #
-- #  server only ever RECEIVES it and needs to answer "have   #
-- #  I seen this before?", which a hash answers. So there is  #
-- #  no `key` column and there must never be one. A key is    #
-- #  shown to its owner exactly once, at creation, and if     #
-- #  they lose it they issue another.                         #
-- #                                                          #
-- #  SHA-256 and not bcrypt/argon2, on purpose: those exist   #
-- #  to make GUESSING cheap-to-verify secrets expensive, and  #
-- #  are the right choice for human-chosen passwords. This    #
-- #  key is 32 bytes from a CSPRNG. There is no dictionary    #
-- #  to run against 256 bits of entropy, and a slow hash on   #
-- #  the read path would add work to every authenticated API  #
-- #  request to defend against an attack that cannot be run.  #
-- #  Stripe and GitHub hash their tokens the same way.        #
-- ############################################################
--
-- RLS is enabled with NO POLICIES, exactly as above: the anon and
-- authenticated roles can do nothing, and /api/keys — which
-- verifies a SUPABASE SESSION token, never a key — is the only
-- path in. Note that a key cannot be used to mint another key;
-- see apps/web/app/api/keys/route.ts for why that matters.
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,

  -- What the owner called it ("laptop", "ci", "thesis-sweep"). Shown
  -- in the listing so a key can be revoked without guessing which is
  -- which. Bounded because it is user text rendered in a UI.
  name         text not null check (char_length(name) between 1 and 64),

  -- The first characters of the key, stored in the clear so the
  -- listing can say `qb16_sk_7Fq2…` next to the name. This is an
  -- IDENTIFIER, not a secret: it is far too short to guess the rest
  -- from, and without it revoking the right key means guessing.
  key_prefix   text not null check (char_length(key_prefix) <= 24),

  -- sha256 hex of the full key. The lookup on every authenticated
  -- request is by this column, so it is unique AND indexed.
  key_hash     text not null unique,

  -- What this key may do. Subset of: hardware:read, hardware:submit.
  -- text[] rather than an enum so adding a scope is a code change,
  -- not a migration — same reasoning as webhook_endpoints.events.
  --
  -- A key with no scopes can authenticate and do nothing, which is a
  -- useful state (it proves the credential works) and is the safe
  -- default for a bug that drops the array.
  scopes       text[] not null default '{}',

  created_at   timestamptz not null default now(),

  -- Stamped on use, best-effort and asynchronously — the write must
  -- never be on the critical path of the request it is recording.
  -- Its purpose is answering "is this key still in use?" before
  -- revoking it, so minute-level accuracy is ample.
  last_used_at timestamptz,

  -- Revocation is a TIMESTAMP, not a delete. A deleted row cannot
  -- answer "was this key active when that job was submitted?", and
  -- that is the question an incident asks. The lookup treats any
  -- non-null value as refused.
  revoked_at   timestamptz
);

-- The authentication read path: one key, by hash. This runs on every
-- API-key request, so it is load-bearing rather than nice to have.
-- (The `unique` on key_hash already creates one; this is a comment
-- about why that uniqueness is not merely a constraint.)

-- The listing read path: one account's keys, newest first.
create index if not exists api_keys_user_created_idx
  on public.api_keys (user_id, created_at desc);

comment on table public.api_keys is
  'Programmatic credentials. Only the sha256 hash is stored; the key itself is shown once at creation and never again.';

alter table public.api_keys enable row level security;
-- NO POLICIES — deliberate. See the banner above.
