-- ============================================================
-- qubit16 — published run permalinks (roadmap stage C1)
--
-- Run this in the Supabase SQL editor AFTER schema.sql and after
-- schema-billing.sql (which creates public.hardware_usage and its
-- result columns). Needs Postgres 15 or later, for the view's
-- `security_invoker` at the bottom.
--
-- RE-RUNNING IT IS SAFE BUT IS NOT A MIGRATION, and the difference
-- bites: `create table if not exists` does exactly nothing against
-- an existing table, so if this file LATER GAINS A COLUMN, re-running
-- it will not add that column and the first insert from
-- permalink.ts will fail with "column ... does not exist". Adding a
-- column to a table that already exists somewhere needs its own
-- `alter table ... add column if not exists`. The trigger, the
-- policy and the view below are drop-then-create or
-- create-or-replace, so those DO update on a re-run — except that
-- `create or replace view` refuses to drop or reorder an existing
-- view's columns, so a change to the view's select list needs a
-- `drop view` first.
--
-- WHAT THIS IS FOR. A paper that used this platform currently has
-- nothing to cite. The run exists — circuit, device, counts,
-- compilation settings — but it lives in one account's private
-- history and the only way to hand it to a reviewer is a CSV in a
-- GitHub gist. A gist is not a reproducibility artefact: it is a
-- file the author can edit after review, with no record of WHICH
-- DEVICE STATE produced the numbers.
--
-- This table is the citable object. One row is one run, frozen:
-- the circuit as submitted, the device, the CALIBRATION SNAPSHOT
-- AT SUBMISSION TIME, the compilation settings, the raw counts and
-- the date. The calibration snapshot is the part nobody else keeps
-- and it is the whole difference between a result that is
-- reproducible (you know the machine you would have to match) and
-- one that is merely repeatable (you can press the button again on
-- a machine that has since been recalibrated).
--
-- The TypeScript that builds a row is apps/web/lib/hardware/
-- permalink.ts — it decides the public id, assembles the snapshot
-- and strips the identifiers that must not be published. Read it
-- before adding a column here: a column this file gains is a
-- column the whole internet can read.
--
-- ############################################################
-- #  THIS TABLE IS WORLD-READABLE. IT IS THE ONLY ONE.        #
-- #                                                          #
-- #  Every other table in this project enables RLS with NO    #
-- #  policy, so only the service role gets in. That stance is #
-- #  wrong here and it is worth saying why rather than        #
-- #  copying the banner across.                               #
-- #                                                          #
-- #  A permalink whose contents can only be fetched by an     #
-- #  authenticated session is not a citation. The reviewer    #
-- #  who follows the link from a PDF has no account, and the  #
-- #  archival crawler that has to still resolve the link in   #
-- #  2035 will never have one. Routing the public read        #
-- #  through a service-role API route instead would work,     #
-- #  but it would put the only copy of the access rule in     #
-- #  application code — and the failure mode of that is a     #
-- #  route that forgets the `withdrawn_at` filter and serves  #
-- #  a row somebody asked us to take down. The database is    #
-- #  the right place for a rule this consequential.           #
-- #                                                          #
-- #  So: RLS is ON and there IS a SELECT policy for `anon`    #
-- #  and `authenticated`, and it is narrow —                  #
-- #                                                          #
-- #      public_opt_in AND withdrawn_at IS NULL               #
-- #                                                          #
-- #  — plus COLUMN-LEVEL grants, because an RLS policy is     #
-- #  row-level and this table has columns (source_id,         #
-- #  owner_id) that must never leave the server. Both are     #
-- #  needed: the policy alone would hand `select=*` the       #
-- #  owner's account id, and the grants alone would expose    #
-- #  runs whose owner never opted in.                         #
-- #                                                          #
-- #  ALL WRITES REMAIN SERVICE-ROLE ONLY. There is no INSERT, #
-- #  UPDATE or DELETE policy, so the publish path still has   #
-- #  to go through a route that has verified who is asking    #
-- #  and that they own the run being published.               #
-- ############################################################
--
-- ############################################################
-- #  ROWS ARE IMMUTABLE. A permalink that can change is not   #
-- #  a citation — if the counts behind a cited URL can be     #
-- #  edited after review, the link proves nothing and a       #
-- #  reviewer is right to ignore it.                          #
-- #                                                          #
-- #  Enforced by a trigger (published_runs_no_edit below),    #
-- #  not by convention, and not by RLS: the service role      #
-- #  bypasses RLS but NOT triggers, so the trigger is the     #
-- #  only mechanism that also binds our own APPLICATION.      #
-- #                                                           #
-- #  IT DOES NOT BIND THE OPERATOR, and the banner would be   #
-- #  dishonest if it did not say so: whoever owns this table  #
-- #  can `alter table ... disable trigger` or drop it, edit   #
-- #  the row and put it back. Same concession as the digest   #
-- #  below. What the trigger buys is that a published row     #
-- #  cannot be changed by an ordinary bug — a route that      #
-- #  upserts instead of inserting, a "fix the counts" script, #
-- #  a PostgREST PATCH — which is the failure that actually   #
-- #  happens. A reader who needs more than our word needs a   #
-- #  third-party archive; see verification query 4.           #
-- #                                                          #
-- #  THE ONE PERMITTED MUTATION is null -> withdrawn_at, and  #
-- #  it is permitted because the alternative is worse. A      #
-- #  circuit is user text: an OpenQASM comment can carry a    #
-- #  name, an unpublished result or a mistake, and "we        #
-- #  physically cannot take it down" is not an answer to an   #
-- #  erasure request or to a researcher who published the     #
-- #  wrong file. Withdrawal is one-way (a withdrawn row       #
-- #  cannot be republished) so it cannot be used to make a    #
-- #  permalink flicker between two states.                    #
-- #                                                          #
-- #  DELETE is deliberately NOT blocked. A hard delete leaves #
-- #  a dead citation and withdrawal is almost always the      #
-- #  right tool — but an operator under a legal erasure       #
-- #  obligation has to be able to remove the bytes, and a     #
-- #  trigger that refuses would make this table a liability.  #
-- #  Withdraw by default; delete only when required to.       #
-- ############################################################
--
-- WHY THERE IS NO FOREIGN KEY TO hardware_usage. `source_id` names
-- the private history row this snapshot was taken from, and the
-- obvious thing is a `references public.hardware_usage (id)`. Both
-- available behaviours are wrong:
--   * `on delete cascade` means deleting an account destroys every
--     citation that account ever published — the link in the paper
--     404s because somebody closed their account.
--   * `on delete restrict` means the account CANNOT be deleted,
--     which turns a published run into a reason we are unable to
--     honour an erasure request.
-- A published run is a SNAPSHOT, so it is decoupled on purpose:
-- the private history and the public record have independent
-- lifetimes. `source_id` stays as a plain unique column — enough
-- to keep publishing idempotent and to find the owner's original,
-- with no referential action attached. The cost is real and is
-- stated here rather than discovered later: deleting an account
-- does NOT withdraw its published runs, so account deletion must
-- withdraw them explicitly. There is a verification query for
-- orphans at the bottom of this file.
--
-- HONESTY NOTE, same as schema-billing.sql, schema-exams.sql and
-- schema-integrations.sql: this file has never been run against a
-- live Supabase project. The column names match what
-- apps/web/lib/hardware/permalink.ts emits and that mapping is
-- covered by tests, but the SQL itself — the trigger body, the
-- column grants, the policy — is unverified. Check it before
-- trusting it.
-- ============================================================


-- ── The published run ────────────────────────────────────────
create table if not exists public.published_runs (
  -- The citable id, and the last path segment of the permalink.
  -- Derived deterministically from `source_id` by publicRunId() in
  -- apps/web/lib/hardware/permalink.ts (sha256, truncated to 80
  -- bits, Crockford base32) — NOT random, so publishing the same
  -- run twice collides on this primary key instead of minting a
  -- second, divergent permalink for the same experiment.
  --
  -- Text and not uuid: this string gets typed out of a printed
  -- paper, and the derivation picks an alphabet without the
  -- characters that get transcribed wrong.
  public_id     text primary key check (char_length(public_id) between 8 and 64),

  -- ── PRIVATE COLUMNS. Never granted to anon or authenticated. ──
  -- The hardware_usage row this was snapshotted from. Unique, so
  -- one run has at most one permalink. See the header for why
  -- there is no foreign key.
  source_id     uuid not null unique,
  -- Who published it, for takedown and for "list my published
  -- runs". NOT the citation's author line — that is `attribution`
  -- below, which the publisher types. Deriving a public author
  -- name from the account would publish an identity nobody
  -- consented to publishing.
  owner_id      uuid,
  -- ── end private columns ──────────────────────────────────────

  -- The opt-in. NO DEFAULT, deliberately: a writer must state it.
  -- A `default false` would let a backfill that forgets the field
  -- insert unpublished rows silently, and a `default true` would
  -- let one publish somebody's data silently. With no default the
  -- insert simply fails, which is the only outcome of the three
  -- that anyone notices.
  public_opt_in boolean not null,

  -- Withdrawal. The one permitted mutation; one-way. A row with a
  -- timestamp here stays in the table so the id still resolves —
  -- the page is expected to answer "withdrawn" (HTTP 410) rather
  -- than 404, because a citation that becomes "no such thing" is
  -- worse for a reader than one that becomes "this was taken
  -- down".
  withdrawn_at  timestamptz,

  -- ── Citation metadata, typed by the publisher ────────────────
  -- Public free text, and NOT scrubbed: the publisher wrote it
  -- knowing it would be public. Bounded because it is rendered.
  title         text check (title is null or char_length(title) between 1 and 200),
  attribution   text check (attribution is null or char_length(attribution) between 1 and 200),
  notes         text check (notes is null or char_length(notes) <= 2000),

  -- ── The run ──────────────────────────────────────────────────
  backend       text not null,
  -- 'ibm' | 'braket' | 'azure' | null on a row written before the
  -- provider column existed upstream.
  provider      text,
  shots         integer not null check (shots >= 0),

  -- The circuit as submitted, OpenQASM. NOT NULL and that is a
  -- rule, not an accident: a permalink without the circuit is a
  -- histogram, and a histogram is not reproducible by anyone. The
  -- builder refuses to publish a run whose qasm was not loaded.
  --
  -- Stored verbatim, NOT scrubbed. A scrubber that rewrote a
  -- circuit would produce a citation that does not run, which is
  -- worse than not publishing. The consequence is that a comment
  -- in the circuit is published exactly as written, and that is
  -- what the opt-in is consent for.
  qasm          text not null check (char_length(qasm) between 1 and 200000),

  -- The measurement histogram as the vendor reported it. Null for
  -- a run that errored — which is a legitimate thing to publish
  -- and cite ("this device could not complete this circuit").
  counts        jsonb,

  -- Terminal states only. Publishing a queued run would freeze a
  -- row that never learns its own result.
  status        text not null check (status in ('done', 'error', 'cancelled')),

  -- Vendor error text, passed through scrubVendorText() first —
  -- vendor messages routinely quote the CRN, ARN or job handle of
  -- the account that submitted. That scrubber is a filter over
  -- text we do not control, not a proof, so the rendering must
  -- present this as vendor text rather than as our own.
  --
  -- 4000 is mirrored by MAX_PUBLISHED_ERROR_CHARS in permalink.ts,
  -- which clamps AFTER scrubbing (scrubbing changes the length in
  -- both directions) and appends a marker saying it did. Without
  -- that mirror a vendor's 40 kB stack trace turns a publish the
  -- owner already consented to into this check firing, which reads
  -- to them as "publishing is broken".
  error         text check (error is null or char_length(error) <= 4000),

  -- Metered QPU time. Part of the record because "how long did it
  -- actually take on the device" is a question a reader asks and
  -- no vendor console will answer for someone else's job.
  qpu_seconds   numeric,

  -- ── Compilation settings ─────────────────────────────────────
  -- Two runs of the "same" circuit at different optimization
  -- levels are different experiments. transpiled_two_qubit_gates
  -- is the single best predictor of how much of the result
  -- survived the noise, so a record without it cannot be compared
  -- against another record.
  --
  -- dynamical_decoupling and measurement_twirling are NOT columns
  -- of hardware_usage today; they are submission parameters the
  -- publisher supplies if it still has them, and null here means
  -- "not recorded", never "off".
  optimization_level          integer,
  transpiled_depth            integer,
  transpiled_two_qubit_gates  integer,
  dynamical_decoupling        boolean,
  measurement_twirling        boolean,

  -- ── The calibration snapshot ─────────────────────────────────
  -- The device's noise figures as they stood when this circuit was
  -- submitted: the CalibrationSummary shape from
  -- services/api/app/routers/hardware.py (source, qubits,
  -- median_1q_error, median_2q_error, median_t1_us, median_t2_us,
  -- queue_depth, note).
  --
  -- jsonb rather than eight columns because it is a snapshot of a
  -- payload that is allowed to gain fields; a reader needs what we
  -- saw, not our normalisation of it.
  --
  -- NULL IS A REAL AND COMMON ANSWER and the page must say so.
  -- Nothing in the pipeline records calibration against a job
  -- today (see the wiring note in the C1 report), so until a
  -- capture point exists at submission this is null for every row
  -- and the permalink is repeatable-but-not-reproducible. Do not
  -- let the UI imply otherwise by hiding the null.
  calibration   jsonb,
  -- Lifted out of the jsonb so it can be filtered and, more
  -- importantly, so it cannot be omitted from a rendering:
  -- 'live' (read from the vendor at submission), 'static' (the
  -- vendor's published typical values — a catalogue entry, not a
  -- measurement) or 'unavailable'. Presenting a 'static' snapshot
  -- as if it were measured would be the exact dishonesty this
  -- feature exists to remove.
  calibration_source text check (
    calibration_source is null
    or calibration_source in ('live', 'static', 'unavailable')
  ),
  -- When the snapshot was taken. Distinct from submitted_at
  -- because a cached calibration may be minutes older than the
  -- submission, and claiming they are simultaneous would put a
  -- precision on this that it does not have.
  calibration_captured_at timestamptz,

  -- ── Times ────────────────────────────────────────────────────
  -- When WE accepted the submission (hardware_usage.created_at).
  submitted_at  timestamptz not null,
  -- When we OBSERVED a terminal state — not the vendor's own
  -- completion time, which we never learn. Same caveat as
  -- hardware_usage.completed_at.
  completed_at  timestamptz,
  published_at  timestamptz not null default now(),

  -- sha256 (hex) of the canonical JSON of the snapshot, computed
  -- by snapshotDigest() before the insert. It lets a third party
  -- check that the bytes they are reading are the bytes that were
  -- published, from the published data alone.
  --
  -- BUT ONLY THROUGH THE CANONICALISATION IN permalink.ts. Postgres
  -- does not hand back what we sent: a timestamptz comes out as
  -- `2026-09-01T10:00:00+00:00` where we wrote `...T10:00:00.000Z`,
  -- and `qpu_seconds` (numeric) comes out as a STRING. Hash the JSON
  -- PostgREST returns and you disagree with this column on every
  -- single row. Use verifyPublishedRow() (or feed the row through
  -- toPublishedRunSnapshot() first); anything else reports every
  -- honest row as tampered with. Residual limit: `calibration` is
  -- opaque jsonb and Postgres normalises numbers inside it (1e-4 is
  -- stored as 0.0001), so a vendor payload written in exponent form
  -- can still fail to reproduce. Untested, because no row has a
  -- calibration yet.
  --
  -- BE CLEAR ABOUT WHAT THIS DOES NOT DO: it is not a signature.
  -- The operator computes it and could recompute it after an
  -- edit, so it defends against accidental drift, a bad migration
  -- and a partial write — not against us. A reader who needs more
  -- than our word wants this row in a third-party archive, and
  -- the digest is what makes such a copy checkable.
  snapshot_sha256 text not null check (char_length(snapshot_sha256) = 64),

  -- Bumped when the snapshot's SHAPE changes, so an old row is
  -- still interpretable rather than silently read under new rules.
  -- Old rows are never rewritten to a new version; immutability
  -- means a migration adds a version, it does not upgrade rows.
  schema_version integer not null default 1
);

-- The public read path is by primary key, so it needs no index.
-- This one serves "my published runs" on the owner's side.
create index if not exists published_runs_owner_idx
  on public.published_runs (owner_id, published_at desc);

-- The listing/discovery path: live permalinks, newest first.
create index if not exists published_runs_live_idx
  on public.published_runs (published_at desc)
  where public_opt_in and withdrawn_at is null;

comment on table public.published_runs is
  'Immutable, citable snapshots of single hardware runs. World-readable by design when public_opt_in and not withdrawn; written only by the service role.';
comment on column public.published_runs.source_id is
  'PRIVATE. The hardware_usage row this was snapshotted from. Never granted to anon or authenticated.';
comment on column public.published_runs.owner_id is
  'PRIVATE. Who published it, for takedown. Not the citation author — see attribution.';
comment on column public.published_runs.calibration is
  'Device calibration AS OF SUBMISSION. Null means not recorded, which is currently every row; the UI must say so rather than imply a measurement.';
comment on column public.published_runs.snapshot_sha256 is
  'Integrity check over the canonical snapshot JSON. Not a signature: the operator computes it. Recompute it only via verifyPublishedRow() in permalink.ts — hashing the raw PostgREST JSON disagrees on every row, because Postgres reformats timestamps and numerics.';


-- ── Immutability ─────────────────────────────────────────────
-- See the second banner. A trigger and not a convention, because
-- the service role bypasses RLS and would otherwise be bound by
-- nothing at all.
create or replace function public.published_runs_no_edit()
returns trigger
language plpgsql
as $$
begin
  -- Every column except withdrawn_at is frozen. Listed explicitly
  -- rather than compared with `to_jsonb(new) - 'withdrawn_at'`
  -- because a column added later must be an obvious decision here,
  -- not something a clever generic comparison silently covers or
  -- silently misses.
  if new.public_id       is distinct from old.public_id
  or new.source_id       is distinct from old.source_id
  or new.owner_id        is distinct from old.owner_id
  or new.public_opt_in   is distinct from old.public_opt_in
  or new.title           is distinct from old.title
  or new.attribution     is distinct from old.attribution
  or new.notes           is distinct from old.notes
  or new.backend         is distinct from old.backend
  or new.provider        is distinct from old.provider
  or new.shots           is distinct from old.shots
  or new.qasm            is distinct from old.qasm
  or new.counts          is distinct from old.counts
  or new.status          is distinct from old.status
  or new.error           is distinct from old.error
  or new.qpu_seconds     is distinct from old.qpu_seconds
  or new.optimization_level         is distinct from old.optimization_level
  or new.transpiled_depth           is distinct from old.transpiled_depth
  or new.transpiled_two_qubit_gates is distinct from old.transpiled_two_qubit_gates
  or new.dynamical_decoupling       is distinct from old.dynamical_decoupling
  or new.measurement_twirling       is distinct from old.measurement_twirling
  or new.calibration                is distinct from old.calibration
  or new.calibration_source         is distinct from old.calibration_source
  or new.calibration_captured_at    is distinct from old.calibration_captured_at
  or new.submitted_at    is distinct from old.submitted_at
  or new.completed_at    is distinct from old.completed_at
  or new.published_at    is distinct from old.published_at
  or new.snapshot_sha256 is distinct from old.snapshot_sha256
  or new.schema_version  is distinct from old.schema_version
  then
    raise exception
      'published_runs.% is immutable: a permalink whose contents can change is not a citation. Withdraw the run and publish a new one.',
      new.public_id
      using errcode = 'restrict_violation';
  end if;

  -- Withdrawal is one-way. Allowing it to be reversed — or moved —
  -- would let a permalink flicker between "here is the data" and
  -- "taken down", which is a worse guarantee than either.
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception
      'published_runs.% is already withdrawn; a withdrawal cannot be reversed or re-dated.',
      new.public_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- drop-then-create rather than `create or replace trigger`, which
-- only landed in Postgres 14 — and unlike the view's PG15
-- `security_invoker`, there is no reason to need a newer server for
-- this one statement, so it is written the portable way.
drop trigger if exists published_runs_no_edit on public.published_runs;
create trigger published_runs_no_edit
  before update on public.published_runs
  for each row execute function public.published_runs_no_edit();


-- ── Access ───────────────────────────────────────────────────
alter table public.published_runs enable row level security;

-- The deliberate exception. See the first banner for why this
-- table has a policy when no other table in this project does.
drop policy if exists "published runs are world readable" on public.published_runs;
create policy "published runs are world readable"
  on public.published_runs
  for select
  to anon, authenticated
  using (public_opt_in and withdrawn_at is null);

-- NO insert/update/delete policy. Publishing goes through a route
-- that has verified the caller owns the run.

-- Column-level grants, because RLS is row-level and two columns
-- here must never leave the server. Without this a `select=*` from
-- a browser would return source_id and owner_id on every published
-- row — the policy would happily allow it, since the row itself is
-- public. Revoke first: Supabase's default privileges already
-- granted these roles table-wide select on creation.
revoke all on public.published_runs from anon, authenticated;
grant select (
  public_id,
  public_opt_in,
  withdrawn_at,
  title,
  attribution,
  notes,
  backend,
  provider,
  shots,
  qasm,
  counts,
  status,
  error,
  qpu_seconds,
  optimization_level,
  transpiled_depth,
  transpiled_two_qubit_gates,
  dynamical_decoupling,
  measurement_twirling,
  calibration,
  calibration_source,
  calibration_captured_at,
  submitted_at,
  completed_at,
  published_at,
  snapshot_sha256,
  schema_version
) on public.published_runs to anon, authenticated;

-- The shape a public reader should select. Defence in depth rather
-- than the access rule itself: `security_invoker` means the view
-- runs with the reader's rights, so the policy and the column
-- grants above both still apply through it. Its job is to stop a
-- page author from typing `select=*` and getting a permission
-- error they then "fix" by widening the grant.
create or replace view public.published_runs_public
  with (security_invoker = true) as
  select public_id, title, attribution, notes,
         backend, provider, shots, qasm, counts, status, error, qpu_seconds,
         optimization_level, transpiled_depth, transpiled_two_qubit_gates,
         dynamical_decoupling, measurement_twirling,
         calibration, calibration_source, calibration_captured_at,
         submitted_at, completed_at, published_at,
         snapshot_sha256, schema_version
    from public.published_runs
   where public_opt_in and withdrawn_at is null;

-- Revoke first, then grant SELECT only. Supabase's default privileges grant
-- anon and authenticated everything on a new object in `public`, and a view
-- with `security_invoker` is updatable — an INSERT through it would be stopped
-- by the base table's missing insert policy, but relying on a second mechanism
-- to catch a privilege we did not mean to hand out is how the first one ends up
-- being the only one. The grant is then stated rather than assumed, because the
-- table above had ITS grants revoked and a reader who loses access to both the
-- table and the view has no public read path at all — which looks exactly like
-- "the permalink is broken".
revoke all on public.published_runs_public from anon, authenticated;
grant select on public.published_runs_public to anon, authenticated;

comment on view public.published_runs_public is
  'The public projection of published_runs: live rows only, private columns absent. security_invoker, so RLS and the column grants still apply.';


-- ── Verification queries ─────────────────────────────────────
-- Run these by hand after applying; none of them should return
-- anything surprising.
--
-- 1. Published runs whose owner no longer exists. These are the
--    cost of having no foreign key (see the header): an account
--    deletion does not withdraw its permalinks, so this list is
--    the operator's takedown queue.
--
--    select public_id, owner_id, published_at
--      from public.published_runs r
--     where r.owner_id is not null
--       and not exists (select 1 from auth.users u where u.id = r.owner_id)
--       and r.withdrawn_at is null;
--
-- 2. Rows claiming a calibration snapshot without a source marker,
--    or the reverse. Either way the page cannot honestly label
--    what it is showing.
--
--    select public_id, calibration is not null as has_calibration, calibration_source
--      from public.published_runs
--     where (calibration is null) <> (calibration_source is null);
--
-- 3. Runs published with no counts and no error — nothing to read.
--
--    select public_id, status from public.published_runs
--     where counts is null and error is null;
--
-- 4. That the immutability trigger is actually installed. An empty
--    result here means every guarantee in the second banner is
--    currently fiction.
--
--    select tgname, tgenabled from pg_trigger
--     where tgrelid = 'public.published_runs'::regclass and not tgisinternal;
--
-- 5. THE ONE THAT MATTERS MOST, because the column grants are the
--    only thing standing between `select=*` from a browser and the
--    owner's account id, and they are the part of this file least
--    likely to survive contact with Supabase's default privileges.
--    This must return NOTHING. If it returns source_id or owner_id,
--    the revoke did not take and every published run is leaking who
--    published it.
--
--    select grantee, column_name, privilege_type
--      from information_schema.column_privileges
--     where table_schema = 'public' and table_name = 'published_runs'
--       and grantee in ('anon', 'authenticated')
--       and column_name in ('source_id', 'owner_id');
--
-- 6. And the reverse: a column that exists but was never granted is
--    a column the public page silently cannot render. Expect the
--    two private columns and nothing else.
--
--    select c.column_name
--      from information_schema.columns c
--     where c.table_schema = 'public' and c.table_name = 'published_runs'
--       and not exists (
--             select 1 from information_schema.column_privileges p
--              where p.table_schema = c.table_schema and p.table_name = c.table_name
--                and p.column_name = c.column_name and p.grantee = 'anon'
--                and p.privilege_type = 'SELECT');
