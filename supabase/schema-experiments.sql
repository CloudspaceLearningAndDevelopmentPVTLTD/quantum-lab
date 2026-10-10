-- ============================================================
-- Qubit16 — workbench experiments (the agent lab notebook)
--
-- Run this in the Supabase SQL editor AFTER schema.sql, or apply via
-- `supabase db push` (scripts/supabase-migrations.sh regenerates the
-- migration from this file).
--
-- An experiment is a record an MCP agent writes and a human reads: a
-- hypothesis, an append-only list of steps (circuit + target + result +
-- note), and a conclusion. See apps/web/lib/workbench/experiments.ts for
-- the TypeScript shape these rows map to, and docs/MCP.md for the tools.
--
-- The app works with NO Supabase at all: without a service-role key the
-- store is an in-process map. These tables are the durable option.
--
-- ############################################################
-- #  SERVICE ROLE ONLY. RLS is enabled and NO POLICY exists.  #
-- #                                                          #
-- #  The MCP endpoint that writes here is unauthenticated    #
-- #  by design (writing a notebook entry spends no money),   #
-- #  so a browser-side policy would make every visitor a     #
-- #  writer. Reads and writes go through the route handlers  #
-- #  in apps/web/app/api/workbench/experiments and the MCP   #
-- #  tools, which use the service-role client and apply      #
-- #  the rate limits and size bounds themselves.             #
-- #                                                          #
-- #  `owner` is attribution, not access control: it holds   #
-- #  the verified caller id when the creating request had a  #
-- #  bearer token, and every record on a deployment is       #
-- #  readable by everyone who can reach the page.            #
-- ############################################################
-- ============================================================

create table if not exists public.experiments (
  id            uuid primary key,
  title         text not null check (char_length(title) between 1 and 200),
  hypothesis    text not null check (char_length(hypothesis) between 1 and 4000),
  conclusion    text check (conclusion is null or char_length(conclusion) <= 8000),
  created_at    timestamptz not null default now(),
  concluded_at  timestamptz,
  owner         uuid
);

create index if not exists experiments_created_at_idx
  on public.experiments (created_at desc);

create table if not exists public.experiment_steps (
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  position      integer not null check (position >= 0),
  created_at    timestamptz not null default now(),
  qasm          text not null check (char_length(qasm) between 1 and 20000),
  -- { kind: 'simulator' } | { kind: 'noisy-simulator', noise: {...} } |
  -- { kind: 'hardware', backend, provider? } — lib/workbench/targets.ts
  target        jsonb not null,
  shots         integer not null check (shots between 1 and 20000),
  seed          bigint,
  -- { kind: 'counts', counts, ... } | { kind: 'hardware-job', job, ... }
  result        jsonb not null,
  note          text not null default '' check (char_length(note) <= 2000),
  primary key (experiment_id, position)
);

alter table public.experiments enable row level security;
alter table public.experiment_steps enable row level security;

comment on table public.experiments is
  'Agent lab-notebook records written over MCP (create_experiment / run_step / conclude_experiment). Service role only: no RLS policy on purpose.';
comment on table public.experiment_steps is
  'Append-only steps of an experiment. `position` is assigned by append_experiment_step under a row lock on the parent.';
comment on column public.experiments.owner is
  'Verified caller id when the creating MCP request carried a bearer token; null otherwise. Attribution, not authorisation.';

-- The list view: one row per experiment with its step count, so the index
-- page does not fetch every step of every record.
create or replace view public.experiment_summaries
  with (security_invoker = true) as
  select e.id, e.title, e.hypothesis, e.conclusion, e.created_at, e.concluded_at, e.owner,
         (select count(*) from public.experiment_steps s where s.experiment_id = e.id) as step_count
    from public.experiments e;

-- Append one step atomically. Locks the parent row, refuses a concluded
-- record and one at the step ceiling, and assigns the next position — the
-- three checks two concurrent agents would otherwise race on.
create or replace function public.append_experiment_step(
  p_experiment_id uuid,
  p_qasm          text,
  p_target        jsonb,
  p_shots         integer,
  p_seed          bigint,
  p_result        jsonb,
  p_note          text,
  p_max_steps     integer default 200
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conclusion text;
  v_next       integer;
begin
  select conclusion into v_conclusion
    from public.experiments
   where id = p_experiment_id
   for update;
  if not found then
    raise exception 'experiment not found';
  end if;
  if v_conclusion is not null then
    raise exception 'experiment is concluded; create a new experiment to keep running';
  end if;

  select coalesce(max(position) + 1, 0) into v_next
    from public.experiment_steps
   where experiment_id = p_experiment_id;
  if v_next >= p_max_steps then
    raise exception 'experiment already holds % steps, the ceiling', p_max_steps;
  end if;

  insert into public.experiment_steps
    (experiment_id, position, qasm, target, shots, seed, result, note)
  values
    (p_experiment_id, v_next, p_qasm, p_target, p_shots, p_seed, p_result, coalesce(p_note, ''));

  return v_next;
end;
$$;

-- Only the service role may call it: the function is security definer, so
-- an anon caller would otherwise write through it.
revoke all on function public.append_experiment_step(uuid, text, jsonb, integer, bigint, jsonb, text, integer) from public;
revoke all on function public.append_experiment_step(uuid, text, jsonb, integer, bigint, jsonb, text, integer) from anon;
revoke all on function public.append_experiment_step(uuid, text, jsonb, integer, bigint, jsonb, text, integer) from authenticated;
grant execute on function public.append_experiment_step(uuid, text, jsonb, integer, bigint, jsonb, text, integer) to service_role;
