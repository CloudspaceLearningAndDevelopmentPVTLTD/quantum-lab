-- ============================================================
-- Quantum Lab — saved circuits schema
--
-- Run this once in the Supabase SQL editor (see README.md in this
-- folder). Everything here is OPTIONAL: with no Supabase project the
-- app stores circuits in browser localStorage instead.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────
-- One row per saved circuit. The circuit itself is stored as
-- OpenQASM text so rows stay portable and human-readable.
create table if not exists public.circuits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text,
  qasm        text not null,
  num_qubits  integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_public   boolean not null default false
);

-- ── Indexes ──────────────────────────────────────────────────
-- The library page lists a user's circuits newest-first.
create index if not exists circuits_user_updated_idx
  on public.circuits (user_id, updated_at desc);

-- Partial index: only published circuits are ever browsed publicly,
-- so we index just those rows.
create index if not exists circuits_public_idx
  on public.circuits (updated_at desc)
  where is_public;

-- ── Row level security ───────────────────────────────────────
-- Nothing is readable or writable until a policy allows it.
alter table public.circuits enable row level security;

-- Read your own circuits.
drop policy if exists circuits_select_own on public.circuits;
create policy circuits_select_own
  on public.circuits for select
  using (auth.uid() = user_id);

-- Anyone (including anonymous visitors) may read circuits marked public.
drop policy if exists circuits_select_public on public.circuits;
create policy circuits_select_public
  on public.circuits for select
  using (is_public);

-- You may only insert rows that belong to you.
drop policy if exists circuits_insert_own on public.circuits;
create policy circuits_insert_own
  on public.circuits for insert
  with check (auth.uid() = user_id);

-- You may only update your own rows, and may not reassign them.
drop policy if exists circuits_update_own on public.circuits;
create policy circuits_update_own
  on public.circuits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- You may only delete your own rows.
drop policy if exists circuits_delete_own on public.circuits;
create policy circuits_delete_own
  on public.circuits for delete
  using (auth.uid() = user_id);

-- ── updated_at maintenance ───────────────────────────────────
-- Keep updated_at honest regardless of what the client sends.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists circuits_set_updated_at on public.circuits;
create trigger circuits_set_updated_at
  before update on public.circuits
  for each row
  execute function public.set_updated_at();
