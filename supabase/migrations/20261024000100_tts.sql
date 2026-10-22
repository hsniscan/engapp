-- Engapp: server pronunciation audio (docs/decisions/0028-server-tts.md).
-- Service role only (the `tts` edge function); clients have no access to anything here
-- except reading the public audio files.

-- ---------------------------------------------------------------------------
-- Daily budget of generated audio (cache misses), per user and UTC day. Separate from
-- ai_usage: pronunciations are cheap and frequent and must not use up the AI budget.
-- ---------------------------------------------------------------------------
create table public.tts_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);

alter table public.tts_usage enable row level security;
revoke all on table public.tts_usage from anon, authenticated;
-- No policies: service role only.

-- Atomically takes one generation from today's budget. Returns {allowed, used, limit}.
-- Same shape and locking as ai_consume().
create or replace function public.tts_consume(p_user uuid, p_limit integer)
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

  insert into public.tts_usage as u (user_id, day, calls)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1
    where u.calls + 1 <= p_limit
  returning calls into v_used;

  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select calls into v_used from public.tts_usage where user_id = p_user and day = v_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.tts_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.tts_consume(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Which texts may be read aloud. The server only speaks text the user can have on a card:
--   'public'  a shared lexicon headword or example sentence: cached for everyone;
--   'private' only on this user's own cards (their word, source sentence or edited
--             example): spoken, but never stored on the server;
--   null      anything else: refused.
-- p_text is already normalised by the function (NFC, whitespace folded, trimmed).
-- ---------------------------------------------------------------------------
create or replace function public.tts_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.normalize(p_text, 'NFC'), '\s+', ' ', 'g'))
$$;

-- Example sentences are looked up by their exact text.
create index if not exists lexicon_examples_text_en_hash on public.lexicon_examples using hash (text_en);

create or replace function public.tts_text_source(p_user uuid, p_text text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_text is null or pg_catalog.char_length(p_text) not between 1 and 300 then null
    when exists (
      select 1 from public.lexicon_terms t where t.lemma_norm = pg_catalog.lower(p_text)
    ) then 'public'
    when exists (
      select 1 from public.lexicon_examples e where e.text_en = p_text
    ) then 'public'
    when p_user is null then null
    when exists (
      select 1 from public.notes n
      where n.user_id = p_user and n.deleted_at is null
        and (n.term = p_text or n.term_norm = pg_catalog.lower(p_text))
    ) then 'private'
    when exists (
      select 1 from public.senses s
      where s.user_id = p_user and s.deleted_at is null and s.source_sentence is not null
        and public.tts_norm(s.source_sentence) = p_text
    ) then 'private'
    when exists (
      select 1 from public.user_content c
      where c.user_id = p_user and c.deleted_at is null and public.tts_norm(c.text) = p_text
    ) then 'private'
  end
$$;

revoke all on function public.tts_norm(text) from public, anon, authenticated;
grant execute on function public.tts_norm(text) to service_role;
revoke all on function public.tts_text_source(uuid, text) from public, anon, authenticated;
grant execute on function public.tts_text_source(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket for the shared audio: public read (files are named by a SHA-256 of
-- version + voice + text, so they can only be fetched, not listed), written only by the
-- service role (no storage.objects policies are added). Guarded because the local test
-- stack runs without the Storage service, whose own migrations add the newer columns.
-- ---------------------------------------------------------------------------
do $$
declare
  has_col boolean;
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is missing: the tts bucket is not created';
    return;
  end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) into has_col;
  if has_col then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('tts', 'tts', true, 4194304, array['audio/wav'])
      on conflict (id) do update
        set public = true,
            file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types
    $q$;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'
  ) then
    execute $q$
      insert into storage.buckets (id, name, public) values ('tts', 'tts', true)
      on conflict (id) do update set public = true
    $q$;
  else
    raise notice 'storage.buckets has no "public" column yet: the tts bucket is not created';
  end if;
exception
  -- Never block a deploy over the bucket: the function creates it on first use, and until
  -- then sends the audio inline.
  when insufficient_privilege then
    raise warning 'no privilege to create the tts bucket here: the function will create it';
end;
$$;
