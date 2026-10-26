-- Engapp v0.5 İP2: daily budget of the fetch-article edge function (decision 0044).
-- Only the counter lives here: the article itself (address, title, text) is never stored on
-- the server; the function returns it to the device and forgets it.

create table public.article_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);

alter table public.article_usage enable row level security;
revoke all on table public.article_usage from anon, authenticated;
-- No policies: service role only.

-- Atomically takes one fetch from today's budget (UTC day). Returns {allowed, used, limit}.
-- Same shape and locking as tts_consume().
create or replace function public.article_consume(p_user uuid, p_limit integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if p_user is null or p_limit is null or p_limit < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  insert into public.article_usage as u (user_id, day, calls)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1
    where u.calls + 1 <= p_limit
  returning calls into v_used;

  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select calls into v_used from public.article_usage where user_id = p_user and day = v_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.article_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.article_consume(uuid, integer) to service_role;

-- The privacy policy keeps daily counters for 90 days (as purge_usage_counters, 20261026001020).
-- Its own function and cron entry, so purge_usage_counters() keeps its shape.
create or replace function public.purge_article_usage(p_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.article_usage
  where day < (now() at time zone 'utc')::date - greatest(p_days, 1);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_article_usage(integer) from public, anon, authenticated;
grant execute on function public.purge_article_usage(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-article-usage', '29 3 * * *', 'select public.purge_article_usage(90)');
  else
    raise notice 'pg_cron is not available: schedule public.purge_article_usage(90) manually';
  end if;
exception when others then
  raise notice 'could not schedule the article usage purge with pg_cron (%): schedule public.purge_article_usage(90) manually', sqlerrm;
end;
$$;
