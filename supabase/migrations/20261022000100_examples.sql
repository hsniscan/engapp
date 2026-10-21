-- Engapp v0.2 İP5: example sentences in several contexts (docs/decisions/0013).
--
-- lexicon_examples   shared, AI-written example sentences per lexicon sense, context and
--                    level band. Readable by every signed-in user, written only by the
--                    service role (ai-examples). Never holds user text.
-- content_feedback   the user's verdict on a piece of content (like / skip / reject). Synced.
-- user_content       text the user wrote or corrected (edited example sentences now,
--                    mnemonics in İP6). Synced, private to the user, never copied to a
--                    shared table.
-- settings           example_tr_visible, example_contexts (nullable: older clients leave them out).
--
-- content_feedback and user_content are registered in public.sync_tables (migration
-- 20261021000900), so sync_push / sync_pull_v3 / purge_tombstones handle them without new
-- sync functions. sync_pull and sync_pull_v2 keep returning the six v0.1 tables.

-- ---------------------------------------------------------------------------
-- lexicon_examples
-- ---------------------------------------------------------------------------

create table public.lexicon_examples (
  id uuid primary key default gen_random_uuid(),
  sense_id uuid not null references public.lexicon_senses (id) on delete cascade,
  -- Open list (src: _shared/examples-contracts.ts EXAMPLE_CONTEXTS); only the format is fixed
  -- here so a new context needs no migration.
  context text not null check (context ~ '^[a-z][a-z_]{1,31}$'),
  level_band text not null check (level_band in ('A2', 'B1', 'B2', 'C1')),
  text_en text not null check (char_length(text_en) between 1 and 300),
  -- Duplicate key: lower-case, every run of non-alphanumerics folded to one space.
  -- Same rule as exampleTextKey() in supabase/functions/_shared/examples.ts.
  text_key text generated always as (
    pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(text_en), '[^[:alnum:]]+', ' ', 'g'))
  ) stored,
  -- [start, end) of the term in text_en, computed by the server.
  span integer[] not null check (
    array_ndims(span) = 1 and cardinality(span) = 2
    and span[1] >= 0 and span[2] > span[1] and span[2] <= char_length(text_en)
  ),
  -- {"tr": "..."}: one entry per language, so other language pairs need no new column.
  translations jsonb not null default '{}'::jsonb check (
    jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 4000
  ),
  model text check (char_length(model) <= 100),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  unique (sense_id, text_key)
);

create index lexicon_examples_lookup on public.lexicon_examples (sense_id, level_band, context)
  where status = 'active';
create index lexicon_examples_seq on public.lexicon_examples (server_seq);

-- Same stamp as lexicon_terms / lexicon_senses: the shared lexicon_seq under the lexicon
-- lock, so lexicon_examples_pull cursors never skip a row.
create trigger stamp_lexicon_row before insert or update on public.lexicon_examples
  for each row execute function public.tg_stamp_lexicon_row();

alter table public.lexicon_examples enable row level security;
revoke all on table public.lexicon_examples from anon, authenticated;
grant select on table public.lexicon_examples to authenticated;
create policy "lexicon: read for signed-in users" on public.lexicon_examples
  for select to authenticated using (true);
-- No insert/update/delete policies: only the service role (which bypasses RLS) writes.

-- Row shape of the client (src/domain/types.ts LexiconExample; updated_at in epoch ms).
create or replace function public.lexicon_example_json(e public.lexicon_examples)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'sense_id', e.sense_id,
    'context', e.context,
    'level_band', e.level_band,
    'text_en', e.text_en,
    'span', to_jsonb(e.span),
    'translations', e.translations,
    'status', e.status,
    'updated_at', (extract(epoch from e.updated_at) * 1000)::bigint
  )
$$;

revoke all on function public.lexicon_example_json(public.lexicon_examples) from public, anon;
grant execute on function public.lexicon_example_json(public.lexicon_examples) to authenticated, service_role;

-- Active examples of these senses (at most 200 ids); p_band null = every band. ai-examples
-- looks here before it calls the model.
create or replace function public.lexicon_examples_find(p_sense_ids uuid[], p_band text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.lexicon_example_json(e) order by e.created_at, e.id), '[]'::jsonb)
  from public.lexicon_examples e
  where e.sense_id = any (p_sense_ids[1:200])
    and e.status = 'active'
    and (p_band is null or e.level_band = p_band)
$$;

revoke all on function public.lexicon_examples_find(uuid[], text) from public, anon;
grant execute on function public.lexicon_examples_find(uuid[], text) to authenticated, service_role;

-- Service role only. p_items: [{sense_id, context, level_band, text_en, span: [s, e],
-- translations: {tr}, model, prompt_version}], at most 64. A sentence the sense already has
-- (same text_key) is skipped. Returns the inserted rows, in input order.
create or replace function public.lexicon_examples_insert(p_items jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  v_row public.lexicon_examples;
  out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 64 then
    raise exception 'p_items must be an array of at most 64 items' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.lexicon_examples
      (sense_id, context, level_band, text_en, span, translations, model, prompt_version)
    values (
      (item ->> 'sense_id')::uuid,
      item ->> 'context',
      item ->> 'level_band',
      item ->> 'text_en',
      array[(item -> 'span' ->> 0)::integer, (item -> 'span' ->> 1)::integer],
      coalesce(item -> 'translations', '{}'::jsonb),
      item ->> 'model',
      item ->> 'prompt_version'
    )
    on conflict (sense_id, text_key) do nothing
    returning * into v_row;
    if found then
      out := out || jsonb_build_array(public.lexicon_example_json(v_row));
    end if;
  end loop;
  return out;
end;
$$;

revoke all on function public.lexicon_examples_insert(jsonb) from public, anon, authenticated;
grant execute on function public.lexicon_examples_insert(jsonb) to service_role;

-- Examples (active and retired, every band) of the lexicon senses the caller's senses
-- point to, with lexicon server_seq > p_since. Same page contract as lexicon_pull:
-- {rows, next_seq, has_more}. Retired rows tell devices to drop them from their cache.
-- A sense newly referenced below the device's cursor is filled by the device's example
-- queue (ai-examples answers it from this table without a model call).
create or replace function public.lexicon_examples_pull(p_since bigint default 0, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_rows jsonb;
  v_count integer;
  v_next bigint;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with page as (
    select e as r, e.server_seq as seq from public.lexicon_examples e
    where e.server_seq > v_since
      and e.sense_id in (select s.lexicon_sense_id from public.senses s
                         where s.user_id = v_uid and s.lexicon_sense_id is not null)
    order by e.server_seq
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by seq) as rn from page
  )
  select
    coalesce(jsonb_agg(public.lexicon_example_json(n.r) order by n.seq)
      filter (where n.rn <= v_limit), '[]'::jsonb),
    count(*),
    max(n.seq) filter (where n.rn <= v_limit)
  into v_rows, v_count, v_next
  from numbered n;

  return jsonb_build_object('rows', v_rows, 'next_seq', coalesce(v_next, v_since), 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.lexicon_examples_pull(bigint, integer) from public, anon;
grant execute on function public.lexicon_examples_pull(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- content_feedback, user_content (synced, per user)
-- ---------------------------------------------------------------------------
-- Primary key (user_id, id): the client derives the id of a feedback row from what it is
-- about (one row per target, so two devices write the same row and last-writer-wins
-- settles it). The same target gets the same id for every user; the user id keeps them
-- apart. Checks are loose (a rejected row would wait in the outbox forever).

create table public.content_feedback (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'example' (lexicon_examples), 'user_content', later 'mnemonic', 'false_friend', 'theme'.
  target_kind text not null check (target_kind ~ '^[a-z][a-z_]{1,31}$'),
  target_id uuid not null,
  verdict text not null check (verdict in ('like', 'skip', 'reject')),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index content_feedback_user_seq on public.content_feedback (user_id, server_seq);
create index content_feedback_purge on public.content_feedback (server_updated_at) where deleted_at is not null;

create table public.user_content (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'example_sentence' now; 'mnemonic' and more later (İP6).
  kind text not null check (kind ~ '^[a-z][a-z_]{1,31}$'),
  -- What the content is about: a lexicon sense (shared meaning) and/or the user's own sense.
  lexicon_sense_id uuid,
  sense_id uuid,
  context text check (context is null or context ~ '^[a-z][a-z_]{1,31}$'),
  -- The shared item this text corrects (lexicon_examples.id for an edited sentence).
  replaces_id uuid,
  text text not null check (char_length(text) between 1 and 1000),
  translations jsonb check (
    translations is null or (jsonb_typeof(translations) = 'object' and pg_column_size(translations) <= 4000)
  ),
  span integer[] check (
    span is null
    or (array_ndims(span) = 1 and cardinality(span) = 2 and span[1] >= 0 and span[2] >= span[1])
  ),
  selected boolean,
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  deleted_at bigint check (deleted_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index user_content_user_seq on public.user_content (user_id, server_seq);
create index user_content_purge on public.user_content (server_updated_at) where deleted_at is not null;

do $$
declare
  t text;
begin
  foreach t in array array['content_feedback', 'user_content'] loop
    execute format(
      'create trigger stamp_sync_row before insert or update on public.%I
         for each row execute function public.tg_stamp_sync_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    -- Deletion is a tombstone (deleted_at), purged by purge_tombstones(): no DELETE grant.
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;
end;
$$;

insert into public.sync_tables (name, insert_only, conflict_key) values
  ('content_feedback', false, '(user_id, id)'),
  ('user_content', false, '(user_id, id)');

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------
-- Nullable on purpose: an older client upserts settings without these keys
-- (jsonb_populate_record gives null), which must not be rejected. null = default
-- (translation hidden until tapped; the default context list).

alter table public.settings
  add column example_tr_visible boolean,
  add column example_contexts text[] check (
    example_contexts is null
    or cardinality(example_contexts) = 0
    or (cardinality(example_contexts) <= 12
        and array_to_string(example_contexts, ',') ~ '^[a-z][a-z_]{1,31}(,[a-z][a-z_]{1,31})*$')
  );
