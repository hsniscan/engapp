-- Engapp: shared dictionary (lexicon). One row per term and per (term, pos, sense).
--
-- Readable by every signed-in user, writable only by the service role (edge functions).
-- Never stores user data: no source sentences, no user text, no user ids.
--
-- Deduplication:
--   lexicon_terms.lemma_norm   unique  (normalizeLemma() in supabase/functions/_shared/text.ts)
--   lexicon_senses (term_id, pos, gloss_key) unique
--     gloss_key = glossKey(gloss_en): lower-case, ASCII-folded, stop words and
--     punctuation removed, light stemming, tokens de-duplicated and sorted.
--     "the land beside a river" and "Land beside rivers." share the key "beside land river".
--   Concurrent inserts: INSERT .. ON CONFLICT DO NOTHING, then SELECT the winner's id
--   (public.lexicon_upsert). Near-duplicates with different words are caught before the
--   insert by the edge function (token-set similarity against the term's existing senses).

create sequence if not exists public.lexicon_seq as bigint;

-- Same idea as tg_stamp_sync_row: one global lock so lexicon rows commit in seq order
-- and lexicon_pull cursors never skip a row. Lexicon writes are rare.
create or replace function public.tg_stamp_lexicon_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.lexicon', 0));
  new.server_seq := pg_catalog.nextval('public.lexicon_seq');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.tg_stamp_lexicon_row() from public, anon, authenticated;
revoke all on sequence public.lexicon_seq from public, anon, authenticated;

create table public.lexicon_terms (
  id uuid primary key default gen_random_uuid(),
  lemma text not null check (char_length(lemma) between 1 and 120),
  lemma_norm text not null unique check (
    char_length(lemma_norm) between 1 and 120
    and lemma_norm = lower(lemma_norm)
    and lemma_norm = btrim(lemma_norm)
  ),
  term_type text not null check (term_type in ('word', 'phrase', 'pattern')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0
);

create table public.lexicon_senses (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.lexicon_terms (id) on delete cascade,
  pos text not null check (pos in (
    'noun', 'verb', 'adjective', 'adverb', 'phrasal verb', 'idiom', 'phrase',
    'preposition', 'conjunction', 'pronoun', 'determiner', 'interjection', 'other'
  )),
  gloss_en text not null check (char_length(gloss_en) between 1 and 200),
  gloss_key text not null check (
    char_length(gloss_key) between 1 and 200
    and gloss_key ~ '^[a-z0-9]+( [a-z0-9]+)*$'
  ),
  meaning_tr text not null check (char_length(meaning_tr) between 1 and 120),
  ipa text check (char_length(ipa) <= 120),
  created_by_model text check (char_length(created_by_model) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  -- v0.4: images attach to a lexicon sense (shared by all users).
  image_path text check (char_length(image_path) <= 500),
  unique (term_id, pos, gloss_key)
);

create index lexicon_senses_seq on public.lexicon_senses (server_seq);
create index lexicon_senses_term on public.lexicon_senses (term_id);

create trigger stamp_lexicon_row before insert or update on public.lexicon_terms
  for each row execute function public.tg_stamp_lexicon_row();
create trigger stamp_lexicon_row before insert or update on public.lexicon_senses
  for each row execute function public.tg_stamp_lexicon_row();

-- A corrected lemma must reach devices that pull senses by cursor: touch the senses.
create or replace function public.tg_lexicon_term_touch_senses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.lemma, new.term_type) is distinct from (old.lemma, old.term_type) then
    update public.lexicon_senses set updated_at = now() where term_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_lexicon_term_touch_senses() from public, anon, authenticated;

create trigger touch_senses after update on public.lexicon_terms
  for each row execute function public.tg_lexicon_term_touch_senses();

alter table public.lexicon_terms enable row level security;
alter table public.lexicon_senses enable row level security;

revoke all on table public.lexicon_terms, public.lexicon_senses from anon, authenticated;
grant select on table public.lexicon_terms, public.lexicon_senses to authenticated;

create policy "lexicon: read for signed-in users" on public.lexicon_terms
  for select to authenticated using (true);
create policy "lexicon: read for signed-in users" on public.lexicon_senses
  for select to authenticated using (true);
-- No insert/update/delete policies: only the service role (which bypasses RLS) writes.

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------

-- Flat LexiconSense rows (shape of src/domain/types.ts LexiconSense; updated_at in ms).
create or replace view public.lexicon_entries
with (security_invoker = true)
as
select
  s.id,
  s.term_id,
  t.lemma,
  t.lemma_norm,
  t.term_type,
  s.pos,
  s.gloss_en,
  s.meaning_tr,
  s.ipa,
  (extract(epoch from greatest(s.updated_at, t.updated_at)) * 1000)::bigint as updated_at,
  s.server_seq
from public.lexicon_senses s
join public.lexicon_terms t on t.id = s.term_id;

revoke all on public.lexicon_entries from anon, authenticated;
grant select on public.lexicon_entries to authenticated;

-- Terms (with up to p_max_senses senses each) whose lemma_norm is in p_norms.
-- Used by the AI functions for the lexicon pre-match. Read-only, RLS applies.
create or replace function public.lexicon_find(p_norms text[], p_max_senses integer default 12)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'term_id', t.id,
      'lemma', t.lemma,
      'lemma_norm', t.lemma_norm,
      'term_type', t.term_type,
      'senses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'pos', s.pos,
          'gloss_en', s.gloss_en,
          'gloss_key', s.gloss_key,
          'meaning_tr', s.meaning_tr,
          'ipa', s.ipa,
          'updated_at', (extract(epoch from s.updated_at) * 1000)::bigint
        ) order by s.created_at, s.id)
        from (
          select * from public.lexicon_senses s2
          where s2.term_id = t.id
          order by s2.created_at, s2.id
          limit greatest(1, least(p_max_senses, 50))
        ) s
      ), '[]'::jsonb)
    ) order by t.lemma_norm), '[]'::jsonb)
  from public.lexicon_terms t
  where t.lemma_norm = any (p_norms[1:5000])
$$;

revoke all on function public.lexicon_find(text[], integer) from public, anon;
grant execute on function public.lexicon_find(text[], integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Write helper (service role only)
-- ---------------------------------------------------------------------------

-- p_items: [{lemma, lemma_norm, term_type, pos, gloss_en, gloss_key, meaning_tr, ipa, model}]
-- Returns, in input order: [{term_id, sense_id, term_created, sense_created}].
-- Idempotent and race-safe: a concurrent writer's row wins and its id is returned.
create or replace function public.lexicon_upsert(p_items jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  v_term_id uuid;
  v_sense_id uuid;
  v_term_created boolean;
  v_sense_created boolean;
  out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'p_items must be an array of at most 200 items' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.lexicon_terms (lemma, lemma_norm, term_type)
    values (item ->> 'lemma', item ->> 'lemma_norm', item ->> 'term_type')
    on conflict (lemma_norm) do nothing
    returning id into v_term_id;
    v_term_created := v_term_id is not null;
    if v_term_id is null then
      select id into strict v_term_id from public.lexicon_terms where lemma_norm = item ->> 'lemma_norm';
    end if;

    v_sense_id := null;
    v_sense_created := false;
    if item ? 'gloss_key' and item ->> 'gloss_key' is not null then
      insert into public.lexicon_senses (term_id, pos, gloss_en, gloss_key, meaning_tr, ipa, created_by_model)
      values (
        v_term_id, item ->> 'pos', item ->> 'gloss_en', item ->> 'gloss_key',
        item ->> 'meaning_tr', nullif(item ->> 'ipa', ''), item ->> 'model'
      )
      on conflict (term_id, pos, gloss_key) do nothing
      returning id into v_sense_id;
      v_sense_created := v_sense_id is not null;
      if v_sense_id is null then
        select id into strict v_sense_id from public.lexicon_senses
        where term_id = v_term_id and pos = item ->> 'pos' and gloss_key = item ->> 'gloss_key';
      end if;
    end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'term_id', v_term_id,
      'sense_id', v_sense_id,
      'term_created', v_term_created,
      'sense_created', v_sense_created
    ));
  end loop;
  return out;
end;
$$;

revoke all on function public.lexicon_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.lexicon_upsert(jsonb) to service_role;
