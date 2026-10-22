-- v0.3 İP8 smart notifications (Web Push). docs/decisions/0024-web-push.md.
--
--   settings.notify        synced user setting {enabled, mode: 'auto'|'fixed', hour}
--   push_subscriptions     one row per browser endpoint, owned by the signed-in user
--   push_log               one row per user-day a reminder was sent (at most one)
--   push_cron_config       where the scheduled job posts to, and its secret token
--
-- pg_cron runs public.push_cron_tick() every 15 minutes; it posts (pg_net) to the push-send
-- edge function, which decides with the shared rule (supabase/functions/_shared/push-rule.ts)
-- and sends. The function URL is set by the deploy workflow (public.push_configure); until
-- then the tick does nothing, so a local or CI database never calls anything.

-- ---------------------------------------------------------------------------
-- settings.notify
-- ---------------------------------------------------------------------------

-- Nullable, no default: absent = notifications off. An app version without the column
-- pushes settings without the key, and _sync_upsert keeps the stored value.
alter table public.settings
  add column notify jsonb check (notify is null or jsonb_typeof(notify) = 'object');

comment on column public.settings.notify is
  'Web Push reminder: {enabled boolean, mode auto|fixed, hour 9-21 (resolved on the device)}. null = off.';

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

-- Push services of the supported browsers (the same list as _shared/webpush.ts): the server
-- only ever posts to these hosts.
create or replace function public.push_endpoint_ok(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_endpoint is not null
     and char_length(p_endpoint) <= 1024
     and p_endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
$$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (public.push_endpoint_ok(endpoint)),
  -- base64url P-256 public key (65 bytes) and auth secret (16 bytes) of the browser
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$'),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
-- Clients may see their own rows; writes go through push_subscribe / push_unsubscribe only.
grant select on table public.push_subscriptions to authenticated;
create policy "own rows: select" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- The signed-in user subscribes this browser. The owner is always auth.uid(), never a
-- parameter. An endpoint registered before by another account (same browser, other
-- sign-in) moves to the caller: whoever holds the browser holds its endpoint.
create or replace function public.push_subscribe(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public.push_endpoint_ok(p_endpoint) then
    raise exception 'unsupported push endpoint' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = v_uid,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now(),
        failures = 0
  returning s.id into v_id;
  -- At most 10 devices per account: the oldest go.
  delete from public.push_subscriptions
  where user_id = v_uid
    and id not in (
      select id from public.push_subscriptions where user_id = v_uid order by updated_at desc limit 10);
  return v_id;
end;
$$;

-- Removes this browser's subscription of the signed-in user (true when there was one).
create or replace function public.push_unsubscribe(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
  return found;
end;
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sent reminders
-- ---------------------------------------------------------------------------

create table public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'), -- the user's day (timezone + day_start_hour)
  due integer not null default 0 check (due >= 0),
  delivered integer check (delivered >= 0),
  failed integer check (failed >= 0),
  sent_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.push_log enable row level security;
revoke all on table public.push_log from anon, authenticated;
grant select on table public.push_log to authenticated;
create policy "own rows: select" on public.push_log for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- What push-send reads and writes (service_role only)
-- ---------------------------------------------------------------------------

create index if not exists review_logs_user_reviewed on public.review_logs (user_id, reviewed_at);
create index if not exists cards_user_due on public.cards (user_id, due) where deleted_at is null;

-- Users with reminders on and at least one subscription, with what the rule needs.
-- settings.vacation is read through to_jsonb so this works before and after the load
-- management package adds that column (absent = not on vacation).
create or replace function public.push_candidates()
returns table (
  user_id uuid,
  timezone text,
  day_start_hour integer,
  notify jsonb,
  vacation jsonb,
  last_review_at bigint,
  last_push_day text,
  subscriptions jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.user_id,
    s.timezone,
    s.day_start_hour,
    s.notify,
    to_jsonb(s) -> 'vacation',
    (select max(r.reviewed_at) from public.review_logs r
      where r.user_id = s.user_id and r.undo_of is null),
    (select max(l.day) from public.push_log l where l.user_id = s.user_id),
    (select jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)
                      order by p.updated_at desc)
       from public.push_subscriptions p where p.user_id = s.user_id)
  from public.settings s
  where s.id = 'settings'
    and s.deleted_at is null
    and s.notify ->> 'enabled' = 'true'
    and exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
$$;

-- Reviews due before each user's end of day (p_items = [{user_id, until}]): studied cards
-- (learning, review, relearning) that are live, not suspended and unlocked, as the app's
-- queue counts them. New cards are not counted. sec_per_card = median answer time over the
-- last 30 days (answers capped at 60 s), null without history.
create or replace function public.push_due_counts(p_items jsonb)
returns table (user_id uuid, due integer, sec_per_card double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select (i ->> 'user_id')::uuid as user_id, (i ->> 'until')::bigint as until
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  )
  select
    it.user_id,
    (select count(*) from public.cards c
      where c.user_id = it.user_id and c.deleted_at is null and not c.suspended and c.unlocked
        and c.state in (1, 2, 3) and c.due < it.until)::integer,
    (select percentile_cont(0.5) within group (order by least(r.duration_ms, 60000)) / 1000.0
       from public.review_logs r
      where r.user_id = it.user_id and r.undo_of is null and r.duration_ms > 0
        and r.reviewed_at >= (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000)
  from items it
$$;

-- Claims the user-day: true only for the first caller (at most one reminder a day).
create or replace function public.push_claim(p_user uuid, p_day text, p_due integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.push_log (user_id, day, due) values (p_user, p_day, greatest(p_due, 0))
  on conflict do nothing;
  return found;
end;
$$;

create or replace function public.push_finish(p_user uuid, p_day text, p_delivered integer, p_failed integer)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.push_log set delivered = p_delivered, failed = p_failed
  where user_id = p_user and day = p_day
$$;

create or replace function public.push_remove_subscriptions(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.push_subscriptions where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Delivery results. A subscription that failed on 10 reminders in a row (e.g. a browser
-- that was reset without telling the push service) is dropped.
create or replace function public.push_mark_delivery(p_ok uuid[], p_failed uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.push_subscriptions set last_success_at = now(), failures = 0
  where id = any (coalesce(p_ok, '{}'));
  update public.push_subscriptions set failures = failures + 1
  where id = any (coalesce(p_failed, '{}'));
  delete from public.push_subscriptions where failures >= 10;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling: pg_cron → push_cron_tick() → pg_net POST → push-send
-- ---------------------------------------------------------------------------

create table public.push_cron_config (
  id boolean primary key default true check (id),
  -- https://<project>.supabase.co/functions/v1/push-send, set by the deploy workflow
  function_url text check (function_url is null or function_url ~ '^https?://'),
  -- Random secret generated here; the tick sends it, push-send checks it. Never leaves the database
  -- except in that request.
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
);
insert into public.push_cron_config default values on conflict do nothing;

alter table public.push_cron_config enable row level security;
revoke all on table public.push_cron_config from anon, authenticated, service_role;

create or replace function public.push_check_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_cron_config where token = p_token and p_token is not null)
$$;

-- Called once per deploy by .github/workflows/deploy-supabase.yml (psql as the owner).
create or replace function public.push_configure(p_function_url text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.push_cron_config set function_url = nullif(p_function_url, '')
$$;

-- Every 15 minutes. Does nothing until the function URL is set or when pg_net is missing.
create or replace function public.push_cron_tick()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  delete from public.push_log where sent_at < now() - interval '90 days';
  select function_url, token into v_url, v_token from public.push_cron_config;
  if v_url is null then
    return 'not_configured';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return 'no_pg_net';
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    using v_url, '{}'::jsonb,
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token);
  return 'posted';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'push_candidates()', 'push_due_counts(jsonb)', 'push_claim(uuid, text, integer)',
    'push_finish(uuid, text, integer, integer)', 'push_remove_subscriptions(uuid[])',
    'push_mark_delivery(uuid[], uuid[])', 'push_check_cron_token(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  revoke all on function public.push_configure(text) from public, anon, authenticated, service_role;
  revoke all on function public.push_cron_tick() from public, anon, authenticated, service_role;
end;
$$;

-- pg_net for the HTTP call and pg_cron for the schedule (both available on Supabase; enable
-- them under Database > Extensions if a notice appears). Same pattern as the tombstone purge.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  else
    raise notice 'pg_net is not available: push reminders are not scheduled';
  end if;
exception when others then
  raise notice 'could not enable pg_net (%): push reminders are not scheduled', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-push-send', '*/15 * * * *', 'select public.push_cron_tick()');
  else
    raise notice 'pg_cron is not available: schedule public.push_cron_tick() every 15 minutes manually';
  end if;
exception when others then
  raise notice 'could not schedule push with pg_cron (%): schedule public.push_cron_tick() manually', sqlerrm;
end;
$$;
