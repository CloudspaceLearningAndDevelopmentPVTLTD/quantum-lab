-- ============================================================
-- Quantum Lab — certification exams schema
--
-- Run this in the Supabase SQL editor AFTER schema.sql. Everything
-- here is OPTIONAL in the sense that the app boots without it: with
-- no SUPABASE_SERVICE_ROLE_KEY the exam store falls back to a Map in
-- the Node process (apps/web/lib/exams/store.ts). That fallback keeps
-- grading server-side and keeps the answer key out of the browser; it
-- does NOT survive a restart, and the candidate is told so on screen.
-- For anything you would call a deployment, run this file.
--
-- ############################################################
-- #  THESE TABLES ARE WRITTEN ONLY BY THE SERVICE ROLE.      #
-- #                                                          #
-- #  That is the entire security model of the certification  #
-- #  feature. A candidate who could UPDATE exam_attempts     #
-- #  could set score = 1 and passed = true, which is exactly #
-- #  the hole this replaced: before this, an attempt was a   #
-- #  JSON blob in the candidate's own localStorage and two   #
-- #  lines in a devtools console produced a pass.            #
-- #                                                          #
-- #  So RLS is enabled and NO POLICY IS CREATED. With RLS on #
-- #  and no policy, the anon and authenticated roles can do  #
-- #  nothing at all; the service role bypasses RLS and is    #
-- #  the only path in. Do not "fix" the missing policies by  #
-- #  adding a permissive one — an authenticated SELECT would #
-- #  hand every candidate the question ids of every paper,   #
-- #  and an authenticated UPDATE would hand them the score   #
-- #  column.                                                 #
-- #                                                          #
-- #  If you ever DO want a client-side read path, it must be #
-- #  a security-definer function that returns the attempt    #
-- #  WITHOUT question_ids and WITHOUT answers, never a       #
-- #  table policy.                                           #
-- ############################################################
--
-- HONESTY NOTE, same as schema-billing.sql and schema-orgs.sql:
-- this file has never been run against a live Supabase project. The
-- shapes match what apps/web/lib/exams/store.ts reads and writes, and
-- that mapping is covered by tests against an in-memory double, but
-- the SQL itself is unverified. Check it before trusting it.
-- ============================================================

-- ── Attempts ─────────────────────────────────────────────────
-- One row per sitting. This is the authority for every number a
-- candidate is shown.
--
-- subject_id is deliberately TEXT and NOT a foreign key to
-- auth.users: an anonymous practice sitting is keyed on a
-- 'guest_<32 hex>' cookie value (apps/web/lib/exams/session.ts) and
-- has no user row. subject_kind says which it is, and only 'user'
-- rows can ever be certified.
create table if not exists public.exam_attempts (
  id           text primary key,
  exam_id      text not null,
  subject_kind text not null check (subject_kind in ('user', 'guest')),
  subject_id   text not null,

  -- Both stamped from the SERVER clock at creation. expires_at is
  -- never recomputed: raising an exam's time limit must not hand time
  -- to attempts already running, and lowering it must not steal any.
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,

  submitted_at timestamptz,
  closed_by    text check (closed_by in ('candidate', 'expiry')),

  -- The paper, written down rather than re-derived from a seed. The
  -- old design stored a seed and reconstructed the questions, which
  -- meant adding a question to the bank silently re-dealt every
  -- attempt in flight — including ones a certificate was issued for.
  question_ids text[] not null default '{}',

  -- { questionId: { questionId, selectedIds, numberValue?, flagged } }
  answers      jsonb not null default '{}'::jsonb,

  -- Points earned over points available, 0..1. Written by the server
  -- and by nothing else. A NULL score means the attempt is still open.
  score        double precision check (score is null or (score >= 0 and score <= 1)),
  passed       boolean,
  certificate_id text,

  created_at   timestamptz not null default now(),

  -- A score without a submission timestamp, or the reverse, would mean
  -- the grading path half-ran. Refuse it at the database rather than
  -- discovering it in a support ticket.
  constraint exam_attempts_graded_together
    check ((submitted_at is null) = (score is null))
);

comment on table public.exam_attempts is
  'Server-side exam sittings. Written only by the service role: a candidate who could update score/passed would be able to issue themselves a certificate.';
comment on column public.exam_attempts.expires_at is
  'Server-stamped deadline. Immutable. lib/exams/service.ts refuses writes past it plus a 3s network grace.';
comment on column public.exam_attempts.subject_id is
  'auth.users.id for a signed-in candidate, or a guest_<hex> cookie value for an anonymous practice sitting.';

-- "What is my current attempt at this exam?" — the hottest query,
-- run on every load of /certify/<examId>.
create index if not exists exam_attempts_subject_exam_idx
  on public.exam_attempts (subject_id, exam_id, started_at desc);

-- /api/exams/summary reads a subject's whole history.
create index if not exists exam_attempts_subject_idx
  on public.exam_attempts (subject_id, started_at desc);

-- ── Certificates ─────────────────────────────────────────────
-- One row per issued credential. Immutable by convention: the app
-- never updates one, because a credential whose holder's name can be
-- edited after issue is not a credential.
create table if not exists public.exam_certificates (
  -- 'QL-XXXXX-XXXXX-C'. 50 bits of crypto randomness plus a checksum
  -- character; see newCertificateId() in apps/web/lib/certificate.ts.
  -- Unguessable on purpose: this id is what /verify/<id> resolves.
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  exam_id      text not null,

  -- One certificate per attempt. Re-posting the claim returns the
  -- existing row rather than minting a second number for one pass.
  attempt_id   text not null unique references public.exam_attempts (id) on delete cascade,

  -- Self-attested at issue. /verify says so in as many words: we
  -- record the name the candidate gave, we do not check documents.
  display_name text not null check (char_length(display_name) between 2 and 60),

  -- Kept for support and disputes. NOT returned by /verify — a
  -- verifier is entitled to know the person passed, not how narrowly.
  score        double precision not null,
  issued_at    timestamptz not null default now()
);

comment on table public.exam_certificates is
  'Issued credentials. /verify/<id> resolves one to name + exam + date, and discloses nothing else — not the score, not the account, not the attempt history.';
comment on column public.exam_certificates.score is
  'Support/disputes only. Never included in a verification response.';

create index if not exists exam_certificates_user_idx
  on public.exam_certificates (user_id, issued_at desc);

-- ── Row level security ───────────────────────────────────────
-- Enabled with NO policies, deliberately. See the banner at the top
-- of this file before changing anything here.
alter table public.exam_attempts     enable row level security;
alter table public.exam_certificates enable row level security;
