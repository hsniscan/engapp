-- Engapp v0.5.3 (decision 0076, D3 + D4): more rows for the nightly health check. Read by
-- scripts/ops-health.sh next to ops_health() (20261103000400), in the ops-health workflow
-- that pg_cron starts at 06:30 UTC. A 'fail' row fails that run, and GitHub e-mails the owner.
--
--   backup_age         the dead man's switch: no good nightly backup for more than 26 hours
--   gh_dispatch        pg_cron's GitHub dispatches of the last day; a refused token fails
--   client_errors_24h  errors users hit (client_errors, 20261106000610), the top three by
--                      code label and fingerprint
--   fn_errors_24h      edge-function failures (ops_events kind fn_error), top function/code
--   ai_fallbacks_24h   text AI calls that fell back to the second provider (kind ai_fallback)
--   ai_quota_24h       AI calls refused by a provider quota or the monthly budget (ai_quota)
--
-- Separate from ops_health() so both can change without one migration replacing the other.
-- No user data: counts, function names, error codes and fingerprints only (the run log of a
-- public repository is readable by anyone).

create or replace function public.ops_health_reliability()
returns table (check_name text, status text, detail text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ok timestamptz;
  v_hours numeric;
  v_n bigint;
  v_users bigint;
  v_sent bigint;
  v_good bigint;
  v_refused bigint;
  v_no_token bigint;
  v_top text;
begin
  -- Backup age. db-backup.sh writes the heartbeat only after the upload succeeded.
  select j.last_ok_at into v_ok from public.job_runs j where j.job = 'db-backup';
  check_name := 'backup_age';
  if v_ok is null then
    status := 'fail'; detail := 'no good nightly backup recorded yet';
  else
    v_hours := round(extract(epoch from now() - v_ok) / 3600, 1);
    status := case when v_hours > 26 then 'fail' else 'ok' end;
    detail := 'last good backup ' || v_hours || ' hours ago' ||
      case when v_hours > 26 then ' (more than 26 hours: look at the "Database backup" runs)' else '' end;
  end if;
  return next;

  -- GitHub dispatches from pg_cron (20261106000600).
  if pg_catalog.to_regclass('public.ops_dispatch_log') is not null then
    perform public.ops_dispatch_collect();
    select count(*),
      count(*) filter (where l.outcome = 'ok'),
      -- Refusals after the last accepted dispatch: a token that was replaced stops failing.
      count(*) filter (where l.outcome = 'http_error' and l.status_code in (401, 403, 404)
        and l.at > coalesce((select max(o.at) from public.ops_dispatch_log o where o.outcome = 'ok'), '-infinity')),
      count(*) filter (where l.outcome = 'no_token')
    into v_sent, v_good, v_refused, v_no_token
    from public.ops_dispatch_log l where l.at > now() - interval '26 hours';
    check_name := 'gh_dispatch';
    detail := v_good || ' of ' || v_sent || ' GitHub jobs started on time by the database clock';
    if v_refused > 0 then
      status := 'fail';
      detail := detail || '; GitHub refused the token ' || v_refused || ' times (expired? decision 0076, "Saat ayarı")';
    elsif v_sent = 0 then
      status := 'warn'; detail := 'the database clock started no GitHub job in the last day (pg_cron off?)';
    elsif v_no_token = v_sent then
      status := 'warn'; detail := 'GH_DISPATCH_TOKEN is not set: jobs run on GitHub''s late schedule (decision 0076)';
    elsif v_good < v_sent - v_no_token then
      status := 'warn'; detail := detail || '; some answers were errors or unknown';
    else
      status := 'ok';
    end if;
    return next;
  end if;

  -- Errors users hit.
  if pg_catalog.to_regclass('public.client_errors') is not null then
    select count(*), count(distinct e.user_id) into v_n, v_users
    from public.client_errors e where e.received_at > now() - interval '1 day';
    -- The health check prints into the run log of a public repository: only the code label
    -- (the context's first word, such as sync.run) and the fingerprint, never the message.
    -- The full rows: select * from client_errors where fingerprint = '…' (SQL editor).
    select string_agg(t.n || '× ' || t.label, ', ' order by t.n desc) into v_top
    from (
      select count(*) as n,
        left(min(split_part(coalesce(e.context, '?'), ' ', 1)), 40) || ' #' || e.fingerprint as label
      from public.client_errors e where e.received_at > now() - interval '1 day'
      group by e.fingerprint order by count(*) desc limit 3
    ) t;
    check_name := 'client_errors_24h';
    detail := v_n || ' errors from ' || v_users || ' users' || coalesce('; top: ' || v_top, '');
    status := case when v_n > 200 or v_users > 20 then 'warn' when v_n > 0 then 'info' else 'ok' end;
    return next;
  end if;

  -- Edge functions (supabase/functions/_shared/ops-events.ts).
  select count(*) into v_n from public.ops_events e
  where e.kind = 'fn_error' and e.at > now() - interval '1 day';
  select string_agg(t.n || '× ' || t.k, ', ' order by t.n desc) into v_top
  from (
    select count(*) as n, coalesce(e.detail ->> 'fn', '?') || ' ' || coalesce(e.detail ->> 'code', '?') as k
    from public.ops_events e where e.kind = 'fn_error' and e.at > now() - interval '1 day'
    group by 2 order by 1 desc limit 3
  ) t;
  check_name := 'fn_errors_24h';
  detail := v_n || ' failed edge-function calls' || coalesce('; top: ' || v_top, '');
  status := case when v_n > 50 then 'warn' when v_n > 0 then 'info' else 'ok' end;
  return next;

  select count(*) into v_n from public.ops_events e
  where e.kind = 'ai_fallback' and e.at > now() - interval '1 day';
  select string_agg(t.n || '× ' || t.k, ', ' order by t.n desc) into v_top
  from (
    select count(*) as n, coalesce(e.detail ->> 'fn', '?') as k
    from public.ops_events e where e.kind = 'ai_fallback' and e.at > now() - interval '1 day'
    group by 2 order by 1 desc limit 3
  ) t;
  check_name := 'ai_fallbacks_24h';
  detail := v_n || ' AI calls fell back to the second provider' || coalesce(' (' || v_top || ')', '');
  status := case when v_n > 0 then 'info' else 'ok' end;
  return next;

  select count(*) into v_n from public.ops_events e
  where e.kind = 'ai_quota' and e.at > now() - interval '1 day';
  check_name := 'ai_quota_24h';
  detail := v_n || ' AI calls refused by a provider quota or the monthly budget';
  status := case when v_n > 20 then 'warn' when v_n > 0 then 'info' else 'ok' end;
  return next;
end;
$$;

revoke all on function public.ops_health_reliability() from public, anon, authenticated;
grant execute on function public.ops_health_reliability() to service_role;
