-- ============================================================
-- Quantum Lab — billing schema (subscriptions + hardware usage)
--
-- Run this in the Supabase SQL editor AFTER schema.sql (it reuses
-- the public.set_updated_at() helper defined there). Everything
-- here is OPTIONAL: with no Supabase project and no Stripe keys the
-- app runs entirely on the Free tier.
--
-- ############################################################
-- #  THE SECURITY PROPERTY THAT MATTERS MOST IN THIS FILE     #
-- #                                                           #
-- #  Users may SELECT their own subscription row and NOTHING  #
-- #  else. INSERT, UPDATE and DELETE are intentionally NOT    #
-- #  granted to the `anon` or `authenticated` roles on either #
-- #  table. Only the SERVICE-ROLE key — used exclusively by   #
-- #  /api/billing/webhook, which is server-side and verifies  #
-- #  Stripe's signature — may write these rows.               #
-- #                                                           #
-- #  Without this, any signed-in user could upgrade           #
-- #  themselves to Pro with a single PostgREST call:          #
-- #    update subscriptions set plan_id='pro' where ...       #
-- #  Do not add a permissive write policy here "to make the   #
-- #  client simpler". Entitlements are granted by Stripe, not #
-- #  by the browser.                                          #
-- ############################################################
-- ============================================================

-- ── Subscriptions ────────────────────────────────────────────
-- One row per user, mirroring the state of their Stripe
-- subscription. The webhook is the only writer.
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan_id                text not null default 'free'
                           check (plan_id in ('free', 'pro', 'team', 'edu')),
  status                 text not null default 'none',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.subscriptions is
  'Stripe-derived entitlement state. Writable only by the service role (the billing webhook).';

-- ── Hardware usage ───────────────────────────────────────────
-- One row per job submitted to real quantum hardware. Counted
-- against the plan allowance over the account's monthly usage
-- window, which is the SUBSCRIPTION'S monthly anniversary and not
-- the calendar month — the window is computed by the app and
-- passed in (apps/web/lib/billing/period.ts, docs/BILLING.md §7).
create table if not exists public.hardware_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  backend    text not null,
  shots      integer not null default 0,
  created_at timestamptz not null default now()
);

-- The provider job handle, stamped on AFTER the job is accepted
-- upstream. Null means "reserved but not confirmed": either the
-- submission failed and the row is about to be deleted, or the
-- upstream answered 2xx without a usable handle (logged loudly).
--
-- THESE TWO COLUMNS ARE THE OWNERSHIP RECORD. GET /api/hardware/
-- job/{provider}/{job_id} refuses to poll anything that does not
-- match a row belonging to the caller, so without them a job's
-- measurement results are readable by anyone holding the id.
--
-- `add column if not exists` so this file stays re-runnable against
-- a project that already has the original three-column table.
alter table public.hardware_usage
  add column if not exists provider text;
alter table public.hardware_usage
  add column if not exists job_id   text;

-- How the reservation ended. Null = claimed, outcome not yet
-- known (a row that stays null is a bug or a crashed request).
--   'confirmed' — upstream returned a job handle; provider/job_id
--                 are set and the job is pollable by its owner.
--   'unmatched' — upstream answered 2xx WITHOUT a usable handle.
--                 The vendor may well have accepted (and charged
--                 for) the job, so the row is KEPT against the
--                 allowance, but nothing can ever poll it. These
--                 rows are the operator's only trace of that
--                 money; the verification queries at the bottom of
--                 this file list them.
alter table public.hardware_usage
  add column if not exists settlement text;

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

-- The quota check counts a single user's recent rows.
create index if not exists hardware_usage_user_created_idx
  on public.hardware_usage (user_id, created_at desc);

-- ── Hardware engagement bonus ────────────────────────────────
-- One row per one-time "use it, earn more" grant: when a Pro
-- account consumes the 50th hardware job of its subscription
-- year, reserve_hardware_job (below) writes a row here and the
-- usage window the grant lands in gets +25 jobs of headroom.
-- The row is the ledger AND the once-per-year latch: the grant
-- check is "no row newer than the year start", made under the
-- same advisory lock as the reservation, so two simultaneous
-- 50th-job submissions cannot both grant. Written ONLY by
-- reserve_hardware_job (service_role); a user who could insert
-- here could mint their own allowance, which is the same attack
-- the hardware_usage RLS note describes.
create table if not exists public.hardware_bonus (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  jobs       integer not null check (jobs > 0),
  granted_at timestamptz not null default now()
);

comment on table public.hardware_bonus is
  'One-time engagement bonuses on the hardware quota. Written only by reserve_hardware_job; users may read their own rows so the quota display can say "+25 unlocked".';

-- The active-bonus lookup is "this user's newest grant since the
-- window/year start", on every reservation and every quota render.
create index if not exists hardware_bonus_user_granted_idx
  on public.hardware_bonus (user_id, granted_at desc);

-- The ownership check looks up one (user, provider, job) triple on
-- every poll, and the monitor polls with backoff for the life of a
-- job, so this one is load-bearing rather than nice to have.
create index if not exists hardware_usage_owner_job_idx
  on public.hardware_usage (user_id, provider, job_id);

-- ── Row level security ───────────────────────────────────────
-- Nothing is readable or writable until a policy allows it, and
-- the service-role key bypasses RLS entirely — which is exactly
-- how the webhook writes while users cannot.
alter table public.subscriptions  enable row level security;
alter table public.hardware_usage enable row level security;
alter table public.hardware_bonus enable row level security;

-- Read your own subscription. This is the ONLY policy on this
-- table: no insert, no update, no delete for ordinary users.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Read your own usage history (so the account page can show
-- "12 of 50 hardware jobs used"). Rows are written by the server
-- with the service role — a user cannot delete their usage to
-- reset their own quota.
drop policy if exists hardware_usage_select_own on public.hardware_usage;
create policy hardware_usage_select_own
  on public.hardware_usage for select
  using (auth.uid() = user_id);

-- Read your own bonus grants (the quota display's "+25 unlocked"
-- line). SELECT only, for the same reason as hardware_usage:
-- a writable bonus table is a self-service allowance printer.
drop policy if exists hardware_bonus_select_own on public.hardware_bonus;
create policy hardware_bonus_select_own
  on public.hardware_bonus for select
  using (auth.uid() = user_id);

-- ── updated_at maintenance ───────────────────────────────────
-- Reuses the helper created by schema.sql; redefined here so this
-- file is runnable on its own too.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- ATOMIC QUOTA RESERVATION
--
-- WHAT THIS REPLACES. The submit route used to INSERT a
-- reservation row and then COUNT (see the reservation note in
-- apps/web/lib/billing/usage.ts). Insert-then-count makes two
-- SEQUENTIAL submissions see each other, which is why the bug was
-- never noticed by hand, but two requests that both insert before
-- either counts both see a count that is under the limit and both
-- pass. On a serverless deployment "simultaneous" is the normal
-- case, not the exotic one: a double-clicked Submit button on two
-- instances is enough.
--
-- WHY A COUNT INSIDE ONE STATEMENT IS NOT ENOUGH EITHER. Under
-- Postgres's default READ COMMITTED, an
--     insert ... select ... where (select count(*) ...) < limit
-- is still racy: each transaction's snapshot is taken before the
-- other's insert becomes visible, so both subqueries return the
-- same number. Nothing about writing it as one statement fixes
-- that. Serializing is the only correct answer, and the cheapest
-- correct serialization for "one row per user" is a transaction-
-- scoped advisory lock keyed on the user id: it costs no table
-- write, it is released automatically when the transaction ends
-- (including on error, which a row-level "quota row" lock scheme
-- would need explicit care to match), and it blocks only the same
-- user's concurrent submissions. Two different users never wait
-- on each other.
--
-- SECURITY DEFINER, and why the grants below are load-bearing.
-- `hardware_usage` denies INSERT to `anon` and `authenticated` by
-- RLS on purpose: a user who can write their own usage rows can
-- also DELETE them and reset their own quota. This function runs
-- as its owner so it can insert, which means an ordinary caller
-- who could EXECUTE it could burn a STRANGER's allowance by
-- passing that stranger's uuid, or grant themselves an unlimited
-- allowance by passing a huge p_limit. It is therefore revoked
-- from public/anon/authenticated and granted ONLY to service_role
-- — the key that lives on the server and never reaches a browser.
-- DO NOT `grant execute ... to authenticated` to "let the client
-- reserve directly". The limit is an argument; trusting the caller
-- for it is the same as having no quota.
--
-- p_period_start is supplied by the application rather than
-- computed here because the window is the subscription's monthly
-- anchor, not the calendar month, and only the app knows the
-- anchor. See apps/web/lib/billing/period.ts for that decision.
--
-- ── THE ENGAGEMENT BONUS (the last three parameters) ────────
-- IBM-style "use it, earn more": when this reservation is the
-- p_bonus_threshold-th job since p_year_start (the subscription
-- year) and no bonus has been granted inside that year yet, a
-- one-time grant of p_bonus_jobs is written to hardware_bonus.
-- A grant raises the EFFECTIVE limit of the usage window it was
-- granted in — and only that window — by p_bonus_jobs, so the
-- extra headroom it can ever hand out is exactly p_bonus_jobs.
-- Both the grant check and the effective-limit read happen under
-- the same per-user advisory lock as the count+insert, so two
-- simultaneous 50th-job submissions cannot double-grant and a
-- refusal cannot miss a bonus granted a millisecond earlier.
-- Passing p_bonus_threshold as NULL (what the app does for every
-- non-Pro allowance) disables the mechanic entirely.
--
-- This version CHANGES THE RETURN TYPE (two bonus columns), so
-- the old five-argument function is dropped rather than replaced.
-- Callers on the old TS layer break at "no such function", which
-- apps/web/lib/billing/usage.ts already treats as "fall back to
-- the legacy path and log which file to run" — the same, loud
-- degradation an un-migrated project gets.
-- ============================================================
drop function if exists public.reserve_hardware_job(uuid, text, integer, integer, timestamptz);

create or replace function public.reserve_hardware_job(
  p_user_id         uuid,
  p_backend         text,
  p_shots           integer,
  p_limit           integer,
  p_period_start    timestamptz,
  p_bonus_threshold integer default null,
  p_bonus_jobs      integer default 0,
  p_year_start      timestamptz default null
)
returns table (reserved boolean, used integer, reservation_id uuid, bonus_jobs integer, bonus_granted boolean)
language plpgsql
security definer
-- An empty-ish search_path is mandatory on a security definer
-- function: without it a caller-controlled search_path can shadow
-- `hardware_usage` with their own table and the function will
-- happily write there as the owner.
set search_path = public, pg_temp
as $$
declare
  v_used      integer;
  v_id        uuid;
  v_bonus     integer := 0;
  v_granted   boolean := false;
  v_year_used integer;
begin
  if p_user_id is null or p_limit is null or p_period_start is null then
    raise exception 'reserve_hardware_job: user, limit and period start are required';
  end if;

  -- Serialize this user's reservations for the rest of the
  -- transaction. Everything below is now sequential per user, so
  -- the count cannot miss a concurrent insert (and the bonus
  -- grant cannot race the reservation that earns it).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*)::integer
    into v_used
    from public.hardware_usage
   where user_id = p_user_id
     and created_at >= p_period_start;

  -- A bonus granted INSIDE the current window raises this
  -- window's effective limit; older grants have already had
  -- their window and add nothing now.
  if p_year_start is not null then
    select coalesce(max(b.jobs), 0)
      into v_bonus
      from public.hardware_bonus b
     where b.user_id = p_user_id
       and b.granted_at >= greatest(p_period_start, p_year_start);
  end if;

  if v_used >= p_limit + v_bonus then
    -- Refused. No row is written, so a refusal never costs the
    -- caller a slot (the old code inserted first and had to hand
    -- the slot back, which silently lost one if the delete failed).
    return query select false, v_used, null::uuid, v_bonus, false;
    return;
  end if;

  insert into public.hardware_usage (user_id, backend, shots)
  values (
    p_user_id,
    coalesce(nullif(p_backend, ''), 'unknown'),
    greatest(coalesce(p_shots, 0), 0)
  )
  returning id into v_id;

  -- Grant check, AFTER the insert so "the 50th job" means the
  -- job this very reservation just claimed. One grant per
  -- subscription year: the latch is the existence of a row newer
  -- than p_year_start, checked under the same lock.
  if p_bonus_threshold is not null
     and coalesce(p_bonus_jobs, 0) > 0
     and p_year_start is not null then
    select count(*)::integer
      into v_year_used
      from public.hardware_usage
     where user_id = p_user_id
       and created_at >= p_year_start;

    if v_year_used >= p_bonus_threshold
       and not exists (
         select 1 from public.hardware_bonus b
          where b.user_id = p_user_id
            and b.granted_at >= p_year_start
       ) then
      insert into public.hardware_bonus (user_id, jobs)
      values (p_user_id, p_bonus_jobs);
      v_bonus   := p_bonus_jobs;
      v_granted := true;
    end if;
  end if;

  return query select true, v_used + 1, v_id, v_bonus, v_granted;
end;
$$;

revoke all on function public.reserve_hardware_job(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from public;
revoke all on function public.reserve_hardware_job(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from anon;
revoke all on function public.reserve_hardware_job(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from authenticated;
grant execute on function public.reserve_hardware_job(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) to service_role;

comment on function public.reserve_hardware_job(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) is
  'Counts the caller''s usage in [p_period_start, now) and inserts a reservation only if it is under p_limit plus any bonus granted in the window. May grant a one-time engagement bonus (hardware_bonus) when the reservation is the p_bonus_threshold-th job since p_year_start. Serialized per user by an advisory lock. service_role only: p_limit is an argument.';

-- ============================================================
-- WEBHOOK ORDERING AND IDEMPOTENCY
--
-- Stripe retries any non-2xx and makes NO ordering guarantee. Two
-- real failure modes follow, and neither was handled:
--
--  1. REPLAY. The same event delivered twice (a retry after our
--     500, or a hand-run `stripe trigger`) was processed twice.
--     For a plain upsert that is usually harmless, but combined
--     with (2) it is not: a redelivery of an OLD event overwrites
--     NEW state.
--  2. OUT OF ORDER. An upgrade (event created at 12:00:00) whose
--     first delivery times out is retried at 12:00:30, by which
--     time the customer's downgrade (created 12:00:10) has already
--     been delivered and applied. Last-writer-wins by ARRIVAL time
--     leaves the account on the upgraded plan it no longer pays
--     for — or, with the events the other way round, cancels an
--     account that is paying.
--
-- The fix is to make Stripe's `event.created` the ordering key
-- rather than our clock: an event older than the last one applied
-- to this account is dropped. `>=` (not `>`) on ties, because two
-- events can share a second and refusing both would drop real
-- state; a tie is genuinely ambiguous and last-delivered is as
-- good an answer as any.
-- ============================================================
alter table public.subscriptions
  add column if not exists last_event_id text;
alter table public.subscriptions
  add column if not exists last_event_at timestamptz;

comment on column public.subscriptions.last_event_at is
  'event.created of the most recent Stripe event applied to this row. Older events are dropped — see apply_stripe_subscription.';

-- Every event id we have finished processing. The handler checks
-- this BEFORE doing the work and records AFTER, so a crash in the
-- middle leaves the event unrecorded and Stripe's retry does it
-- again. Claiming the id first would be lost-event-by-design: the
-- retry would be skipped as a duplicate of work that never
-- happened, and Stripe's retry is the only recovery mechanism we
-- have.
create table if not exists public.stripe_events (
  id               text primary key,
  type             text not null,
  event_created_at timestamptz,
  processed_at     timestamptz not null default now()
);

comment on table public.stripe_events is
  'Idempotency ledger for /api/billing/webhook. Service role only; no RLS policy is defined, so no user role can read or write it.';

-- Housekeeping: the ledger only needs to outlive Stripe's retry
-- window (up to 3 days). This index makes the prune cheap.
create index if not exists stripe_events_processed_idx
  on public.stripe_events (processed_at desc);

alter table public.stripe_events enable row level security;
-- Deliberately NO policy: with RLS on and no policy, `anon` and
-- `authenticated` can do nothing at all here, while the service
-- role bypasses RLS. That is the whole access model.

create or replace function public.apply_stripe_subscription(
  p_user_id              uuid,
  p_customer_id          text,
  p_subscription_id      text,
  p_plan_id              text,
  p_status               text,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_event_id             text,
  p_event_at             timestamptz
)
returns table (applied boolean, plan_id text, last_event_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last    timestamptz;
  v_exists  boolean;
  v_applied boolean := false;
  v_plan    text;
begin
  if p_user_id is null then
    raise exception 'apply_stripe_subscription: user id is required';
  end if;

  -- Serialize this account's webhook writes, so two deliveries
  -- racing cannot both read the same `last_event_at` and both
  -- decide they are the newer one.
  perform pg_advisory_xact_lock(hashtextextended('stripe_sub:' || p_user_id::text, 0));

  select s.last_event_at, true
    into v_last, v_exists
    from public.subscriptions s
   where s.user_id = p_user_id
   for update;

  if v_exists is null then
    insert into public.subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, plan_id, status,
      current_period_end, cancel_at_period_end, last_event_id, last_event_at, updated_at
    ) values (
      p_user_id, p_customer_id, p_subscription_id, coalesce(p_plan_id, 'free'),
      coalesce(p_status, 'none'), p_current_period_end,
      coalesce(p_cancel_at_period_end, false), p_event_id, p_event_at, now()
    );
    v_applied := true;
  elsif v_last is null or p_event_at is null or p_event_at >= v_last then
    -- p_event_at null = a reconciliation run, which reads Stripe
    -- live and is therefore always at least as fresh as any event.
    update public.subscriptions s
       set stripe_customer_id     = p_customer_id,
           stripe_subscription_id = p_subscription_id,
           plan_id                = coalesce(p_plan_id, 'free'),
           status                 = coalesce(p_status, 'none'),
           current_period_end     = p_current_period_end,
           cancel_at_period_end   = coalesce(p_cancel_at_period_end, false),
           last_event_id          = coalesce(p_event_id, s.last_event_id),
           last_event_at          = greatest(coalesce(p_event_at, s.last_event_at), s.last_event_at),
           updated_at             = now()
     where s.user_id = p_user_id;
    v_applied := true;
  end if;

  select s.plan_id, s.last_event_at into v_plan, v_last
    from public.subscriptions s where s.user_id = p_user_id;

  return query select v_applied, v_plan, v_last;
end;
$$;

revoke all on function public.apply_stripe_subscription(uuid, text, text, text, text, timestamptz, boolean, text, timestamptz) from public;
revoke all on function public.apply_stripe_subscription(uuid, text, text, text, text, timestamptz, boolean, text, timestamptz) from anon;
revoke all on function public.apply_stripe_subscription(uuid, text, text, text, text, timestamptz, boolean, text, timestamptz) from authenticated;
grant execute on function public.apply_stripe_subscription(uuid, text, text, text, text, timestamptz, boolean, text, timestamptz) to service_role;

comment on function public.apply_stripe_subscription is
  'Writes a subscription row only when p_event_at is not older than the last applied event. service_role only — it can grant any plan to any user.';

-- ============================================================
-- VERIFICATION — run these BY HAND after applying this file.
--
-- WHAT HAS ALREADY BEEN OBSERVED, AND WHERE. This file was
-- applied end to end to a stock PostgreSQL 16.13, with stubs
-- standing in for the parts Supabase provides (a one-column
-- `auth.users`, an `auth.uid()` returning null, and empty `anon`
-- / `authenticated` / `service_role` roles). On that server,
-- queries 1-4 below were run and gave the answers they claim:
-- both functions are SECURITY DEFINER with a pinned search_path;
-- neither is executable by `anon` or `authenticated`; a second
-- session BLOCKED on the first's advisory lock for the whole time
-- the first transaction was open and then came back
-- `reserved = f`; a stale event was dropped and a null-stamped
-- reconciliation applied. Also observed: with 49 rows inside the
-- window and 5 outside it, a limit of 50 grants the 50th job and
-- refuses the 51st, and the 5 outside are not counted.
--
-- WHAT IS STILL UNVERIFIED, and why it needs a live project: on
-- Supabase these functions are owned by a different role, the
-- real `service_role` reaches them through PostgREST rather than
-- psql, `auth.uid()` returns a real claim, and RLS is evaluated
-- for roles that actually exist. None of that is reproducible
-- here. Run everything below against the project itself.
--
-- 1. The functions exist, are SECURITY DEFINER, and have a pinned
--    search_path (all three must be true; the third is the one
--    people forget):
--
--      select p.proname, p.prosecdef, p.proconfig
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('reserve_hardware_job',
--                           'apply_stripe_subscription');
--      -- expect prosecdef = t and proconfig = {search_path=public, pg_temp}
--
-- 2. NO user role may execute them. This is the grant that stops a
--    signed-in user from granting themselves Team:
--
--      select has_function_privilege('authenticated',
--               'public.reserve_hardware_job(uuid,text,integer,integer,timestamptz)',
--               'execute') as authenticated_can_execute,
--             has_function_privilege('anon',
--               'public.apply_stripe_subscription(uuid,text,text,text,text,timestamptz,boolean,text,timestamptz)',
--               'execute') as anon_can_execute;
--      -- BOTH must be false. If either is true, stop and re-run
--      -- the revokes; the quota and the plan are both forgeable.
--
-- 3. The quota is actually atomic. Two sessions, side by side,
--    with a limit of 1. Session A:
--
--      begin;
--      select * from public.reserve_hardware_job(
--        '<uuid>', 'ibm_brisbane', 1024, 1, now() - interval '1 day');
--      -- reserved = t. DO NOT COMMIT YET.
--
--    Session B, while A is still open:
--
--      select * from public.reserve_hardware_job(
--        '<uuid>', 'ibm_brisbane', 1024, 1, now() - interval '1 day');
--      -- MUST BLOCK on A's advisory lock. If it returns
--      -- reserved = t immediately, the lock is not working and
--      -- the race is still open.
--
--    Then `commit` in A: B unblocks and returns reserved = f,
--    used = 1. Roll back the test rows afterwards:
--      delete from public.hardware_usage where user_id = '<uuid>';
--
-- 4. Out-of-order webhooks are dropped:
--
--      select * from public.apply_stripe_subscription(
--        '<uuid>', 'cus_x', 'sub_x', 'team', 'active',
--        now() + interval '30 days', false, 'evt_new', now());
--      select * from public.apply_stripe_subscription(
--        '<uuid>', 'cus_x', 'sub_x', 'free', 'canceled',
--        null, false, 'evt_old', now() - interval '1 hour');
--      -- second call: applied = f, plan_id still 'team'.
--
-- 5. Jobs that were paid for but cannot be polled (§5 of the
--    submit path). Anything here is money spent with no handle;
--    check the provider console for these users:
--
--      select user_id, backend, shots, created_at
--        from public.hardware_usage
--       where settlement = 'unmatched'
--       order by created_at desc;
--
-- 6. Reservations that never settled at all — the request died
--    between the insert and the outcome. Expected to be empty or
--    near it; a steady trickle means the submit route is crashing
--    mid-flight:
--
--      select count(*) from public.hardware_usage
--       where settlement is null
--         and created_at < now() - interval '15 minutes';
--
-- 7. Prune the idempotency ledger (Stripe retries for up to 3
--    days; keeping 30 is cheap and useful for support):
--
--      delete from public.stripe_events
--       where processed_at < now() - interval '30 days';
--
-- 8. The property this whole file exists for: a signed-in user
--    cannot grant themselves a plan or erase their usage. As a
--    user (not the service role):
--
--      update public.subscriptions set plan_id = 'team';
--      -- expect UPDATE 0. Note it is NOT an error: RLS with no
--      -- UPDATE policy silently matches no rows, so "it did not
--      -- fail" is the wrong thing to check for. Zero rows.
--      insert into public.hardware_usage (user_id, backend, shots)
--        values (auth.uid(), 'x', 1);
--      -- expect: new row violates row-level security policy
--      select count(*) from public.stripe_events;
--      -- expect: permission denied
--
-- 9. The engagement bonus grants exactly once and only on the
--    threshold job. With a clean user and Pro numbers
--    (threshold 50, bonus 25), seed 49 rows inside the window,
--    then:
--
--      select reserved, used, bonus_jobs, bonus_granted
--        from public.reserve_hardware_job(
--          '<uuid>', 'ibm_brisbane', 1024, 50,
--          now() - interval '1 day',   -- period start
--          50, 25,                     -- threshold, bonus
--          now() - interval '30 days'  -- year start
--        );
--      -- expect: reserved = t, used = 50, bonus_jobs = 25,
--      --         bonus_granted = t  (the 50th job earns it)
--      -- call again: reserved = t, bonus_jobs = 25,
--      --         bonus_granted = f (once per year, and the
--      --         window's effective limit is now 75)
--      -- after 75 total: reserved = f
--      select count(*) from public.hardware_bonus
--        where user_id = '<uuid>';
--      -- expect exactly 1. Clean up both tables afterwards.
-- ============================================================
