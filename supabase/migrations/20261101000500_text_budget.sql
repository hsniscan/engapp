-- Engapp v0.5 İP5: the monthly text-AI budget (decision 0047).
--
-- Text jobs (the graded library's graded-v1 / gradedcheck-v1 batches now, the daily story
-- later) have their own monthly cap, CLAUDE_TEXT_MONTHLY_USD (default 10 USD, owner's
-- decision 2026-10-25), next to the picture budget (image_budget, 80 % of the subscription
-- credit). Same rule as image_budget: reserve an upper bound before every model call, settle
-- with the real cost from `usage` after; a reservation that would pass the cap is refused.
-- Kept in tables of its own instead of a `kind` column on image_budget so the picture
-- functions (and their month primary key) stay untouched.
--
-- Service role only: the jobs and edge functions call these through
-- supabase/functions/_shared/text-budget.ts. Clients can neither read nor change the budget.

create table public.text_budget (
  month date primary key check (month = date_trunc('month', month)::date),
  cap_usd numeric(12, 6) not null check (cap_usd >= 0),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  updated_at timestamptz not null default now()
);

create table public.text_budget_holds (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.text_budget (month),
  amount_usd numeric(12, 6) not null check (amount_usd > 0),
  -- What the money is for ('graded', 'gradedcheck', 'story', …). Free-form but tidy, so a
  -- new text job needs no migration.
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- A Message Batch hold lives until its batch is collected (hours to a day): never released
  -- as stale.
  batch boolean not null default false,
  created_at timestamptz not null default now()
);

create index text_budget_holds_stale on public.text_budget_holds (created_at) where not batch;

alter table public.text_budget enable row level security;
alter table public.text_budget_holds enable row level security;
revoke all on table public.text_budget, public.text_budget_holds from anon, authenticated;

-- Returns the hold id, or null when the month's budget cannot cover p_amount.
-- One statement takes the month row's lock (INSERT .. ON CONFLICT DO UPDATE .. WHERE), so
-- concurrent reservations are serialised and spent + reserved never passes the cap.
create or replace function public.text_budget_reserve(
  p_amount numeric, p_cap numeric, p_purpose text, p_batch boolean default false)
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
  if p_amount is null or p_amount <= 0 or p_cap is null or p_cap < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_amount > p_cap then
    return null;
  end if;
  insert into public.text_budget as b (month, cap_usd, spent_usd, reserved_usd)
  values (v_month, p_cap, 0, p_amount)
  on conflict (month) do update
    set reserved_usd = b.reserved_usd + p_amount, cap_usd = p_cap, updated_at = now()
    where b.spent_usd + b.reserved_usd + p_amount <= p_cap
  returning true into v_ok;
  if v_ok is null then
    return null;
  end if;
  insert into public.text_budget_holds (month, amount_usd, purpose, batch)
  values (v_month, p_amount, p_purpose, coalesce(p_batch, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- Ends a hold: its amount leaves `reserved`, the real cost joins `spent` (of the hold's
-- month). An unknown hold (already settled or released) only adds the real cost, so a
-- settle that runs twice never loses money from the books.
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
begin
  if p_actual is null or p_actual < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  delete from public.text_budget_holds h where h.id = p_hold
  returning h.month, h.amount_usd into v_month, v_amount;
  if v_month is null then
    v_month := date_trunc('month', now() at time zone 'utc')::date;
    v_amount := 0;
    insert into public.text_budget (month, cap_usd) values (v_month, 0) on conflict do nothing;
  end if;
  update public.text_budget b set
    reserved_usd = greatest(0, b.reserved_usd - v_amount),
    spent_usd = b.spent_usd + p_actual,
    updated_at = now()
  where b.month = v_month;
end;
$$;

-- Holds of single calls that never settled (a crashed function): counted as spent in full,
-- which errs on the safe side. Batch holds are left for collect.
create or replace function public.text_budget_release_stale(p_older_than interval)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  h record;
  n integer := 0;
begin
  for h in
    select id, amount_usd from public.text_budget_holds
    where not batch and created_at < now() - p_older_than
  loop
    perform public.text_budget_settle(h.id, h.amount_usd);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- {month, cap_usd, spent_usd, reserved_usd} of the current month (zeros when none yet).
create or replace function public.text_budget_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('month', b.month, 'cap_usd', b.cap_usd, 'spent_usd', b.spent_usd,
       'reserved_usd', b.reserved_usd)
     from public.text_budget b where b.month = date_trunc('month', now() at time zone 'utc')::date),
    jsonb_build_object('month', date_trunc('month', now() at time zone 'utc')::date,
      'cap_usd', 0, 'spent_usd', 0, 'reserved_usd', 0))
$$;

revoke all on function public.text_budget_reserve(numeric, numeric, text, boolean) from public, anon, authenticated;
revoke all on function public.text_budget_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.text_budget_release_stale(interval) from public, anon, authenticated;
revoke all on function public.text_budget_status() from public, anon, authenticated;
grant execute on function public.text_budget_reserve(numeric, numeric, text, boolean) to service_role;
grant execute on function public.text_budget_settle(uuid, numeric) to service_role;
grant execute on function public.text_budget_release_stale(interval) to service_role;
grant execute on function public.text_budget_status() to service_role;
