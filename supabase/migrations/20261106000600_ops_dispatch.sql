-- Engapp v0.5.3 (decision 0076, D3): the nightly GitHub jobs are started on time by the
-- database's own clock instead of GitHub's scheduler, which starts them about 7 hours late,
-- drops runs and switches schedules off after 60 days without commits.
--
--   pg_cron (exact time) → public.ops_dispatch(workflow, inputs) → pg_net POST
--   https://api.github.com/repos/<repo>/actions/workflows/<file>/dispatches
--
-- The GitHub token is a fine-grained personal access token with only "Actions: read and
-- write" on this one repository. It lives in Supabase Vault (encrypted at rest), written by
-- the deploy workflow from the repository secret GH_DISPATCH_TOKEN
-- (public.ops_dispatch_set_token); it never leaves the database except in that request.
-- Without a token every tick only records 'no_token' and GitHub's own schedule (kept in
-- every workflow as a backstop) still runs the jobs, late. The workflows skip a backstop run
-- when the dispatched run already finished well (scripts/ci-gate.ts), so nothing runs twice.
--
-- pg_net answers asynchronously: the request id is kept in ops_dispatch_log and the answer
-- (net._http_response, kept by pg_net for about 6 hours) is copied on the next tick. The
-- nightly health check (ops_health_reliability, 20261106000620) reports refused dispatches.
--
-- No user data. Nothing here is callable by clients or by service_role: pg_cron and the
-- deploy workflow run as the owner.

-- ---------------------------------------------------------------------------
-- configuration and log
-- ---------------------------------------------------------------------------

create table public.ops_dispatch_config (
  id boolean primary key default true check (id),
  repo text not null default 'hsniscan/engapp' check (repo ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  ref text not null default 'main' check (ref ~ '^[A-Za-z0-9_./-]{1,100}$'),
  -- Name of the Vault secret that holds the token.
  secret_name text not null default 'engapp_github_dispatch'
);
insert into public.ops_dispatch_config default values on conflict do nothing;

create table public.ops_dispatch_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  workflow text not null check (workflow ~ '^[a-z0-9][a-z0-9-]{0,60}\.yml$'),
  request_id bigint,
  -- sent: waiting for pg_net's answer; ok: GitHub accepted (204); http_error / net_error:
  -- refused or unreachable; unknown: pg_net dropped the answer; no_token / no_pg_net: not sent.
  outcome text not null check (outcome in ('sent', 'ok', 'http_error', 'net_error', 'unknown', 'no_token', 'no_pg_net')),
  status_code integer,
  error text check (error is null or char_length(error) <= 200)
);
create index ops_dispatch_log_at on public.ops_dispatch_log (at);

alter table public.ops_dispatch_config enable row level security;
alter table public.ops_dispatch_log enable row level security;
revoke all on table public.ops_dispatch_config from anon, authenticated, service_role;
revoke all on table public.ops_dispatch_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- token (Supabase Vault)
-- ---------------------------------------------------------------------------

-- Called by .github/workflows/deploy-supabase.yml (psql as the owner) with the repository
-- secret GH_DISPATCH_TOKEN. Idempotent: creates or replaces the Vault secret.
create or replace function public.ops_dispatch_set_token(p_token text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
begin
  if p_token is null or p_token !~ '^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$' then
    raise exception 'not a GitHub token' using errcode = '22023';
  end if;
  if pg_catalog.to_regclass('vault.secrets') is null then
    raise notice 'Supabase Vault is not available: the GitHub jobs keep GitHub''s own (late) schedule';
    return 'no_vault';
  end if;
  select secret_name into v_name from public.ops_dispatch_config;
  execute 'select id from vault.secrets where name = $1' into v_id using v_name;
  if v_id is null then
    execute 'select vault.create_secret($1, $2, $3)' using p_token, v_name,
      'GitHub fine-grained token, Actions read/write on the engapp repository only (decision 0076)';
    return 'created';
  end if;
  execute 'select vault.update_secret($1, $2)' using v_id, p_token;
  return 'updated';
end;
$$;

create or replace function public.ops_github_token()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = (select secret_name from public.ops_dispatch_config)'
    into v_token;
  return nullif(v_token, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- dispatch
-- ---------------------------------------------------------------------------

-- Copies pg_net's answers into ops_dispatch_log. Answers older than about 6 hours are gone
-- (pg_net's own clean-up), so a request still 'sent' after 7 hours becomes 'unknown'.
create or replace function public.ops_dispatch_collect()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if pg_catalog.to_regclass('net._http_response') is not null then
    execute $q$
      update public.ops_dispatch_log l set
        status_code = r.status_code,
        outcome = case
          when r.status_code between 200 and 299 then 'ok'
          when r.status_code is null then 'net_error'
          else 'http_error' end,
        error = case when r.status_code between 200 and 299 then null
          else left(regexp_replace(coalesce(r.error_msg, r.content::text, ''), '\s+', ' ', 'g'), 200) end
      from net._http_response r
      where r.id = l.request_id and l.outcome = 'sent'
    $q$;
    get diagnostics v_n = row_count;
  end if;
  update public.ops_dispatch_log set outcome = 'unknown'
  where outcome = 'sent' and at < now() - interval '7 hours';
  return v_n;
end;
$$;

-- Starts one GitHub workflow now. p_inputs: the workflow_dispatch inputs (strings);
-- trigger=cron is added, so the run is recognised as the scheduled one (scripts/ci-gate.ts).
create or replace function public.ops_dispatch(p_workflow text, p_inputs jsonb default '{}'::jsonb)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg public.ops_dispatch_config;
  v_token text;
  v_id bigint;
begin
  if p_workflow is null or p_workflow !~ '^[a-z0-9][a-z0-9-]{0,60}\.yml$' then
    raise exception 'bad workflow file name' using errcode = '22023';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'object' then
    raise exception 'inputs must be an object' using errcode = '22023';
  end if;
  perform public.ops_dispatch_collect();
  delete from public.ops_dispatch_log where at < now() - interval '14 days';

  v_token := public.ops_github_token();
  if v_token is null then
    insert into public.ops_dispatch_log (workflow, outcome) values (p_workflow, 'no_token');
    return 'no_token';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    insert into public.ops_dispatch_log (workflow, outcome) values (p_workflow, 'no_pg_net');
    return 'no_pg_net';
  end if;
  select * into v_cfg from public.ops_dispatch_config;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
    into v_id
    using 'https://api.github.com/repos/' || v_cfg.repo || '/actions/workflows/' || p_workflow || '/dispatches',
      jsonb_build_object('ref', v_cfg.ref, 'inputs', p_inputs || '{"trigger": "cron"}'::jsonb),
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'engapp-pg-cron',
        'Content-Type', 'application/json');
  insert into public.ops_dispatch_log (workflow, request_id, outcome) values (p_workflow, v_id, 'sent');
  return 'sent';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'ops_dispatch_set_token(text)', 'ops_github_token()', 'ops_dispatch_collect()', 'ops_dispatch(text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- the schedule (UTC). Same times as the workflows' own cron lines, which stay as backstops.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_net is not available: the GitHub jobs keep GitHub''s own schedule';
  else
    create extension if not exists pg_net;
  end if;
exception when others then
  raise notice 'could not enable pg_net (%): the GitHub jobs keep GitHub''s own schedule', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Pictures: the nightly batch, then collect a finished batch every two hours.
    perform cron.schedule('engapp-gh-images-nightly', '30 1 * * *',
      $c$select public.ops_dispatch('images.yml', '{"job": "nightly"}')$c$);
    perform cron.schedule('engapp-gh-images-collect', '45 2-12/2 * * *',
      $c$select public.ops_dispatch('images.yml', '{"job": "collect"}')$c$);
    -- Graded library (collect; submit only with GRADED_BULK=true) and the level job, after
    -- the day's budget resets at 00:00 UTC.
    perform cron.schedule('engapp-gh-graded', '15 2 * * *',
      $c$select public.ops_dispatch('graded.yml', '{"job": "nightly"}')$c$);
    perform cron.schedule('engapp-gh-levels', '30 2 * * *',
      $c$select public.ops_dispatch('level-jobs.yml')$c$);
    -- The backup, before the purge jobs at 03:17-03:33.
    perform cron.schedule('engapp-gh-backup', '45 2 * * *',
      $c$select public.ops_dispatch('db-backup.yml')$c$);
    -- Health check (the dead man's switch for the backup) at 06:30 UTC = 09:30 in Türkiye.
    perform cron.schedule('engapp-gh-ops-health', '30 6 * * *',
      $c$select public.ops_dispatch('ops-health.yml')$c$);
  else
    raise notice 'pg_cron is not available: the GitHub jobs keep GitHub''s own schedule';
  end if;
exception when others then
  raise notice 'could not schedule the GitHub jobs with pg_cron (%)', sqlerrm;
end;
$$;
