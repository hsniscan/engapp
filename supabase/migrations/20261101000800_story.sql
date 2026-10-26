-- Engapp v0.5 İP8: "Bugünün hikâyesi", the daily story (docs/decisions/0050-daily-story.md).
--
-- story_usage: the ai-story edge function's daily counter. One story per user and UTC day,
-- plus at most one regeneration of it (the device asks again, with an avoid list, when the
-- first story has too many words the user does not know). Only counts live here: the
-- request (target words, level, difficulty, topics) and the story itself are never stored on
-- the server outside the user's own user_texts row.
--
-- user_texts.story: what the reader needs besides the text of a story (the day it belongs
-- to, the target words with their Turkish glosses, the three questions). The user's own
-- row, under the RLS of user_texts; null for every other kind of text. Nullable, no
-- default: sync_push fills it from the row's JSON (jsonb_populate_record), so a row without
-- the key stores null.

-- ---------------------------------------------------------------------------
-- story_usage
-- ---------------------------------------------------------------------------

create table public.story_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  stories integer not null default 0 check (stories >= 0),
  retries integer not null default 0 check (retries >= 0),
  primary key (user_id, day)
);

alter table public.story_usage enable row level security;
revoke all on table public.story_usage from anon, authenticated;
-- No policies: service role only.

-- Atomically takes one story (p_retry false) or one regeneration (p_retry true) from today's
-- budget (UTC day). A regeneration needs a story made today and is allowed once per story.
-- Returns {allowed, used, limit}: stories made today and the daily story limit.
create or replace function public.story_consume(p_user uuid, p_retry boolean, p_limit integer)
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
  if p_user is null or p_retry is null or p_limit is null or p_limit < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  if p_retry then
    update public.story_usage as u
      set retries = u.retries + 1
      where u.user_id = p_user and u.day = v_day and u.retries + 1 <= u.stories
      returning stories into v_used;
  else
    insert into public.story_usage as u (user_id, day, stories)
    values (p_user, v_day, 1)
    on conflict (user_id, day) do update
      set stories = u.stories + 1
      where u.stories + 1 <= p_limit
    returning stories into v_used;
  end if;

  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select stories into v_used from public.story_usage where user_id = p_user and day = v_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.story_consume(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.story_consume(uuid, boolean, integer) to service_role;

-- Gives back what story_consume took when no story came of it (the model failed, the text
-- budget was used up). Never below zero.
create or replace function public.story_refund(p_user uuid, p_retry boolean)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user is null or p_retry is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_retry then
    update public.story_usage set retries = greatest(retries - 1, 0)
      where user_id = p_user and day = v_day;
  else
    update public.story_usage
      set stories = greatest(stories - 1, 0), retries = least(retries, greatest(stories - 1, 0))
      where user_id = p_user and day = v_day;
  end if;
end;
$$;

revoke all on function public.story_refund(uuid, boolean) from public, anon, authenticated;
grant execute on function public.story_refund(uuid, boolean) to service_role;

-- Daily counters are kept for 90 days, as the other usage counters.
create or replace function public.purge_story_usage(p_days integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.story_usage
  where day < (now() at time zone 'utc')::date - greatest(p_days, 1);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_story_usage(integer) from public, anon, authenticated;
grant execute on function public.purge_story_usage(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-story-usage', '31 3 * * *', 'select public.purge_story_usage(90)');
  else
    raise notice 'pg_cron is not available: schedule public.purge_story_usage(90) manually';
  end if;
exception when others then
  raise notice 'could not schedule the story usage purge with pg_cron (%): schedule public.purge_story_usage(90) manually', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_texts.story
-- ---------------------------------------------------------------------------

alter table public.user_texts
  add column story jsonb
    check (story is null or (jsonb_typeof(story) = 'object' and octet_length(story::text) <= 32768));

comment on column public.user_texts.story is
  'v0.5 İP8: the daily story''s day, target words, glosses and questions (kind story only).';
