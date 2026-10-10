-- ============================================================
-- Did the migrations actually land? One paste, one answer.
--
-- Run this in the Supabase SQL editor after applying
-- supabase/apply-all-migrations.sql. Every row should read 'OK'.
-- Anything reading 'MISSING' names the file to re-run.
--
-- Read-only: this creates nothing and changes nothing.
-- ============================================================

with expected(kind, name, detail, source_file) as (values
  -- Tables the five previously-503 features depend on.
  ('table',  'api_keys',                  'programmatic access',        'schema-integrations.sql'),
  ('table',  'runtime_sessions',          'session ownership',          'schema-sessions.sql'),
  ('table',  'published_runs',            'citable run permalinks',     'schema-runs.sql'),
  ('table',  'spend_budgets',             'spend caps',                 'schema-budgets.sql'),
  ('table',  'hardware_usage',            'job history',                'schema-billing.sql'),
  -- BYOK.
  ('table',  'user_provider_credentials', 'BYOK credential storage',    'schema-byok.sql'),
  ('column', 'hardware_usage.credential_owner',
                                          'BYOK quota exemption',       'schema-byok.sql'),
  -- Functions the billing path calls by name.
  ('function', 'reserve_hardware_job',              'atomic quota reservation', 'schema-billing.sql'),
  ('function', 'reserve_hardware_job_within_budget','quota + budget in one txn','schema-budgets.sql'),
  ('function', 'spend_in_window',                   'estimated spend',          'schema-budgets.sql'),
  ('function', 'estimated_job_cost_usd',            'per-job price model',      'schema-budgets.sql'),
  -- Audit 2026-09-29 (sign-in / signed-in usability).
  ('table',    'user_progress',                     'progress follows account', 'schema-hardening.sql'),
  ('function', 'org_members_inherit_plan',          'seat plan cannot be forged','schema-hardening.sql'),
  ('function', 'orgs_lock_licence_columns',         'licence columns immutable','schema-hardening.sql')
)
select
  e.kind,
  e.name,
  e.detail,
  case
    when e.kind = 'table' then
      case when to_regclass('public.' || e.name) is not null then 'OK' else 'MISSING' end
    when e.kind = 'column' then
      case when exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name  = split_part(e.name, '.', 1)
           and column_name = split_part(e.name, '.', 2)
      ) then 'OK' else 'MISSING' end
    else
      case when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = e.name
      ) then 'OK' else 'MISSING' end
  end as status,
  e.source_file
from expected e
order by status desc, e.kind, e.name;

-- ============================================================
-- THE ONE THAT IS EASY TO GET WRONG
--
-- schema-byok.sql REPLACES reserve_hardware_job and
-- spend_in_window with copies carrying one extra clause each
-- (`and credential_owner = 'operator'`). If migration 14 ran
-- before 02/13, or errored partway, the table and column can all
-- exist while the FUNCTIONS are still the un-patched versions —
-- in which case BYOK jobs are recorded correctly and then
-- counted against the monthly allowance anyway, silently.
--
-- Both rows below must read true.
-- ============================================================
select
  p.proname                                   as function_name,
  p.prosrc like '%credential_owner%'          as byok_exclusion_applied
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('reserve_hardware_job', 'spend_in_window')
order by p.proname;

-- ============================================================
-- RLS sanity on the credential table.
--
-- Must be true with ZERO policies: RLS on and no policy means
-- anon and authenticated can do nothing, and the service role
-- (which bypasses RLS) is the only way in. A policy appearing
-- here is a regression — a row in this table holds a decryptable
-- vendor credential.
-- ============================================================
select
  c.relrowsecurity                      as rls_enabled,
  count(pol.polname)                    as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy pol on pol.polrelid = c.oid
where n.nspname = 'public' and c.relname = 'user_provider_credentials'
group by c.relrowsecurity;

-- ============================================================
-- Hardening (schema-hardening.sql): the browser must NOT be able
-- to insert circuits directly (POST /api/circuits enforces the
-- plan limit). Must return zero rows.
-- ============================================================
select pol.polname as should_not_exist
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'circuits' and pol.polname = 'circuits_insert_own';
