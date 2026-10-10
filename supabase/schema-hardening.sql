-- ─────────────────────────────────────────────────────────────────────────────
-- schema-hardening.sql — audit 2026-09-29: sign-in and signed-in usability.
--
-- Three parts, all idempotent, all run AFTER every other schema file:
--   A. An org seat must be paid for (finding ORG-3).
--   B. Saved circuits are inserted by the server, where the plan limit is
--      enforced (Free: 10). The browser may still read/rename/delete its own.
--   C. public.user_progress — course progress that follows the account.
--
-- APPLY ORDER: deploy the web app first, then run this. The new app works
-- before it is applied (it saves circuits via the service role, and progress
-- sync fails soft without the table); the old app would lose cloud saves
-- after part B.
--
-- ═════════════════════════════ A. ORG INTEGRITY ═════════════════════════════
--
-- THE HOLE (audit 2026-09-29, finding ORG-3):
--   · `orgs_insert_owner` checked only `owner_id = auth.uid()`, so ANY signed-in
--     user could insert an org with `plan_id = 'edu'` and `seats_total = null`
--     straight from the browser with the anon key;
--   · `org_members_insert_manager` then let that owner insert their own seat
--     with any `plan_id` / `status`;
--   · lib/billing/entitlements.ts honours an active `org_members` row as the
--     user's plan. Result: a Free account on University, for nothing. The
--     /admin "Preview with demo data" button reached the real write path, so it
--     did not even need devtools.
--   · `orgs_update_manager` also let an owner rewrite `plan_id` / `seats_total`
--     on an org they legitimately held (Team → unlimited University seats).
--
-- THE RULE, enforced here because the browser writes these tables directly:
--   1. Creating an org requires the caller's OWN active subscription to the
--      same plan (team or edu). A seat in someone else's org does not count.
--   2. A Team org gets exactly the Team seat count (10); only University is
--      unlimited. Matches lib/plans.ts `limits.seats`.
--   3. `plan_id`, `seats_total` and `owner_id` on an org are fixed for user
--      roles — changing a licence is a billing/support action (service role).
--   4. A seat's `plan_id` is always copied from its org; it cannot be forged.
--
-- The service role and the SQL editor (no JWT role) are unaffected, so support
-- and the webhook keep working. Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 + 2: creation needs a matching paid subscription and the plan's seat count.
drop policy if exists orgs_insert_owner on public.orgs;
create policy orgs_insert_owner
  on public.orgs for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
        from public.subscriptions s
       where s.user_id = auth.uid()
         and s.plan_id = orgs.plan_id
         and s.status in ('active', 'trialing', 'past_due')
    )
    and (
      (orgs.plan_id = 'team' and orgs.seats_total = 10)
      or (orgs.plan_id = 'edu')
    )
  );

-- 3: licence columns are immutable for signed-in users.
create or replace function public.orgs_lock_licence_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if new.plan_id     is distinct from old.plan_id
    or new.seats_total is distinct from old.seats_total
    or new.owner_id    is distinct from old.owner_id then
      raise exception 'plan_id, seats_total and owner_id can only be changed by support'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_lock_licence_columns on public.orgs;
create trigger orgs_lock_licence_columns
  before update on public.orgs
  for each row execute function public.orgs_lock_licence_columns();

-- 4: a seat inherits its org's plan, whatever the client sent.
-- SECURITY DEFINER so it can read the org even when the writer's RLS view of
-- `orgs` would not show it; it only ever reads, and only the one row.
create or replace function public.org_members_inherit_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_plan text;
begin
  select o.plan_id into org_plan from public.orgs o where o.id = new.org_id;
  if org_plan is null then
    raise exception 'organisation % does not exist', new.org_id using errcode = '23503';
  end if;
  new.plan_id := org_plan;
  return new;
end;
$$;

revoke all on function public.org_members_inherit_plan() from public, anon, authenticated;

drop trigger if exists org_members_inherit_plan on public.org_members;
create trigger org_members_inherit_plan
  before insert or update of plan_id, org_id on public.org_members
  for each row execute function public.org_members_inherit_plan();

-- ─────────────────────────────────────────────────────────────────────────────
-- After applying, look for orgs created through the hole (read-only):
--
--   select o.id, o.name, o.plan_id, o.seats_total, o.owner_id, o.created_at
--     from public.orgs o
--    where not exists (
--            select 1 from public.subscriptions s
--             where s.user_id = o.owner_id and s.plan_id = o.plan_id
--               and s.status in ('active', 'trialing', 'past_due'))
--    order by o.created_at desc;
--
-- Review each row before acting: a University licence set up by hand by
-- support will also appear here if no subscription row was written for it.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════ B. CIRCUIT INSERTS VIA SERVER ═══════════════════════
--
-- The saved-circuit limit depends on the plan, and the plan can depend on the
-- launch trial (an environment setting only the app knows), so it is enforced
-- in POST /api/circuits, which writes with the service role. A direct client
-- insert would bypass it, so the insert policy is removed; with RLS on and no
-- insert policy, `authenticated` cannot insert. Select/update/delete own-row
-- policies are unchanged.
drop policy if exists circuits_insert_own on public.circuits;


-- ═════════════════════════ C. PROGRESS FOLLOWS THE ACCOUNT ═══════════════════
--
-- One row per user: the same JSON shape lib/lessons/progress.ts keeps in
-- localStorage ({ completed: string[], quizScores: {slug: number},
-- lastVisited?: string }). Written by the browser (lib/lessons/progressSync.ts)
-- under own-row RLS — it is the user's own learning record, nothing is gated
-- on it, so there is nothing to protect it from its owner.
create table if not exists public.user_progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  progress   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_progress_size check (octet_length(progress::text) <= 65536)
);

comment on table public.user_progress is
  'Course progress per account (completed lessons, quiz scores). Merged with the browser copy on sign-in by lib/lessons/progressSync.ts.';

alter table public.user_progress enable row level security;

drop policy if exists user_progress_select_own on public.user_progress;
create policy user_progress_select_own
  on public.user_progress for select
  using (auth.uid() = user_id);

drop policy if exists user_progress_insert_own on public.user_progress;
create policy user_progress_insert_own
  on public.user_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists user_progress_update_own on public.user_progress;
create policy user_progress_update_own
  on public.user_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ═════════════════ D. LEADERBOARD VIEW: STOP READING PAST RLS ═════════════════
--
-- Supabase's security advisor flags public.competition_leaderboard as a
-- SECURITY DEFINER view (it runs with its owner's rights, bypassing the RLS on
-- competition_entries). schema-competitions.sql made that deliberate so `anon`
-- could read it — but nothing in the app does: lib/compete/store.ts reads the
-- table with the service role, and GET /api/compete serves the leaderboard.
-- So the only effect of the definer view is that anyone holding the public
-- anon key can read it directly. Run it as the CALLER instead (RLS applies; the
-- table has no policy, so the view returns nothing to anon) and withdraw the
-- public grant. The service role is unaffected. This runs after
-- schema-competitions.sql, so a full re-run ends in this state.
alter view public.competition_leaderboard set (security_invoker = true);
revoke select on public.competition_leaderboard from anon, authenticated;
