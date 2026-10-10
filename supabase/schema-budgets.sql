-- ============================================================
-- Quantum Lab — spend budgets (gap C3)
--
-- Run this in the Supabase SQL editor AFTER schema-billing.sql.
-- It depends on that file for three things and will fail loudly
-- without them: public.hardware_usage (the rows it prices),
-- public.reserve_hardware_job (the function it wraps) and
-- public.set_updated_at() (the trigger helper, originally from
-- schema.sql). Like every other schema file here it is OPTIONAL:
-- with no rows in public.spend_budgets nothing below changes any
-- decision the platform already made.
--
-- ############################################################
-- #  WHAT THIS FILE IS FOR                                    #
-- #                                                           #
-- #  The platform already meters JOBS. It has never metered   #
-- #  MONEY, and money is the unit a PI with a grant cares     #
-- #  about. "50 hardware jobs a month" bounds nothing a       #
-- #  finance office recognises: 50 jobs of 100 shots on IonQ  #
-- #  is about $15, and 50 jobs of 20,000 shots is about $45.  #
-- #  That gap is the reason a lab will not hand a student an  #
-- #  API key.                                                 #
-- #                                                           #
-- #  THE CURRENCY THIS FILE CAN ACTUALLY ENFORCE IN, AND WHY  #
-- #  IT IS NOT DOLLARS-YOU-WERE-BILLED:                       #
-- #                                                           #
-- #   * There is no invoice feed. Nothing in this system ever #
-- #     reads what AWS, IBM or Azure actually charged. If a   #
-- #     vendor changes a price, applies a free-tier credit,   #
-- #     or bills a reservation rather than per shot, this     #
-- #     file does not know.                                   #
-- #   * hardware_usage does NOT store a dollar cost. It       #
-- #     stores backend, shots and (after a poll observes a    #
-- #     finished job) qpu_seconds.                            #
-- #   * qpu_seconds is a MEASUREMENT, but a lagging one: it   #
-- #     is null until a poll sees the job finish, and only    #
-- #     the IBM path reports it at all. A budget denominated  #
-- #     in it cannot stop a burst — twenty jobs submitted in  #
-- #     ten seconds all see zero seconds spent. It is         #
-- #     reported below for monitoring and is deliberately     #
-- #     NOT the enforced unit.                                #
-- #   * So the enforced unit is ESTIMATED USD, recomputed     #
-- #     from backend + shots with the same published-price    #
-- #     model that /api/hardware/estimate shows the user      #
-- #     before they submit                                    #
-- #     (services/api/app/quantum/transpile.py).              #
-- #                                                           #
-- #  Every column, function and return value below says       #
-- #  "estimated". Do not rename one of them to `spent_usd`    #
-- #  or `cost`: a projection presented as a measurement is    #
-- #  the one thing this codebase does not do, and a budget    #
-- #  is exactly where somebody would believe it.              #
-- ############################################################
-- ============================================================

-- ── The budget ───────────────────────────────────────────────
-- One row per account, over the SAME monthly usage window the
-- job quota uses: the subscription's monthly anniversary, not
-- the calendar month (apps/web/lib/billing/period.ts). Sharing
-- the window is deliberate — a budget that resets on a different
-- day than the quota gives two different answers to "how much of
-- this month is left", and support cannot explain either.
--
-- WHY A SURROGATE KEY AND A `scope` COLUMN rather than the
-- obvious `user_id primary key`. A per-project or per-key budget
-- is the next thing a lab asks for (docs/PLAN-BEST-IN-CLASS.md
-- C3, and C2's shared team quota lands beside it). With user_id
-- as the primary key, adding one is a table rewrite and a
-- migration of every existing row. With this shape it is:
--
--   alter table public.spend_budgets
--     add column if not exists project_id uuid;
--   alter table public.spend_budgets
--     drop constraint spend_budgets_scope_check,
--     add constraint spend_budgets_scope_check
--       check (scope in ('account', 'project', 'api_key'));
--   create unique index spend_budgets_project_idx
--     on public.spend_budgets (user_id, project_id)
--     where scope = 'project';
--
-- — three additive statements, no existing row touched, and the
-- partial unique index that enforces "one account budget per
-- user" keeps enforcing exactly that.
create table if not exists public.spend_budgets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- Which thing this budget covers. Only 'account' exists today;
  -- the check is here so a later scope is a constraint change
  -- rather than a discovery that half the rows mean something
  -- else. A null scope would make the partial unique index below
  -- silently stop enforcing uniqueness, hence `not null`.
  scope      text not null default 'account'
               constraint spend_budgets_scope_check
               check (scope in ('account')),

  -- The limit, in ESTIMATED US dollars, per usage window.
  -- NULL means "a row exists but sets no dollar ceiling" — used
  -- to carry a note or a future non-dollar limit without a hard
  -- stop. numeric, never float: a budget compared in floating
  -- point can refuse a job at $99.99999999 of a $100 limit.
  limit_usd  numeric(12,2) check (limit_usd is null or limit_usd >= 0),

  -- Warn at this percentage of the limit. 80 means the account
  -- is told at $80 of $100. NULL disables the warning entirely.
  warn_at_percent smallint default 80
               check (warn_at_percent is null
                      or (warn_at_percent > 0 and warn_at_percent <= 100)),

  -- true  → over the limit REFUSES the submission.
  -- false → over the limit is reported and allowed (an alert-only
  --         budget, which is what a PI who wants visibility but
  --         not an outage the week before a deadline asks for).
  hard_stop  boolean not null default true,

  -- The window whose warning has already been announced. The
  -- once-per-window latch for the threshold alert; claimed by
  -- public.claim_spend_warning below, never set by hand.
  warned_for_period timestamptz,

  -- Who set it. Audit only — it is NOT an authorisation record,
  -- because the only writer is the service role and the route
  -- behind it decides who may write (see the RLS note).
  set_by     uuid references auth.users (id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.spend_budgets is
  'Per-account spending limits in ESTIMATED USD (recomputed from backend+shots; never a vendor invoice), over the subscription monthly usage window. Writable only by the service role.';

-- One account budget per user. Partial, so the per-project and
-- per-key budgets described above can coexist with it later.
create unique index if not exists spend_budgets_account_idx
  on public.spend_budgets (user_id)
  where scope = 'account';

-- ── Row level security ───────────────────────────────────────
-- Read your own budget (the account page shows "$41.20 of $100
-- estimated"). NO insert, update or delete policy: the service
-- role is the only writer.
--
-- BE HONEST ABOUT WHAT THAT DOES AND DOES NOT BUY. It stops a
-- signed-in user from raising their own ceiling with a single
-- PostgREST call, which is the same attack the hardware_usage
-- note in schema-billing.sql describes. It does NOT by itself
-- make the budget un-raisable by the spender: if the settings
-- route that writes this table accepts the account holder's own
-- request, then for a personal account the budget is a guard
-- rail against a runaway loop, not a control imposed by someone
-- else. Making it the latter needs an owner/member distinction,
-- which is gap C2's org roles (supabase/schema-orgs.sql), not
-- this file's. Say that to a PI rather than letting them assume.
alter table public.spend_budgets enable row level security;

drop policy if exists spend_budgets_select_own on public.spend_budgets;
create policy spend_budgets_select_own
  on public.spend_budgets for select
  using (auth.uid() = user_id);

drop trigger if exists spend_budgets_set_updated_at on public.spend_budgets;
create trigger spend_budgets_set_updated_at
  before update on public.spend_budgets
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- THE PRICE MIRROR
--
-- A hand-transcribed copy of PER_SHOT_USD, TASK_FEE_USD and
-- BACKEND_VENDOR from services/api/app/quantum/transpile.py.
--
-- WHY A COPY AT ALL. The alternative — select every
-- hardware_usage row in the window over the wire and price it in
-- TypeScript — was rejected twice over: it would make a THIRD
-- copy of the table (Python, TypeScript, and whatever the SQL
-- eventually needed anyway), and it cannot be done inside the
-- advisory lock that makes the budget check atomic, which is the
-- entire point of this file. The arithmetic has to be where the
-- lock is.
--
-- WHAT DRIFT COSTS, SAID PLAINLY. Nothing here fails if the two
-- tables diverge, and no test on either side can catch it. If
-- Python's price rises and this one does not, budgets under-count
-- and an account spends past its ceiling. If a new PAID backend
-- is added to the registry and not added here, this function
-- returns NULL for it and the budget path REFUSES that backend
-- outright (see below) — noisy, on purpose, and the opposite of
-- what happens on the display path.
--
-- THE DELIBERATE DIVERGENCE FROM transpile.py. There,
-- vendor_for() maps an unknown backend id to "simulator", which
-- prices at $0; that module's own comment records this once
-- telling a user an IonQ Forte run was free. For a price shown on
-- screen, guessing low is a bug. For a budget it is a hole:
-- "unknown device costs nothing" is an unlimited allowance
-- reachable by adding one row to a registry. So unknown ids, and
-- Quantinuum (which bills in H-System Credits and has no honest
-- dollar rate at all), return NULL here, meaning "no number" —
-- never 0.
-- ============================================================
create or replace function public.estimated_job_cost_usd(
  p_backend text,
  p_shots   integer
)
returns numeric
language sql
immutable
as $$
  with job as (
    select
      greatest(coalesce(p_shots, 0), 0)::numeric as shots,
      case p_backend
        when 'aer_simulator'   then 'simulator'
        when 'aer_noisy'       then 'simulator'
        when 'cirq_simulator'  then 'simulator'
        when 'braket_local'    then 'simulator'
        when 'ibm_quantum'     then 'ibm'
        when 'ibm_brisbane'    then 'ibm'
        when 'ibm_kyiv'        then 'ibm'
        when 'ibm_sherbrooke'  then 'ibm'
        when 'ionq_aria'       then 'ionq'
        when 'ionq_forte'      then 'ionq'
        when 'azure_ionq_aria' then 'ionq'
        when 'rigetti_ankaa'   then 'rigetti'
        -- 'azure_quantinuum_h1' is deliberately absent: it falls
        -- through to NULL with every unknown id, which is what
        -- _UNPRICED_VENDORS means on the Python side.
        else null
      end as vendor
  )
  select case vendor
           when 'ionq'      then round(0.00003::numeric * shots + 0.30, 6)
           when 'rigetti'   then round(0.00035::numeric * shots + 0.30, 6)
           -- ############################################################
           -- #  THE BIGGEST HOLE IN THIS FILE, AND IT IS A ZERO, NOT A  #
           -- #  NULL, SO NOTHING FLAGS IT.                              #
           -- #                                                          #
           -- #  IBM prices at $0 here because transpile.py prices IBM's #
           -- #  OPEN plan, which is free and metered in QPU-seconds.    #
           -- #  A PI on Pay-As-You-Go or a Premium contract pays per    #
           -- #  second, and for them this row is simply false.          #
           -- #                                                          #
           -- #  Because it is 0 and not NULL, these jobs count as       #
           -- #  PRICED: unpriced_jobs stays 0, estimated_usd stays      #
           -- #  $0.00, and a budget NEVER refuses an IBM submission no  #
           -- #  matter how many there have been. The understatement     #
           -- #  mechanism this file is proud of does not cover the      #
           -- #  platform's flagship vendor.                             #
           -- #                                                          #
           -- #  Fixing it needs a real IBM rate, which is per-contract  #
           -- #  and per-plan, plus a plan flag on the account. Inventing #
           -- #  a number here would be worse than the hole. Until then, #
           -- #  a spend budget bounds Braket and Azure-IonQ and nothing #
           -- #  else, and any UI built on it must say that.             #
           -- ############################################################
           when 'ibm'       then 0::numeric
           when 'simulator' then 0::numeric
           else null::numeric
         end
    from job;
$$;

comment on function public.estimated_job_cost_usd(text, integer) is
  'ESTIMATED USD for one submission, mirroring services/api/app/quantum/transpile.py. NULL means this vendor cannot be priced (Quantinuum, or an id missing from the mirror) — never treat NULL as zero.';

-- ============================================================
-- SPEND SO FAR
--
-- Every hardware_usage row in the window is counted, including
-- rows with settlement null ("claimed, outcome unknown") and
-- 'unmatched' ("the vendor answered 2xx with no handle; it may
-- well have charged us"). Excluding those would be the cheap
-- direction on a spending path. Rows for submissions that
-- genuinely never happened are DELETED by releaseHardwareJob, so
-- they are not here to count.
--
-- qpu_seconds is summed and returned but drives no decision: see
-- the header. It is what a future budget-in-seconds would
-- enforce on, once every provider reports it and the lag is
-- understood.
-- ============================================================
drop function if exists public.spend_in_window(uuid, timestamptz);

create function public.spend_in_window(
  p_user_id      uuid,
  p_period_start timestamptz
)
returns table (
  estimated_usd        numeric,
  priced_jobs          integer,
  unpriced_jobs        integer,
  jobs                 integer,
  shots                bigint,
  measured_qpu_seconds numeric
)
language sql
security definer
-- Mandatory on a security definer function, for the reason
-- schema-billing.sql spells out: without it a caller-controlled
-- search_path can shadow `hardware_usage` with their own table.
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(public.estimated_job_cost_usd(u.backend, u.shots)), 0)::numeric,
    count(*) filter (
      where public.estimated_job_cost_usd(u.backend, u.shots) is not null
    )::integer,
    count(*) filter (
      where public.estimated_job_cost_usd(u.backend, u.shots) is null
    )::integer,
    count(*)::integer,
    coalesce(sum(u.shots), 0)::bigint,
    coalesce(sum(u.qpu_seconds), 0)::numeric
  from public.hardware_usage u
  where u.user_id = p_user_id
    and u.created_at >= p_period_start;
$$;

comment on function public.spend_in_window(uuid, timestamptz) is
  'ESTIMATED USD spent in [p_period_start, now), the job and shot counts behind it, and the number of jobs that could not be priced at all (they contribute 0 and therefore UNDERSTATE the total).';

-- ============================================================
-- ONE ROUND TRIP FOR THE PRE-FLIGHT DECISION
--
-- Returns the budget row and the spend beside it so the
-- application makes one call rather than three. It decides
-- nothing: allow / warn / refuse is computed in
-- apps/web/lib/billing/budget.ts, from these numbers.
--
-- A user with no budget row still gets a row back, with
-- budget_id null. "No budget configured" is a definite answer
-- from a healthy store and it means NO LIMIT; it is not the same
-- as "the store did not answer", which is a refusal. The
-- TypeScript layer depends on telling those apart, so this
-- function must keep returning exactly one row.
-- ============================================================
drop function if exists public.spend_budget_snapshot(uuid, timestamptz, text, integer);

create function public.spend_budget_snapshot(
  p_user_id      uuid,
  p_period_start timestamptz,
  p_backend      text default null,
  p_shots        integer default 0
)
returns table (
  budget_id             uuid,
  limit_usd             numeric,
  warn_at_percent       smallint,
  hard_stop             boolean,
  warned_for_period     timestamptz,
  estimated_spent_usd   numeric,
  estimated_pending_usd numeric,
  priced_jobs           integer,
  unpriced_jobs         integer,
  jobs                  integer,
  shots                 bigint,
  measured_qpu_seconds  numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    b.id,
    b.limit_usd,
    b.warn_at_percent,
    coalesce(b.hard_stop, true),
    b.warned_for_period,
    s.estimated_usd,
    case when p_backend is null then 0::numeric
         else public.estimated_job_cost_usd(p_backend, p_shots)
    end,
    s.priced_jobs,
    s.unpriced_jobs,
    s.jobs,
    s.shots,
    s.measured_qpu_seconds
  from public.spend_in_window(p_user_id, p_period_start) s
  -- LEFT JOIN, not a join on the budget: the spend row must come
  -- back even when no budget exists, or "no budget" and "the
  -- query returned nothing" become indistinguishable.
  left join public.spend_budgets b
    on b.user_id = p_user_id
   and b.scope = 'account';
$$;

comment on function public.spend_budget_snapshot(uuid, timestamptz, text, integer) is
  'The account budget (budget_id null when none is set) beside its ESTIMATED spend in the window and the estimated cost of the submission under consideration. Decides nothing.';

-- ============================================================
-- THE ONCE-PER-WINDOW WARNING LATCH
--
-- Claims the right to announce "you are at 80% of your budget"
-- for one window, and returns whether THIS caller is the one who
-- claimed it. Two simultaneous submissions that both cross the
-- threshold must produce one alert, not two.
--
-- The compare-and-set is the whole mechanism: the WHERE clause
-- re-checks the column it also writes, and under READ COMMITTED
-- the second transaction re-evaluates that clause against the
-- first one's committed row, matches nothing, and returns false.
-- No advisory lock is needed here because — unlike the budget
-- check, which reads one table and writes another — this is a
-- single statement whose condition is a column of the very row
-- it updates, which is the one case READ COMMITTED gets right on
-- its own.
--
-- NOT AN AUTHORISATION. A false return means "somebody else will
-- send the alert", never "refuse the job".
-- ============================================================
create or replace function public.claim_spend_warning(
  p_budget_id    uuid,
  p_period_start timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed uuid;
begin
  if p_budget_id is null or p_period_start is null then
    return false;
  end if;

  update public.spend_budgets
     set warned_for_period = p_period_start
   where id = p_budget_id
     and (warned_for_period is null or warned_for_period < p_period_start)
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

comment on function public.claim_spend_warning(uuid, timestamptz) is
  'Compare-and-set latch: true exactly once per budget per usage window. Never an authorisation.';

-- ============================================================
-- THE ATOMIC PATH — and the race it closes
--
-- READ THE LONG COMMENT ABOVE reserve_hardware_job IN
-- schema-billing.sql FIRST. A budget has precisely the race the
-- job quota had: check the spend, then insert the job, and two
-- simultaneous submissions both read a total only one of them
-- fits under. On a serverless deployment that is the normal case
-- — a double-clicked Submit landing on two instances is enough.
--
-- The fix is the same lock, and it is the same lock ON PURPOSE:
-- pg_advisory_xact_lock(hashtextextended(user_id::text, 0)),
-- byte for byte the key reserve_hardware_job uses. This function
-- takes it, prices the window, refuses or proceeds, and then
-- CALLS reserve_hardware_job, which takes the same key again.
-- Advisory locks are re-entrant within a transaction, so the
-- nested acquisition returns immediately, and the lock is held
-- across the budget arithmetic AND the insert — one transaction,
-- one lock, no window between the check and the act. Two callers
-- for DIFFERENT users still never wait on each other.
--
-- WHY A WRAPPER RATHER THAN FOUR MORE PARAMETERS ON
-- reserve_hardware_job. Editing that function changes its
-- signature again, and the TypeScript layer already carries a
-- legacy fallback for exactly that kind of mid-upgrade break. A
-- wrapper adds the control without touching the thing that
-- already works: an operator who applies this file gets budgets,
-- one who does not keeps today's behaviour exactly. The cost is
-- one more function to keep in step — if reserve_hardware_job's
-- signature changes, THIS CALL BREAKS, and the TypeScript layer
-- degrades to an unbudgeted reservation with a loud log. That is
-- written here so the next person to change that signature knows
-- what else they are changing.
--
-- A REFUSAL WRITES NOTHING. reserve_hardware_job is never reached
-- when the budget refuses, so a refused submission costs the
-- caller neither a dollar of budget nor a job of allowance.
-- ============================================================
drop function if exists public.reserve_hardware_job_within_budget(
  uuid, text, integer, integer, timestamptz, integer, integer, timestamptz);

create function public.reserve_hardware_job_within_budget(
  p_user_id         uuid,
  p_backend         text,
  p_shots           integer,
  p_limit           integer,
  p_period_start    timestamptz,
  p_bonus_threshold integer default null,
  p_bonus_jobs      integer default 0,
  p_year_start      timestamptz default null
)
returns table (
  reserved              boolean,
  used                  integer,
  reservation_id        uuid,
  bonus_jobs            integer,
  bonus_granted         boolean,
  refused_reason        text,
  budget_limit_usd      numeric,
  estimated_spent_usd   numeric,
  estimated_pending_usd numeric,
  unpriced_jobs         integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit_usd numeric;
  v_hard_stop boolean := true;
  -- NULL, not 0, and that is load-bearing. When no budget is configured the
  -- spend aggregate below never runs, and returning 0 for a total nobody
  -- computed would tell the application "this account has spent nothing this
  -- period" — a fabricated measurement, which is the one thing the header
  -- forbids. apps/web/lib/billing/budget.ts reads null as "not totalled".
  v_spent     numeric;
  v_pending   numeric;
  v_unpriced  integer;
begin
  if p_user_id is null or p_period_start is null then
    raise exception 'reserve_hardware_job_within_budget: user and period start are required';
  end if;

  -- Same key as reserve_hardware_job. Held for the rest of this
  -- transaction, which is what makes the check and the insert one
  -- indivisible step.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select b.limit_usd, coalesce(b.hard_stop, true)
    into v_limit_usd, v_hard_stop
    from public.spend_budgets b
   where b.user_id = p_user_id
     and b.scope = 'account';

  -- SELECT ... INTO nulls its targets when it matches no row, so the `:= true`
  -- initialiser on v_hard_stop is gone by here for an account with no budget.
  -- Harmless only because every read of it below is guarded by
  -- `v_limit_usd is not null`, which cannot be true without a row. Restored
  -- explicitly so a later edit that moves one of those reads does not inherit a
  -- NULL that quietly disables a hard stop.
  v_hard_stop := coalesce(v_hard_stop, true);

  -- Priced unconditionally, and OUTSIDE the branch below, because this is the
  -- estimated cost of the submission itself rather than a fact about the
  -- budget: the caller renders it whether or not a ceiling exists. It was
  -- inside the branch, which meant an account with no budget got NULL back for
  -- a perfectly priceable IonQ job — and NULL on this column means "this vendor
  -- has no dollar price", so the application reported a priced device as
  -- unpriceable. One function call on a hit to an immutable price table.
  v_pending := public.estimated_job_cost_usd(p_backend, p_shots);

  -- No budget row, or a row with no dollar ceiling, means no limit. The spend
  -- AGGREGATE stays inside this branch: it scans the window's usage rows, and
  -- an account with no ceiling has nothing to compare the total against. Its
  -- outputs stay NULL for those accounts, meaning "not totalled".
  if v_limit_usd is not null then
    select s.estimated_usd, s.unpriced_jobs
      into v_spent, v_unpriced
      from public.spend_in_window(p_user_id, p_period_start) s;

    -- spend_in_window is an ungrouped aggregate, so it always returns exactly
    -- one row with a coalesced total and this cannot fire today. It is here
    -- because of what happens if it ever can: SELECT ... INTO with no row
    -- leaves v_spent NULL, `NULL > v_limit_usd` evaluates to NULL, the refusal
    -- below is skipped and EVERY submission passes the budget. A fail-open on
    -- the spending path is the one failure this file exists to prevent, so an
    -- untotalled window aborts the transaction instead — the application turns
    -- that into a 503, which is the same answer it gives for any other "the
    -- store could not tell me".
    if v_spent is null then
      raise exception
        'reserve_hardware_job_within_budget: spend_in_window returned no total for %', p_user_id;
    end if;

    -- An unpriceable submission against a real budget is refused,
    -- not waved through. The alternative — treat "no number" as
    -- zero — is how a budget silently stops applying to exactly
    -- the devices nobody has priced yet.
    --
    -- SAY THE CONSEQUENCE OUT LOUD RATHER THAN LETTING A PI FIND
    -- IT: this is not "refused because you are near the ceiling",
    -- it is refused for ANY hard-stop budget at ANY headroom. An
    -- account with a $1,000,000 limit cannot submit to Quantinuum
    -- at all, while an account with no budget can. Setting a
    -- budget therefore REMOVES a device from that account. The
    -- honest fix is a priced Quantinuum (a credit rate per
    -- contract) or an explicit per-budget opt-out column; neither
    -- exists yet, and the surprising behaviour is the safe one in
    -- the meantime.
    if v_pending is null and v_hard_stop then
      return query select false, 0, null::uuid, 0, false,
                          'unpriced'::text, v_limit_usd, v_spent,
                          null::numeric, v_unpriced;
      return;
    end if;

    if v_hard_stop and v_spent + coalesce(v_pending, 0) > v_limit_usd then
      return query select false, 0, null::uuid, 0, false,
                          'budget'::text, v_limit_usd, v_spent,
                          v_pending, v_unpriced;
      return;
    end if;
  end if;

  return query
  select r.reserved,
         r.used,
         r.reservation_id,
         r.bonus_jobs,
         r.bonus_granted,
         case when r.reserved then null::text else 'quota'::text end,
         v_limit_usd,
         v_spent,
         v_pending,
         v_unpriced
    from public.reserve_hardware_job(
           p_user_id, p_backend, p_shots, p_limit, p_period_start,
           p_bonus_threshold, p_bonus_jobs, p_year_start) r;
end;
$$;

comment on function public.reserve_hardware_job_within_budget(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) is
  'Budget check and quota reservation in ONE transaction under ONE per-user advisory lock (the same key reserve_hardware_job uses, so the two cannot interleave). Refuses with refused_reason budget | unpriced | quota, writing nothing. The budget arithmetic is in ESTIMATED USD.';

-- ── Grants ───────────────────────────────────────────────────
-- Identical reasoning to schema-billing.sql, and load-bearing for
-- the same reason: these functions are SECURITY DEFINER, so an
-- ordinary caller who could execute them could price — and in the
-- wrapper's case SPEND — against a stranger's uuid. p_limit is
-- still an argument. service_role only: the key that lives on the
-- server and never reaches a browser.
revoke all on function public.spend_in_window(uuid, timestamptz) from public;
revoke all on function public.spend_in_window(uuid, timestamptz) from anon;
revoke all on function public.spend_in_window(uuid, timestamptz) from authenticated;
grant execute on function public.spend_in_window(uuid, timestamptz) to service_role;

revoke all on function public.spend_budget_snapshot(uuid, timestamptz, text, integer) from public;
revoke all on function public.spend_budget_snapshot(uuid, timestamptz, text, integer) from anon;
revoke all on function public.spend_budget_snapshot(uuid, timestamptz, text, integer) from authenticated;
grant execute on function public.spend_budget_snapshot(uuid, timestamptz, text, integer) to service_role;

revoke all on function public.claim_spend_warning(uuid, timestamptz) from public;
revoke all on function public.claim_spend_warning(uuid, timestamptz) from anon;
revoke all on function public.claim_spend_warning(uuid, timestamptz) from authenticated;
grant execute on function public.claim_spend_warning(uuid, timestamptz) to service_role;

revoke all on function public.reserve_hardware_job_within_budget(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from public;
revoke all on function public.reserve_hardware_job_within_budget(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from anon;
revoke all on function public.reserve_hardware_job_within_budget(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) from authenticated;
grant execute on function public.reserve_hardware_job_within_budget(uuid, text, integer, integer, timestamptz, integer, integer, timestamptz) to service_role;

-- estimated_job_cost_usd is NOT security definer and touches no
-- table, so leaving it executable by users would leak nothing but
-- a published price list. It is revoked anyway, so the price
-- mirror has exactly one consumer and a future correction to it
-- cannot quietly change something a client is rendering.
revoke all on function public.estimated_job_cost_usd(text, integer) from public;
revoke all on function public.estimated_job_cost_usd(text, integer) from anon;
revoke all on function public.estimated_job_cost_usd(text, integer) from authenticated;
grant execute on function public.estimated_job_cost_usd(text, integer) to service_role;

-- ============================================================
-- VERIFICATION — run these BY HAND after applying this file.
--
-- WHAT HAS NOT BEEN OBSERVED. Unlike schema-billing.sql's
-- verification block, NONE of the queries below have been run
-- against a live server by the author of this file: there was no
-- Postgres to hand in this environment. They are written to be
-- runnable, not reported as passing. Treat the whole block as
-- unverified until somebody runs it and says otherwise.
--
-- 1. The grants (the one that stops a signed-in user spending
--    against a stranger's uuid):
--
--      select has_function_privilege('authenticated',
--        'public.reserve_hardware_job_within_budget(uuid,text,integer,integer,timestamptz,integer,integer,timestamptz)',
--        'execute') as authenticated_can_execute;
--      -- MUST be false.
--
-- 2. The price mirror agrees with the API. For each backend id,
--    compare against POST /api/hardware/estimate at the same
--    shots:
--
--      select b, public.estimated_job_cost_usd(b, 1000)
--        from unnest(array['ibm_brisbane','ionq_aria','ionq_forte',
--                          'rigetti_ankaa','azure_ionq_aria',
--                          'aer_simulator','azure_quantinuum_h1',
--                          'not_a_backend']) b;
--      -- expect 0, 0.33, 0.33, 0.65, 0.33, 0, NULL, NULL.
--      -- A NULL for anything the device picker offers as a PAID
--      -- device means budgets refuse that device: add it here.
--
-- 3. The budget is actually atomic — the point of the file.
--    Two sessions, a $1.00 budget, and an IonQ job of 11,000
--    shots that estimates at $0.63, so exactly one fits.
--
--      insert into public.spend_budgets (user_id, limit_usd)
--        values ('<uuid>', 1.00);
--
--    Session A:
--      begin;
--      select reserved, refused_reason, estimated_spent_usd
--        from public.reserve_hardware_job_within_budget(
--          '<uuid>', 'ionq_aria', 11000, 999, now() - interval '1 day');
--      -- reserved = t. DO NOT COMMIT YET.
--
--    Session B, while A is still open:
--      select reserved, refused_reason
--        from public.reserve_hardware_job_within_budget(
--          '<uuid>', 'ionq_aria', 11000, 999, now() - interval '1 day');
--      -- MUST BLOCK on A's advisory lock. If it returns
--      -- reserved = t immediately, the lock is not doing its job
--      -- and two students can each spend the last of the grant.
--
--    Commit A: B unblocks and returns reserved = f,
--    refused_reason = 'budget'. Clean up:
--      delete from public.hardware_usage where user_id = '<uuid>';
--      delete from public.spend_budgets  where user_id = '<uuid>';
--
-- 3b. An account with NO budget gets a real pending price and a
--    NULL spend — "we did not total it", never "$0.00 spent".
--    The application distinguishes those two and a 0 here would
--    make it publish a measurement nobody took:
--
--      select reserved, estimated_spent_usd, estimated_pending_usd,
--             unpriced_jobs
--        from public.reserve_hardware_job_within_budget(
--          '<uuid with no spend_budgets row>', 'ionq_aria', 1000,
--          999, now() - interval '1 day');
--      -- expect reserved = t, estimated_spent_usd NULL,
--      --        unpriced_jobs NULL, estimated_pending_usd 0.33.
--      -- A pending of NULL here would mean the application
--      -- reports a priceable IonQ job as unpriceable.
--
-- 4. A refusal writes nothing:
--
--      select count(*) from public.hardware_usage
--       where user_id = '<uuid>';
--      -- unchanged across a refused call.
--
-- 5. The warning latch fires once:
--
--      select public.claim_spend_warning('<budget uuid>',
--               date_trunc('month', now()));
--      -- t, then f, then f. And for the next window:
--      select public.claim_spend_warning('<budget uuid>',
--               date_trunc('month', now()) + interval '1 month');
--      -- t again.
--
-- 6. Unpriced devices are visible rather than free. After
--    submitting to azure_quantinuum_h1:
--
--      select estimated_usd, unpriced_jobs, jobs
--        from public.spend_in_window('<uuid>', now() - interval '30 days');
--      -- unpriced_jobs > 0 means estimated_usd UNDERSTATES the
--      -- real spend by whatever Quantinuum charged in credits.
--      -- Surface that number next to the total; never show the
--      -- total on its own.
--
-- 7. Budgets are not self-service. As a signed-in user (not the
--    service role):
--
--      update public.spend_budgets set limit_usd = 100000;
--      -- expect UPDATE 0 — RLS with no update policy matches no
--      -- rows rather than erroring, so check the count, do not
--      -- check for an exception.
-- ============================================================
