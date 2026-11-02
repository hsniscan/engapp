-- Engapp v0.5.2 (ADR 0063): a request that returns nothing gives its daily count back.
-- fetch-article: robots, paywall, timeout or no readable text no longer spend one of the
-- day's fetches. ai-extract: a model call that failed (busy, timeout, bad answer) no longer
-- counts, so the client's two retries of one chunk do not cost three calls.
-- Same shape as story_refund() (20261101000800): service role only, never below zero.

create or replace function public.article_refund(p_user uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  update public.article_usage set calls = greatest(calls - 1, 0)
    where user_id = p_user and day = v_day;
end;
$$;

revoke all on function public.article_refund(uuid) from public, anon, authenticated;
grant execute on function public.article_refund(uuid) to service_role;

create or replace function public.ai_refund(p_user uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  update public.ai_usage set calls = greatest(calls - 1, 0)
    where user_id = p_user and day = v_day;
end;
$$;

revoke all on function public.ai_refund(uuid) from public, anon, authenticated;
grant execute on function public.ai_refund(uuid) to service_role;
