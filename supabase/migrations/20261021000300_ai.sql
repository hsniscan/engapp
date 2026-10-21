-- Engapp: AI bookkeeping. Service role only (edge functions); clients have no access.

-- Per-user daily AI call counter (UTC days). Only real model calls are counted:
-- chunk-cache hits and lexicon hits are free.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
-- Users may read their own counter (for a "x / 200 today" display); never write it.
grant select on table public.ai_usage to authenticated;
create policy "own usage: select" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- Atomically takes one call from today's budget. Returns {allowed, used, limit}.
-- Concurrent requests cannot overshoot: the conditional upsert row-locks the counter.
create or replace function public.ai_consume(p_user uuid, p_limit integer, p_cost integer default 1)
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
  if p_user is null or p_limit is null or p_cost is null or p_cost < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  insert into public.ai_usage as u (user_id, day, calls)
  values (p_user, v_day, p_cost)
  on conflict (user_id, day) do update
    set calls = u.calls + excluded.calls
    where u.calls + excluded.calls <= p_limit
  returning calls into v_used;

  if v_used is not null and v_used <= p_limit then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;

  if v_used is not null then
    -- Fresh row but p_cost > p_limit: undo.
    delete from public.ai_usage where user_id = p_user and day = v_day;
    v_used := 0;
  else
    select calls into v_used from public.ai_usage where user_id = p_user and day = v_day;
  end if;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.ai_consume(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_consume(uuid, integer, integer) to service_role;

-- Server-side chunk result cache, per user, so the same text never calls the model twice,
-- even from another device. Keyed by SHA-256 of the chunk (verified server-side),
-- prompt version and CEFR level (the level changes which words are skipped).
-- Per user on purpose: a shared cache would reveal whether anyone imported a given text.
-- `result` holds validated candidates with lexicon ids only; lexicon content is joined
-- fresh on every hit. Rows expire after 90 days (purge_tombstones()).
create table public.ai_chunk_cache (
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_hash text not null check (chunk_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  result jsonb not null,
  model text check (char_length(model) <= 100),
  created_at timestamptz not null default now(),
  primary key (user_id, chunk_hash, prompt_version, level)
);

create index ai_chunk_cache_created on public.ai_chunk_cache (created_at);

alter table public.ai_chunk_cache enable row level security;
revoke all on table public.ai_chunk_cache from anon, authenticated;
-- No policies: service role only.
