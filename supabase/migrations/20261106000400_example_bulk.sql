-- Engapp v0.5.3 C2 (decision 0074): bulk example sentences for the word-bank senses.
--
-- About three shared example sentences per Kelime Bankası sense, written once by an offline job
-- (scripts/examples-bulk.ts, .github/workflows/examples-bulk.yml) and shipped through the
-- existing lexicon_examples table, so the app shows them on card fronts (rotation) and in the
-- "Örnek cümleler" tabs without any change to how they sync, and the pronunciation job
-- (tts-pregen, which reads every active lexicon_examples row) voices them too.
--
-- Pipeline: (1) English–Turkish pairs from Tatoeba (CC BY 2.0 FR) that contain the word are
-- matched to the word's senses by a cheap model pass; (2) the model writes only what Tatoeba
-- could not fill; (3) a stronger model reviews every sentence for natural Turkish and for
-- showing this sense; (4) approved sentences are inserted into lexicon_examples.
--
-- 1. lexicon_examples gains `source` ('tatoeba'; null = written by a model) and `attribution`
--    (Tatoeba sentence ids and authors, required by CC BY), returned to devices by
--    lexicon_example_json, and lexicon_examples_insert accepts both.
-- 2. Job bookkeeping (service role only): example_bulk_rows (one per bank row: tag and
--    generation step), example_bulk_items (one per candidate sentence), example_bulk_batches
--    (one per Message Batch, with its budget hold and cost: the job's own spending cap).
-- 3. example_bulk_targets / example_bulk_sense_counts: what the job reads.

-- ---------------------------------------------------------------------------
-- 1. lexicon_examples: source and attribution
-- ---------------------------------------------------------------------------

alter table public.lexicon_examples
  add column if not exists source text check (source is null or source in ('tatoeba')),
  add column if not exists attribution jsonb check (
    attribution is null or (jsonb_typeof(attribution) = 'object' and pg_column_size(attribution) <= 1000));

-- Same shape as 20261022000100, plus source and attribution (null for model-written rows).
-- Older clients drop the unknown keys.
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
    'updated_at', (extract(epoch from e.updated_at) * 1000)::bigint,
    'source', e.source,
    'attribution', e.attribution
  )
$$;

revoke all on function public.lexicon_example_json(public.lexicon_examples) from public, anon;
grant execute on function public.lexicon_example_json(public.lexicon_examples) to authenticated, service_role;

-- Same as 20261022000100, plus the optional item keys source and attribution.
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
      (sense_id, context, level_band, text_en, span, translations, model, prompt_version,
       source, attribution)
    values (
      (item ->> 'sense_id')::uuid,
      item ->> 'context',
      item ->> 'level_band',
      item ->> 'text_en',
      array[(item -> 'span' ->> 0)::integer, (item -> 'span' ->> 1)::integer],
      coalesce(item -> 'translations', '{}'::jsonb),
      item ->> 'model',
      item ->> 'prompt_version',
      item ->> 'source',
      case when jsonb_typeof(item -> 'attribution') = 'object' then item -> 'attribution' end
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

-- ---------------------------------------------------------------------------
-- 2. job bookkeeping (service role only)
-- ---------------------------------------------------------------------------

-- One row per bank row the job has touched: the Tatoeba sense-tagging request and the
-- generation request (at most one of each in flight).
create table public.example_bulk_rows (
  lemma_norm text not null,
  pos text not null,
  tag_batch_id text check (char_length(tag_batch_id) <= 200),
  tag_custom_id text check (tag_custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  tag_attempts smallint not null default 0 check (tag_attempts between 0 and 9),
  gen_batch_id text check (char_length(gen_batch_id) <= 200),
  gen_custom_id text check (gen_custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  gen_attempts smallint not null default 0 check (gen_attempts between 0 and 9),
  -- What the generation request asked for (the senses and how many sentences each).
  gen_input jsonb check (gen_input is null or (jsonb_typeof(gen_input) = 'object' and pg_column_size(gen_input) <= 8000)),
  last_error text check (char_length(last_error) <= 500),
  updated_at timestamptz not null default now(),
  primary key (lemma_norm, pos)
);

create index example_bulk_rows_tag on public.example_bulk_rows (tag_batch_id) where tag_batch_id is not null;
create index example_bulk_rows_gen on public.example_bulk_rows (gen_batch_id) where gen_batch_id is not null;

-- One row per candidate sentence of a bank row. States:
--   candidate   a Tatoeba pair, not yet matched to a sense
--   tag_sent    in a tagging batch
--   spare       a good Tatoeba pair the sense does not need now (promoted when one is rejected)
--   dropped     not a fit (no sense, unnatural, duplicate)
--   kept        chosen for a sense (Tatoeba, or written by the model), waiting for the review
--   review_sent in a review batch
--   approved    reviewed, waiting to be published
--   rejected    the review turned it down
--   published   inserted into lexicon_examples (example_id)
create table public.example_bulk_items (
  id uuid primary key default gen_random_uuid(),
  lemma_norm text not null,
  pos text not null,
  sense_id uuid references public.lexicon_senses (id) on delete cascade,
  state text not null check (state in (
    'candidate', 'tag_sent', 'spare', 'dropped', 'kept', 'review_sent', 'approved', 'rejected',
    'published')),
  source text not null check (source in ('tatoeba', 'model')),
  context text check (context is null or context ~ '^[a-z][a-z_]{1,31}$'),
  level_band text check (level_band is null or level_band in ('A2', 'B1', 'B2', 'C1')),
  text_en text not null check (char_length(text_en) between 1 and 300),
  text_tr text check (char_length(text_tr) between 1 and 300),
  -- Same rule as lexicon_examples.text_key: one candidate per sentence and bank row.
  text_key text generated always as (
    pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(text_en), '[^[:alnum:]]+', ' ', 'g'))
  ) stored,
  -- Tatoeba: {license, en_id, en_by, tr_id, tr_by[, tr_edited]}.
  attribution jsonb check (
    attribution is null or (jsonb_typeof(attribution) = 'object' and pg_column_size(attribution) <= 1000)),
  -- Matcher score (lower = better: shorter, easier); model-written rows 0.
  score real not null default 0,
  model text check (char_length(model) <= 100),
  prompt_version text check (char_length(prompt_version) <= 40),
  review_batch_id text check (char_length(review_batch_id) <= 200),
  review_custom_id text check (review_custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  review_attempts smallint not null default 0 check (review_attempts between 0 and 9),
  review_note text check (char_length(review_note) <= 200),
  example_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lemma_norm, pos, text_key)
);

create index example_bulk_items_state on public.example_bulk_items (state, lemma_norm, pos);
create index example_bulk_items_sense on public.example_bulk_items (sense_id) where sense_id is not null;
create index example_bulk_items_review on public.example_bulk_items (review_batch_id) where review_batch_id is not null;

-- One row per Message Batch of the job (step tag | generate | review).
create table public.example_bulk_batches (
  id text primary key check (char_length(id) between 1 and 200),
  step text not null check (step in ('tag', 'generate', 'review')),
  hold_id uuid,
  reserved_usd numeric(12, 6) not null check (reserved_usd >= 0),
  requests integer not null check (requests > 0),
  model text not null check (char_length(model) <= 100),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  state text not null default 'submitted' check (state in ('submitted', 'collected')),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  collected_at timestamptz
);

alter table public.example_bulk_rows enable row level security;
alter table public.example_bulk_items enable row level security;
alter table public.example_bulk_batches enable row level security;
revoke all on table public.example_bulk_rows, public.example_bulk_items, public.example_bulk_batches
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. what the job reads (service role only)
-- ---------------------------------------------------------------------------

-- Live bank rows after (p_after_lemma, p_after_pos), in key order, with the active shared
-- sentences each sense already has: [{lemma_norm, pos, lemma, cefr, senses: [{sense_id,
-- meaning_tr, example_en}], active: {sense_id: [text_en, ...]}}]. At most 2000 per page.
create or replace function public.example_bulk_targets(
  p_after_lemma text default '', p_after_pos text default '', p_limit integer default 1000)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select b.lemma_norm, b.pos, b.lemma, b.cefr, b.senses
    from public.word_bank b
    where not b.retired
      and (b.lemma_norm, b.pos) > (coalesce(p_after_lemma, ''), coalesce(p_after_pos, ''))
    order by b.lemma_norm, b.pos
    limit least(greatest(coalesce(p_limit, 1000), 1), 2000)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lemma_norm', p.lemma_norm, 'pos', p.pos, 'lemma', p.lemma, 'cefr', p.cefr,
    'senses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sense_id', s ->> 'sense_id', 'meaning_tr', s ->> 'meaning_tr', 'example_en', s ->> 'example_en')),
        '[]'::jsonb)
      from jsonb_array_elements(p.senses) s
      where s ->> 'sense_id' is not null),
    'active', (
      select coalesce(jsonb_object_agg(x.sense_id, x.texts), '{}'::jsonb)
      from (
        select e.sense_id::text as sense_id, jsonb_agg(e.text_en order by e.created_at) as texts
        from public.lexicon_examples e
        where e.status = 'active'
          and e.sense_id in (
            select (s ->> 'sense_id')::uuid from jsonb_array_elements(p.senses) s
            where s ->> 'sense_id' is not null)
        group by e.sense_id
      ) x)
  ) order by p.lemma_norm, p.pos), '[]'::jsonb)
  from page p
$$;

-- Per sense, how many job sentences are in each state: {sense_id: {state: n}}.
create or replace function public.example_bulk_sense_counts()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.sense_id, x.states), '{}'::jsonb)
  from (
    select c.sense_id::text as sense_id, jsonb_object_agg(c.state, c.n) as states
    from (
      select i.sense_id, i.state, count(*) as n
      from public.example_bulk_items i
      where i.sense_id is not null
      group by i.sense_id, i.state
    ) c
    group by c.sense_id
  ) x
$$;

-- What the job has spent and reserved so far (its own cap, EXAMPLES_BULK_CAP_USD).
create or replace function public.example_bulk_spent()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when b.state = 'collected' then coalesce(b.cost_usd, 0) else b.reserved_usd end), 0)
  from public.example_bulk_batches b
$$;

revoke all on function public.example_bulk_targets(text, text, integer) from public, anon, authenticated;
revoke all on function public.example_bulk_sense_counts() from public, anon, authenticated;
revoke all on function public.example_bulk_spent() from public, anon, authenticated;
grant execute on function public.example_bulk_targets(text, text, integer) to service_role;
grant execute on function public.example_bulk_sense_counts() to service_role;
grant execute on function public.example_bulk_spent() to service_role;
