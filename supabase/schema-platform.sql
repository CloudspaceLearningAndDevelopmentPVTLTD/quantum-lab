-- ============================================================
-- Quantum Lab — platform settings (admin-configurable runtime config)
--
-- Run this in the Supabase SQL editor AFTER schema.sql, or apply via
-- `supabase db push` (scripts/supabase-migrations.sh regenerates the
-- migration from this file).
--
-- One row per setting key, JSON value. Today the only key is `llm`:
-- the LLM gateway configuration a platform admin edits at
-- /admin/platform — provider API keys, routing order, forced provider,
-- and the per-tier access policy (anonymous / free / trial / paid).
-- Env vars remain the base layer; a row here overrides them without
-- a redeploy. See docs/LLM-GATEWAY.md, "Runtime configuration".
--
-- ############################################################
-- #  SERVICE ROLE ONLY. RLS is enabled and NO POLICY exists.  #
-- #                                                          #
-- #  The `llm` value carries provider API keys (encrypted    #
-- #  with AES-256-GCM before they get here — see             #
-- #  apps/web/lib/platform/settings.ts — but ciphertext is   #
-- #  still not something a signed-in learner should be able  #
-- #  to read or, worse, replace). Only the route handlers in #
-- #  apps/web/app/api/platform/, which verify the caller     #
-- #  against PLATFORM_ADMIN_EMAILS, touch this table.        #
-- ############################################################
-- ============================================================

create table if not exists public.platform_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  value       jsonb not null default '{}'::jsonb,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  -- Verified email of the admin who last saved. Audit trail, not authz.
  updated_by  text check (updated_by is null or char_length(updated_by) <= 254)
);

alter table public.platform_settings enable row level security;

comment on table public.platform_settings is
  'Admin-editable runtime configuration (one JSON value per key). Service role only: no RLS policy on purpose. `llm` holds the tutor gateway config with API keys encrypted at the application layer.';
comment on column public.platform_settings.version is
  'Bumped on every save; the admin UI sends the version it loaded so two admins cannot silently overwrite each other.';
