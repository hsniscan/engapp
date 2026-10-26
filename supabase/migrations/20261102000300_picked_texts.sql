-- Engapp v0.5.1: "Kelimelerimle metin oluştur" (docs/decisions/0056-add-sheet-capture-compose.md).
--
-- The user picks 3–8 of their own words and ai-story writes a short text around them (a story,
-- a dialogue, a news item or an email). It has its own daily counter, apart from the day's
-- story (story_usage.stories, one a day): picked texts per user and UTC day (default 5,
-- PICKED_STORY_DAILY_LIMIT), plus one regeneration per text. Only counts live here, as for the
-- daily story: the words, the request and the text are never stored on the server outside the
-- user's own user_texts row.

alter table public.story_usage
  add column picked integer not null default 0 check (picked >= 0),
  add column picked_retries integer not null default 0 check (picked_retries >= 0);

comment on column public.story_usage.picked is
  'v0.5.1: texts made from the user''s picked words today (ai-story source picked).';
comment on column public.story_usage.picked_retries is
  'v0.5.1: regenerations of those texts today (at most one per text).';

-- Atomically takes one picked text (p_retry false) or one regeneration of one (p_retry true)
-- from today's budget (UTC day). Returns {allowed, used, limit}: picked texts made today.
create or replace function public.picked_story_consume(p_user uuid, p_retry boolean, p_limit integer)
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
      set picked_retries = u.picked_retries + 1
      where u.user_id = p_user and u.day = v_day and u.picked_retries + 1 <= u.picked
      returning picked into v_used;
  else
    insert into public.story_usage as u (user_id, day, picked)
    values (p_user, v_day, 1)
    on conflict (user_id, day) do update
      set picked = u.picked + 1
      where u.picked + 1 <= p_limit
    returning picked into v_used;
  end if;

  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select picked into v_used from public.story_usage where user_id = p_user and day = v_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.picked_story_consume(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.picked_story_consume(uuid, boolean, integer) to service_role;

-- Gives back what picked_story_consume took when no text came of it. Never below zero.
create or replace function public.picked_story_refund(p_user uuid, p_retry boolean)
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
    update public.story_usage set picked_retries = greatest(picked_retries - 1, 0)
      where user_id = p_user and day = v_day;
  else
    update public.story_usage
      set picked = greatest(picked - 1, 0),
          picked_retries = least(picked_retries, greatest(picked - 1, 0))
      where user_id = p_user and day = v_day;
  end if;
end;
$$;

revoke all on function public.picked_story_refund(uuid, boolean) from public, anon, authenticated;
grant execute on function public.picked_story_refund(uuid, boolean) to service_role;
