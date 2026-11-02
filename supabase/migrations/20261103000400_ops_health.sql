-- Engapp v0.5.2 (decision 0060): one place that says whether the backend is healthy (review
-- S9). ops_health() is read every night by .github/workflows/db-backup.yml
-- (scripts/ops-health.sh): a 'fail' row fails that run, and GitHub e-mails the owner; 'warn'
-- rows show as warnings in the run. No user data: counts and percentages only.
--
-- Checks: text and picture budget use this month, refusals because the shared text budget
-- was used up, stale budget holds, the nightly jobs' heartbeats (job_runs, including the
-- backup itself), failed pg_cron runs in the last day, the database size against the Free
-- plan's 500 MB, and new lexicon terms waiting for review.
--
-- SECURITY DEFINER: service_role has no access to the cron schema on Supabase, so the
-- pg_cron check runs as the owner. Only service_role may execute it (grants below).

create or replace function public.ops_health()
returns table (check_name text, status text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_pct numeric;
  v_n bigint;
  v_size bigint;
  r record;
begin
  -- Monthly budgets.
  select case when b.cap_usd > 0 then round(100 * (b.spent_usd + b.reserved_usd) / b.cap_usd) end
  into v_pct from public.text_budget b where b.month = v_month;
  check_name := 'text_budget'; detail := coalesce(v_pct, 0) || ' % of the monthly text budget used';
  status := case when coalesce(v_pct, 0) >= 100 then 'fail' when v_pct >= 80 then 'warn' else 'ok' end;
  return next;

  select case when b.cap_usd > 0 then round(100 * (b.spent_usd + b.reserved_usd) / b.cap_usd) end
  into v_pct from public.image_budget b where b.month = v_month;
  check_name := 'image_budget'; detail := coalesce(v_pct, 0) || ' % of the monthly picture budget used';
  status := case when coalesce(v_pct, 0) >= 100 then 'warn' when v_pct >= 80 then 'info' else 'ok' end;
  return next;

  select count(*) into v_n from public.ops_events
  where kind = 'text_budget_global_cap' and at > now() - interval '1 day';
  check_name := 'text_budget_refusals'; detail := v_n || ' AI calls refused in the last day because the shared text budget was used up';
  status := case when v_n > 0 then 'fail' else 'ok' end;
  return next;

  select count(*) into v_n from public.ops_events
  where kind = 'text_budget_user_cap' and at > now() - interval '1 day';
  check_name := 'text_budget_user_caps'; detail := v_n || ' AI calls refused in the last day by a user''s monthly share';
  status := case when v_n > 50 then 'warn' when v_n > 0 then 'info' else 'ok' end;
  return next;

  select count(*) into v_n from public.ops_events
  where kind in ('ai_daily_limit', 'ai_feature_limit') and at > now() - interval '1 day';
  check_name := 'ai_daily_limits'; detail := v_n || ' AI calls refused in the last day by the daily limits';
  status := case when v_n > 200 then 'warn' when v_n > 0 then 'info' else 'ok' end;
  return next;

  select count(*) into v_n from public.text_budget_holds
  where not batch and created_at < now() - interval '1 hour';
  check_name := 'stale_text_holds'; detail := v_n || ' text budget holds older than an hour (pg_cron should release them)';
  status := case when v_n > 0 then 'warn' else 'ok' end;
  return next;

  -- Nightly jobs (scripts/lib/heartbeat.ts and db-backup.sh write job_runs).
  for r in select j.job, j.status as st, j.last_ok_at from public.job_runs j order by j.job loop
    check_name := 'job_' || r.job;
    detail := 'last good run ' || coalesce(to_char(r.last_ok_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC', 'never')
      || ', last status ' || r.st;
    status := case
      when r.last_ok_at is null or r.last_ok_at < now() - interval '3 days' then
        case when r.job = 'db-backup' then 'fail' else 'warn' end
      when r.last_ok_at < now() - interval '36 hours' then 'warn'
      else 'ok' end;
    return next;
  end loop;

  -- pg_cron (purges, push reminders, the budget job).
  if pg_catalog.to_regclass('cron.job_run_details') is not null then
    execute 'select count(*) from cron.job_run_details where status = ''failed'' and start_time > now() - interval ''1 day'''
    into v_n;
    check_name := 'pg_cron'; detail := v_n || ' failed pg_cron runs in the last day';
    status := case when v_n > 0 then 'fail' else 'ok' end;
    return next;
  end if;

  -- Database size (Supabase Free: 500 MB, read-only beyond).
  v_size := pg_catalog.pg_database_size(pg_catalog.current_database());
  check_name := 'db_size'; detail := (v_size / 1048576) || ' MB';
  status := case when v_size > 450 * 1048576 then 'fail' when v_size > 350 * 1048576 then 'warn' else 'ok' end;
  return next;

  -- Lexicon moderation (decision 0060).
  select count(*) into v_n from public.lexicon_terms where needs_review;
  check_name := 'lexicon_review'; detail := v_n || ' new lexicon terms outside the reference lists to look at';
  status := case when v_n > 0 then 'info' else 'ok' end;
  return next;
end;
$$;

revoke all on function public.ops_health() from public, anon, authenticated;
grant execute on function public.ops_health() to service_role;
