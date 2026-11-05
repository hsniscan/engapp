-- Engapp v0.5.3: a pool of the monthly text budget for the system jobs (decision 0077).
--
-- With Claude Sonnet as the primary text model, the nightly level job (up to
-- AI_SYSTEM_DAILY_LIMIT = 100 calls a day) would cost about 3 USD a night and use up the whole
-- CLAUDE_TEXT_MONTHLY_USD in a few days. System jobs (level job, morpheme meanings, the
-- level-test bank) now reserve through text_budget_reserve_pool: the hold counts against the
-- global month (text_budget) AND against the pool's own monthly cap (AI_SYSTEM_MONTHLY_USD, at
-- most AI_SYSTEM_MAX_SHARE of the global cap; computed by the jobs). When either is used up the
-- job falls back to Gemini (free tier) or stops for the night.
--
-- Same shape and rules as the per-user share (text_budget_users, 20261103000100): reserve the
-- upper bound, settle with the real cost, nothing stays reserved after a refusal. Lock order
-- everywhere: text_budget_users rows, then text_budget_pools rows, then the text_budget month
-- row. Service role only.

create table public.text_budget_pools (
  pool text not null check (pool ~ '^[a-z][a-z0-9_]{0,31}$'),
  month date not null check (month = date_trunc('month', month)::date),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (pool, month)
);

alter table public.text_budget_pools enable row level security;
revoke all on table public.text_budget_pools from anon, authenticated;

-- Which pool a hold pays from (null: none; a hold has a user or a pool, never both).
alter table public.text_budget_holds
  add column pool text check (pool is null or pool ~ '^[a-z][a-z0-9_]{0,31}$');
alter table public.text_budget_holds
  add constraint text_budget_holds_user_or_pool check (user_id is null or pool is null);
create index text_budget_holds_pool on public.text_budget_holds (pool) where pool is not null;

-- Returns the hold id, or null when the pool's monthly cap (p_pool_cap) or the global cap
-- (p_cap) cannot cover p_amount. Nothing stays reserved after a refusal.
create or replace function public.text_budget_reserve_pool(
  p_amount numeric, p_cap numeric, p_purpose text, p_pool text, p_pool_cap numeric,
  p_batch boolean default false)
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
  if p_pool is null or p_pool !~ '^[a-z][a-z0-9_]{0,31}$' or p_amount is null or p_amount <= 0
     or p_pool_cap is null or p_pool_cap < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_amount > p_pool_cap then
    perform public.ops_event('text_budget_pool_cap', jsonb_build_object('pool', p_pool, 'purpose', p_purpose));
    return null;
  end if;

  insert into public.text_budget_pools as p (pool, month, reserved_usd)
  values (p_pool, v_month, p_amount)
  on conflict (pool, month) do update
    set reserved_usd = p.reserved_usd + p_amount, updated_at = now()
    where p.spent_usd + p.reserved_usd + p_amount <= p_pool_cap
  returning true into v_ok;
  if v_ok is null then
    perform public.ops_event('text_budget_pool_cap', jsonb_build_object('pool', p_pool, 'purpose', p_purpose));
    return null;
  end if;

  v_id := public.text_budget_reserve(p_amount, p_cap, p_purpose, coalesce(p_batch, false));
  if v_id is null then
    update public.text_budget_pools p
      set reserved_usd = greatest(0, p.reserved_usd - p_amount), updated_at = now()
      where p.pool = p_pool and p.month = v_month;
    perform public.ops_event('text_budget_global_cap', jsonb_build_object('purpose', p_purpose));
    return null;
  end if;
  update public.text_budget_holds set pool = p_pool where id = v_id;
  return v_id;
end;
$$;

-- Same contract as before (20261103000100), plus the pool: a hold with a pool moves its amount
-- out of the pool's `reserved` and the real cost into the pool's `spent`.
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
  v_pool text;
begin
  if p_actual is null or p_actual < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  delete from public.text_budget_holds h where h.id = p_hold
  returning h.month, h.amount_usd, h.user_id, h.pool into v_month, v_amount, v_user, v_pool;
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
  if v_pool is not null then
    update public.text_budget_pools p set
      reserved_usd = greatest(0, p.reserved_usd - v_amount),
      spent_usd = p.spent_usd + p_actual,
      updated_at = now()
    where p.pool = v_pool and p.month = v_month;
  end if;
  update public.text_budget b set
    reserved_usd = greatest(0, b.reserved_usd - v_amount),
    spent_usd = b.spent_usd + p_actual,
    updated_at = now()
  where b.month = v_month;
end;
$$;

-- {month, spent_usd, reserved_usd} of one pool this month (zeros when none yet).
create or replace function public.text_budget_pool_status(p_pool text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('month', p.month, 'spent_usd', p.spent_usd, 'reserved_usd', p.reserved_usd)
     from public.text_budget_pools p
     where p.pool = p_pool and p.month = date_trunc('month', now() at time zone 'utc')::date),
    jsonb_build_object('month', date_trunc('month', now() at time zone 'utc')::date,
      'spent_usd', 0, 'reserved_usd', 0))
$$;

-- As 20261103000100, plus: the pools' `reserved_usd` is reconciled with their open holds.
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
  v_fixed_pools integer;
begin
  v_released := public.text_budget_release_stale(interval '15 minutes');
  -- Lock order: user rows, pool rows, then month rows (as reserve/settle).
  perform 1 from public.text_budget_users where month >= v_from order by user_id, month for update;
  perform 1 from public.text_budget_pools where month >= v_from order by pool, month for update;
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
  update public.text_budget_pools p set
    reserved_usd = h.sum_usd, updated_at = now()
  from (
    select pp.pool, pp.month, coalesce(sum(hh.amount_usd), 0) as sum_usd
    from public.text_budget_pools pp
    left join public.text_budget_holds hh on hh.pool = pp.pool and hh.month = pp.month
    where pp.month >= v_from
    group by pp.pool, pp.month
  ) h
  where p.pool = h.pool and p.month = h.month and p.reserved_usd <> h.sum_usd;
  get diagnostics v_fixed_pools = row_count;
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
  return jsonb_build_object('released', v_released, 'reconciled', v_fixed,
    'reconciled_users', v_fixed_users, 'reconciled_pools', v_fixed_pools);
end;
$$;

revoke all on function public.text_budget_reserve_pool(numeric, numeric, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.text_budget_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.text_budget_pool_status(text) from public, anon, authenticated;
revoke all on function public.text_budget_maintain() from public, anon, authenticated;
grant execute on function public.text_budget_reserve_pool(numeric, numeric, text, text, numeric, boolean) to service_role;
grant execute on function public.text_budget_settle(uuid, numeric) to service_role;
grant execute on function public.text_budget_pool_status(text) to service_role;
grant execute on function public.text_budget_maintain() to service_role;
