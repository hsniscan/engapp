-- Engapp v0.5.2 (decision 0060): AI cost guard rails.
--
-- 1. Per-feature daily AI limits. ai_usage keeps one counter per user and day for all text
--    features together (AI_DAILY_LIMIT); ai_feature_usage adds one per feature, so a single
--    feature (e.g. the weekly report) cannot use the whole day's allowance.
-- 2. A per-user monthly money cap on the shared text budget (text_budget, decision 0047).
--    Before, one user could spend the whole month's CLAUDE_TEXT_MONTHLY_USD on day one and
--    every user's Claude fallback and daily story failed until the 1st. Now every user-driven
--    Claude call also reserves against text_budget_users (AI_USER_MONTHLY_USD, at most a
--    share of the global cap, computed by the edge functions).
-- 3. ops_events: a counter/log table without user data (refused reservations, quota hits),
--    read by ops_health() (migration 20261103000400) and the nightly health check.
-- 4. pg_cron: stale single-call text holds are released every 15 minutes (S6: nothing called
--    text_budget_release_stale before) and `reserved_usd` is reconciled with the open holds.
--
-- Service role only, like the budgets themselves.

-- ---------------------------------------------------------------------------
-- ops_events (no user column: the account deletion guard requires shared tables to have none)
-- ---------------------------------------------------------------------------

create table public.ops_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,47}$'),
  detail jsonb not null default '{}'::jsonb check (
    jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000)
);

create index ops_events_kind_at on public.ops_events (kind, at);

alter table public.ops_events enable row level security;
revoke all on table public.ops_events from anon, authenticated;

create or replace function public.ops_event(p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.ops_events (kind, detail) values (p_kind, coalesce(p_detail, '{}'::jsonb))
$$;

revoke all on function public.ops_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.ops_event(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- per-feature daily counters
-- ---------------------------------------------------------------------------

create table public.ai_feature_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  feature text not null check (feature ~ '^[a-z][a-z0-9_-]{0,31}$'),
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day, feature)
);

create index ai_feature_usage_day on public.ai_feature_usage (day);

alter table public.ai_feature_usage enable row level security;
revoke all on table public.ai_feature_usage from anon, authenticated;

-- One call of `p_feature`: allowed only while both the feature's counter (p_feature_limit)
-- and the shared ai_usage counter (p_total_limit, ai_consume) have room. Atomic: the
-- feature row is taken with a conditional upsert, and undone in the same transaction when
-- the shared counter refuses. Returns {allowed, used, limit} of the counter that decided.
create or replace function public.ai_consume_feature(
  p_user uuid, p_feature text, p_feature_limit integer, p_total_limit integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
  v_total jsonb;
begin
  if p_user is null or p_feature is null or p_feature_limit is null or p_feature_limit < 1
     or p_total_limit is null or p_total_limit < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  insert into public.ai_feature_usage as u (user_id, day, feature, calls)
  values (p_user, v_day, p_feature, 1)
  on conflict (user_id, day, feature) do update
    set calls = u.calls + 1
    where u.calls + 1 <= p_feature_limit
  returning calls into v_used;

  if v_used is null then
    select calls into v_used from public.ai_feature_usage
    where user_id = p_user and day = v_day and feature = p_feature;
    perform public.ops_event('ai_feature_limit', jsonb_build_object('feature', p_feature));
    return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_feature_limit);
  end if;

  v_total := public.ai_consume(p_user, p_total_limit);
  if not coalesce((v_total ->> 'allowed')::boolean, false) then
    update public.ai_feature_usage set calls = greatest(0, calls - 1)
    where user_id = p_user and day = v_day and feature = p_feature;
    perform public.ops_event('ai_daily_limit', jsonb_build_object('feature', p_feature));
    return v_total;
  end if;
  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_feature_limit);
end;
$$;

revoke all on function public.ai_consume_feature(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_consume_feature(uuid, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- per-user share of the monthly text budget
-- ---------------------------------------------------------------------------

create table public.text_budget_users (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.text_budget_users enable row level security;
revoke all on table public.text_budget_users from anon, authenticated;

-- Whose call a hold pays for (null: a system job such as the graded library). Deleting the
-- account deletes the user's open holds; the hourly reconcile below then frees their
-- reservation in text_budget.
alter table public.text_budget_holds
  add column user_id uuid references auth.users (id) on delete cascade;
create index text_budget_holds_user on public.text_budget_holds (user_id) where user_id is not null;

-- Lock order everywhere: text_budget_users row first, then the text_budget month row (no
-- deadlock between a user's reserve and settle running at the same time).

-- Returns the hold id, or null when the user's monthly cap (p_user_cap) or the global cap
-- (p_cap) cannot cover p_amount. Nothing stays reserved after a refusal.
create or replace function public.text_budget_reserve_user(
  p_amount numeric, p_cap numeric, p_purpose text, p_user uuid, p_user_cap numeric)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_ok boolean;
  v_id uuid;
begin
  if p_user is null or p_amount is null or p_amount <= 0 or p_user_cap is null or p_user_cap < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_amount > p_user_cap then
    perform public.ops_event('text_budget_user_cap', jsonb_build_object('purpose', p_purpose));
    return null;
  end if;

  insert into public.text_budget_users as u (user_id, month, reserved_usd)
  values (p_user, v_month, p_amount)
  on conflict (user_id, month) do update
    set reserved_usd = u.reserved_usd + p_amount, updated_at = now()
    where u.spent_usd + u.reserved_usd + p_amount <= p_user_cap
  returning true into v_ok;
  if v_ok is null then
    perform public.ops_event('text_budget_user_cap', jsonb_build_object('purpose', p_purpose));
    return null;
  end if;

  v_id := public.text_budget_reserve(p_amount, p_cap, p_purpose, false);
  if v_id is null then
    update public.text_budget_users u
      set reserved_usd = greatest(0, u.reserved_usd - p_amount), updated_at = now()
      where u.user_id = p_user and u.month = v_month;
    perform public.ops_event('text_budget_global_cap', jsonb_build_object('purpose', p_purpose));
    return null;
  end if;
  update public.text_budget_holds set user_id = p_user where id = v_id;
  return v_id;
end;
$$;

-- Same contract as before (20261101000500), plus the user's share: a hold with a user_id
-- moves its amount out of the user's `reserved` and the real cost into the user's `spent`.
create or replace function public.text_budget_settle(p_hold uuid, p_actual numeric)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_amount numeric;
  v_user uuid;
begin
  if p_actual is null or p_actual < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  delete from public.text_budget_holds h where h.id = p_hold
  returning h.month, h.amount_usd, h.user_id into v_month, v_amount, v_user;
  if v_month is null then
    v_month := date_trunc('month', now() at time zone 'utc')::date;
    v_amount := 0;
    insert into public.text_budget (month, cap_usd) values (v_month, 0) on conflict do nothing;
  end if;
  if v_user is not null then
    update public.text_budget_users u set
      reserved_usd = greatest(0, u.reserved_usd - v_amount),
      spent_usd = u.spent_usd + p_actual,
      updated_at = now()
    where u.user_id = v_user and u.month = v_month;
  end if;
  update public.text_budget b set
    reserved_usd = greatest(0, b.reserved_usd - v_amount),
    spent_usd = b.spent_usd + p_actual,
    updated_at = now()
  where b.month = v_month;
end;
$$;

-- {month, cap_usd(null), spent_usd, reserved_usd} of one user this month.
create or replace function public.text_budget_user_status(p_user uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('month', u.month, 'spent_usd', u.spent_usd, 'reserved_usd', u.reserved_usd)
     from public.text_budget_users u
     where u.user_id = p_user and u.month = date_trunc('month', now() at time zone 'utc')::date),
    jsonb_build_object('month', date_trunc('month', now() at time zone 'utc')::date,
      'spent_usd', 0, 'reserved_usd', 0))
$$;

-- Every 15 minutes (pg_cron): single-call holds older than 15 minutes belong to a function
-- that died between reserve and settle (an edge function lives at most a few minutes); they
-- are counted as spent in full. Then `reserved_usd` of this and last month is set to the sum
-- of the open holds, which repairs a reservation whose hold went away with a deleted account.
create or replace function public.text_budget_maintain()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_released integer;
  v_from date := (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date;
  v_fixed integer;
  v_fixed_users integer;
begin
  v_released := public.text_budget_release_stale(interval '15 minutes');
  -- Lock order: user rows, then month rows (as reserve/settle).
  perform 1 from public.text_budget_users where month >= v_from order by user_id, month for update;
  perform 1 from public.text_budget where month >= v_from order by month for update;
  update public.text_budget_users u set
    reserved_usd = h.sum_usd, updated_at = now()
  from (
    select uu.user_id, uu.month, coalesce(sum(hh.amount_usd), 0) as sum_usd
    from public.text_budget_users uu
    left join public.text_budget_holds hh on hh.user_id = uu.user_id and hh.month = uu.month
    where uu.month >= v_from
    group by uu.user_id, uu.month
  ) h
  where u.user_id = h.user_id and u.month = h.month and u.reserved_usd <> h.sum_usd;
  get diagnostics v_fixed_users = row_count;
  update public.text_budget b set
    reserved_usd = h.sum_usd, updated_at = now()
  from (
    select bb.month, coalesce(sum(hh.amount_usd), 0) as sum_usd
    from public.text_budget bb
    left join public.text_budget_holds hh on hh.month = bb.month
    where bb.month >= v_from
    group by bb.month
  ) h
  where b.month = h.month and b.reserved_usd <> h.sum_usd;
  get diagnostics v_fixed = row_count;
  if v_released > 0 then
    perform public.ops_event('text_budget_stale_holds', jsonb_build_object('released', v_released));
  end if;
  return jsonb_build_object('released', v_released, 'reconciled', v_fixed, 'reconciled_users', v_fixed_users);
end;
$$;

-- Daily: counters the privacy policy promises to delete after 90 days, and old ops events.
create or replace function public.purge_ops_counters(p_days integer default 90)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff date := (now() at time zone 'utc')::date - greatest(p_days, 1);
  v_feature integer;
  v_events integer;
  v_users integer;
begin
  delete from public.ai_feature_usage where day < v_cutoff;
  get diagnostics v_feature = row_count;
  delete from public.ops_events where at < v_cutoff;
  get diagnostics v_events = row_count;
  -- Per-user monthly spend: kept for the current and the previous month only.
  delete from public.text_budget_users
  where month < (date_trunc('month', now() at time zone 'utc') - interval '1 month')::date;
  get diagnostics v_users = row_count;
  return jsonb_build_object('ai_feature_usage', v_feature, 'ops_events', v_events, 'text_budget_users', v_users);
end;
$$;

revoke all on function public.text_budget_reserve_user(numeric, numeric, text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.text_budget_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.text_budget_user_status(uuid) from public, anon, authenticated;
revoke all on function public.text_budget_maintain() from public, anon, authenticated;
revoke all on function public.purge_ops_counters(integer) from public, anon, authenticated;
grant execute on function public.text_budget_reserve_user(numeric, numeric, text, uuid, numeric) to service_role;
grant execute on function public.text_budget_settle(uuid, numeric) to service_role;
grant execute on function public.text_budget_user_status(uuid) to service_role;
grant execute on function public.text_budget_maintain() to service_role;
grant execute on function public.purge_ops_counters(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-text-budget', '*/15 * * * *', 'select public.text_budget_maintain()');
    perform cron.schedule('engapp-purge-ops', '33 3 * * *', 'select public.purge_ops_counters(90)');
  else
    raise notice 'pg_cron is not available: schedule public.text_budget_maintain() and public.purge_ops_counters(90) manually';
  end if;
exception when others then
  raise notice 'could not schedule the budget jobs with pg_cron (%): schedule them manually', sqlerrm;
end;
$$;
