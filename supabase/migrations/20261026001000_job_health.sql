-- Engapp v0.4 İP10: job health (docs/decisions/0037-maintenance-jobs.md).
--
--   job_runs   one row per nightly job (levels, images): when it last ran, how it ended and
--              when it last ended well. Written at the end of every run by job_heartbeat; read
--              by the jobs themselves (job_health) to warn about a job that stopped running.
--
-- Server only: service role. No user data (details hold counters only).

create table public.job_runs (
  job text primary key check (job ~ '^[a-z][a-z0-9_-]{0,39}$'),
  status text not null check (status in ('ok', 'partial', 'failed', 'skipped')),
  last_run_at timestamptz not null default now(),
  last_ok_at timestamptz,
  runs integer not null default 0 check (runs >= 0),
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4000)
);

alter table public.job_runs enable row level security;
revoke all on table public.job_runs from anon, authenticated;
-- No policies: the functions below (service role) only.

-- Stores a run's end. 'ok' and 'partial' (stopped by the budget, an AI step failed but the
-- deterministic part ran) count as a good run; 'failed' and 'skipped' do not.
create or replace function public.job_heartbeat(p_job text, p_status text, p_details jsonb default '{}'::jsonb)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.job_runs as r (job, status, last_run_at, last_ok_at, runs, details)
  values (
    p_job, p_status, now(),
    case when p_status in ('ok', 'partial') then now() end,
    1, coalesce(p_details, '{}'::jsonb))
  on conflict (job) do update set
    status = excluded.status,
    last_run_at = excluded.last_run_at,
    last_ok_at = coalesce(excluded.last_ok_at, r.last_ok_at),
    runs = r.runs + 1,
    details = excluded.details
$$;

-- [{job, status, last_run_at, last_ok_at, runs, details}]
create or replace function public.job_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.job), '[]'::jsonb) from public.job_runs r
$$;

revoke all on function public.job_heartbeat(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.job_heartbeat(text, text, jsonb) to service_role;
revoke all on function public.job_health() from public, anon, authenticated;
grant execute on function public.job_health() to service_role;
grant select, insert, update on table public.job_runs to service_role;
