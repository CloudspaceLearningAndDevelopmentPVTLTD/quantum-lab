-- ============================================================
-- Quantum Lab — outbound integrations schema (roadmap stage A5)
--
-- Run this in the Supabase SQL editor AFTER schema.sql. Everything
-- here is OPTIONAL in the sense that the app boots without it: with
-- no SUPABASE_SERVICE_ROLE_KEY the webhook store falls back to a Map
-- in the Node process (apps/web/lib/integrations/webhooks.ts), which
-- keeps the feature demoable and loses every registration on restart.
-- The /api/hooks responses carry `durable: false` in that state so a
-- caller is never told an endpoint outlived the process it lives in.
--
-- ############################################################
-- #  THIS TABLE IS WRITTEN ONLY BY THE SERVICE ROLE.         #
-- #                                                          #
-- #  RLS is enabled and NO POLICY IS CREATED — with RLS on   #
-- #  and no policy the anon and authenticated roles can do   #
-- #  nothing, and the service role (which bypasses RLS) is   #
-- #  the only path in. Registration, listing and deletion    #
-- #  all go through /api/hooks, which verifies the caller's  #
-- #  Supabase token and filters on user_id server-side, so   #
-- #  the effective policy is owner-only.                     #
-- #                                                          #
-- #  Do not "fix" the missing policies with a permissive     #
-- #  one: an authenticated SELECT scoped by auth.uid() would #
-- #  be safe for most columns but would hand the browser the #
-- #  `secret` column, and a webhook signing secret that has  #
-- #  been in a browser tab is not a secret. If you ever want #
-- #  a client-side read path, it must be a security-definer  #
-- #  function that returns everything EXCEPT `secret`.       #
-- ############################################################
--
-- WHY BOTH `secret` AND `secret_hash` EXIST: HMAC-SHA256 needs the
-- raw key at dispatch time, so — like Stripe and GitHub — the server
-- must keep the secret itself; a password-style hash-only column
-- would make signing impossible. `secret_hash` (sha256 hex of the
-- secret) is the non-sensitive fingerprint the list API may show so
-- an operator can match an endpoint to the secret they saved at
-- registration without the secret ever being served again.
--
-- HONESTY NOTE, same as schema-billing.sql and schema-exams.sql:
-- this file has never been run against a live Supabase project. The
-- shapes match what apps/web/lib/integrations/webhooks.ts reads and
-- writes, and that mapping is covered by tests against an in-memory
-- double, but the SQL itself is unverified. Check it before trusting
-- it.
-- ============================================================

-- ── Webhook endpoints ────────────────────────────────────────
-- One row per registered receiver. Account-scoped: user_id is the
-- Supabase auth.users id of the account that registered it, and the
-- dispatcher only ever delivers an event to endpoints owned by the
-- account the event is about.
create table if not exists public.webhook_endpoints (
  id            text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- https only, hostname vetted against private-IP literals at
  -- registration AND again at every dispatch (the SSRF guard in
  -- apps/web/lib/integrations/webhooks.ts). The database does not
  -- re-validate; the service role is the only writer and it does.
  url           text not null check (char_length(url) <= 2048),

  -- The raw signing key (server-generated, shown to the owner once
  -- at registration) and its sha256 fingerprint. See the header for
  -- why both columns exist.
  secret        text not null,
  secret_hash   text not null,

  -- Subset of: challenge_completed, exam_passed, hardware_job_finished.
  -- Stored as text[] rather than an enum so adding an event type is a
  -- code change, not a migration.
  events        text[] not null default '{}',

  -- Flipped to false by the dispatcher after MAX_CONSECUTIVE_FAILURES
  -- consecutive failed deliveries, so a dead receiver stops costing
  -- three timed-out attempts per event forever. The owner re-enables
  -- by deleting and re-registering.
  active        boolean not null default true,

  -- Consecutive failed DELIVERIES (an exhausted retry cycle counts
  -- once, not three times). Reset to 0 on any 2xx.
  failure_count integer not null default 0,

  created_at    timestamptz not null default now()
);

-- The dispatcher's read path: "active endpoints of this account".
create index if not exists webhook_endpoints_user_idx
  on public.webhook_endpoints (user_id) where active;

alter table public.webhook_endpoints enable row level security;
-- NO POLICIES — deliberate. See the banner above.

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
-- the internal competitive review §3.2.
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
