-- Engapp v0.4 wave 2: Kelime Bankası (word bank), decision 0038.
--
-- Every leveled word of the reference lists (ref_word_levels: CEFR-J A1–B2, Octanove C1/C2;
-- one row per lemma and part of speech) with its Turkish meaning(s) and one short English
-- example sentence with its Turkish translation per meaning. System content, never user text:
-- written once by the word-bank job (scripts/word-bank.ts, .github/workflows/word-bank.yml)
-- through the service role; readable by everyone, guests included (anon key), so the app can
-- download it once and work offline (Dexie `word_bank`, delta pulls by server_seq).
--
-- Meanings come from the shared lexicon when it already has a sense for the lemma and part of
-- speech (AGENTS.md rule 6); otherwise the job asks the model and stores the new senses in the
-- lexicon (lexicon_upsert, the same near-duplicate guard as the edge functions), so a card
-- added from the bank links to a lexicon sense like any other card.
--
-- Model calls count toward the monthly Claude budget of the picture pipeline (image_budget,
-- 80 % of CLAUDE_MONTHLY_CREDIT_USD): one hold per Message Batch, purpose 'wordbank'.

-- ---------------------------------------------------------------------------
-- word_bank: public content
-- ---------------------------------------------------------------------------

create sequence if not exists public.word_bank_seq as bigint;
revoke all on sequence public.word_bank_seq from public, anon, authenticated;

create table public.word_bank (
  lemma_norm text not null check (
    char_length(lemma_norm) between 1 and 120 and lemma_norm = lower(lemma_norm)),
  pos text not null check (pos in (
    'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun',
    'determiner', 'interjection', 'other')),
  -- Display spelling ("Monday"); the same word as lemma_norm.
  lemma text not null check (char_length(lemma) between 1 and 120 and lower(lemma) = lemma_norm),
  cefr text not null check (cefr in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  list_source text not null check (list_source in ('cefrj', 'octanove')),
  zipf numeric(4, 2) check (zipf between 0 and 9),
  lexicon_term_id uuid references public.lexicon_terms (id) on delete set null,
  -- [{meaning_tr, example_en, example_tr, sense_id}] in display order; sense_id = the lexicon
  -- sense (null only if it could not be stored). Checked in code (word-bank zod schema).
  senses jsonb not null check (
    jsonb_typeof(senses) = 'array'
    and jsonb_array_length(senses) between 1 and 3
    and pg_column_size(senses) <= 4000),
  -- A withdrawn row: devices delete it on the next pull.
  retired boolean not null default false,
  -- Who made it: null model = everything came from the lexicon (no model call).
  model text check (char_length(model) <= 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  primary key (lemma_norm, pos)
);

create index word_bank_server_seq on public.word_bank (server_seq);

-- Same idea as tg_stamp_lexicon_row: one lock so rows commit in seq order and a device's
-- cursor never skips a row. Only the job writes.
create or replace function public.tg_stamp_word_bank_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.word_bank', 0));
  new.server_seq := pg_catalog.nextval('public.word_bank_seq');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.tg_stamp_word_bank_row() from public, anon, authenticated;

create trigger stamp_word_bank_row before insert or update on public.word_bank
  for each row execute function public.tg_stamp_word_bank_row();

alter table public.word_bank enable row level security;
revoke all on table public.word_bank from anon, authenticated;
-- Only the columns the app needs (the job's bookkeeping stays private).
grant select (lemma_norm, pos, lemma, cefr, list_source, zipf, lexicon_term_id, senses, retired, server_seq)
  on public.word_bank to anon, authenticated;
create policy "word bank: read for everyone" on public.word_bank
  for select to anon, authenticated using (true);
-- No write policies: only the service role (the job) writes.

-- ---------------------------------------------------------------------------
-- job bookkeeping (service role only)
-- ---------------------------------------------------------------------------

-- One row per word the job has touched. Without a row (or 'queued') the word is pending.
create table public.word_bank_jobs (
  lemma_norm text not null,
  pos text not null,
  state text not null check (state in ('queued', 'submitted', 'done', 'failed')),
  -- Model answers tried so far (a failed quality check is retried until WORD_BANK_MAX_ATTEMPTS).
  attempt smallint not null default 0 check (attempt between 0 and 9),
  batch_id text check (char_length(batch_id) <= 200),
  custom_id text check (custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  last_error text check (char_length(last_error) <= 500),
  -- What the submitted request was built from (level, the lexicon senses it was given), so
  -- collect reads the answer against the same input even if the lexicon changed meanwhile.
  input jsonb check (input is null or (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 8000)),
  updated_at timestamptz not null default now(),
  primary key (lemma_norm, pos),
  check ((state = 'submitted') = (batch_id is not null))
);

create index word_bank_jobs_batch on public.word_bank_jobs (batch_id) where batch_id is not null;

-- One row per Message Batch: its budget hold and, once collected, its real cost.
create table public.word_bank_batches (
  id text primary key check (char_length(id) between 1 and 200),
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

alter table public.word_bank_jobs enable row level security;
alter table public.word_bank_batches enable row level security;
revoke all on table public.word_bank_jobs, public.word_bank_batches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- job functions (service role only)
-- ---------------------------------------------------------------------------

-- Words of the reference lists that still need a bank row, easiest and most frequent first:
-- [{lemma_norm, pos, cefr, source, zipf, attempt, problem}] (problem: why the last answer was
-- rejected, sent with the retry). A word in both lists takes CEFR-J; the
-- Turkish-learner correction applies while the list level is the one it was made for.
-- Words with a bank row, a submitted request or a final failure are left out.
create or replace function public.word_bank_pending(p_limit integer default 1000)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ref as (
    select distinct on (r.lemma_norm, r.pos)
      r.lemma_norm, r.pos, r.source,
      case when r.tr_cefr is not null and r.tr_base_cefr = r.cefr then r.tr_cefr else r.cefr end as cefr
    from public.ref_word_levels r
    order by r.lemma_norm, r.pos, (r.source = 'cefrj') desc
  ),
  todo as (
    select ref.lemma_norm, ref.pos, ref.cefr, ref.source, f.zipf, coalesce(j.attempt, 0) as attempt,
      j.last_error as problem
    from ref
    left join public.ref_word_freq f on f.lemma_norm = ref.lemma_norm
    left join public.word_bank_jobs j on j.lemma_norm = ref.lemma_norm and j.pos = ref.pos
    where not exists (
        select 1 from public.word_bank b where b.lemma_norm = ref.lemma_norm and b.pos = ref.pos)
      and (j.state is null or j.state = 'queued')
    order by public.cefr_rank(ref.cefr), f.zipf desc nulls last, ref.lemma_norm, ref.pos
    limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lemma_norm', t.lemma_norm, 'pos', t.pos, 'cefr', t.cefr, 'source', t.source,
    'zipf', t.zipf::double precision, 'attempt', t.attempt, 'problem', t.problem
  ) order by public.cefr_rank(t.cefr), t.zipf desc nulls last, t.lemma_norm, t.pos), '[]'::jsonb)
  from todo t
$$;

-- Stores finished bank rows and marks their jobs done. p_rows: [{lemma_norm, pos, lemma, cefr,
-- list_source, zipf, lexicon_term_id, senses, model, prompt_version, cost_usd}]. An unchanged
-- row is not rewritten (its server_seq stays, so devices do not pull it again). Returns the
-- number of rows inserted or changed.
create or replace function public.word_bank_put(p_rows jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'p_rows must be an array of at most 1000 rows' using errcode = '22023';
  end if;

  insert into public.word_bank as b (
    lemma_norm, pos, lemma, cefr, list_source, zipf, lexicon_term_id, senses, model,
    prompt_version, cost_usd)
  select x.lemma_norm, x.pos, x.lemma, x.cefr, x.list_source, x.zipf, x.lexicon_term_id,
         x.senses, x.model, x.prompt_version, coalesce(x.cost_usd, 0)
  from jsonb_to_recordset(p_rows) as x(
    lemma_norm text, pos text, lemma text, cefr text, list_source text, zipf numeric,
    lexicon_term_id uuid, senses jsonb, model text, prompt_version text, cost_usd numeric)
  on conflict (lemma_norm, pos) do update set
    lemma = excluded.lemma,
    cefr = excluded.cefr,
    list_source = excluded.list_source,
    zipf = excluded.zipf,
    lexicon_term_id = excluded.lexicon_term_id,
    senses = excluded.senses,
    retired = false,
    model = excluded.model,
    prompt_version = excluded.prompt_version,
    cost_usd = excluded.cost_usd
  where (b.lemma, b.cefr, b.list_source, b.zipf, b.lexicon_term_id, b.senses, b.retired)
    is distinct from (excluded.lemma, excluded.cefr, excluded.list_source, excluded.zipf,
                      excluded.lexicon_term_id, excluded.senses, false);
  get diagnostics n = row_count;

  insert into public.word_bank_jobs as j (lemma_norm, pos, state, attempt, batch_id, last_error, updated_at)
  select x.lemma_norm, x.pos, 'done', 0, null, null, now()
  from jsonb_to_recordset(p_rows) as x(lemma_norm text, pos text)
  on conflict (lemma_norm, pos) do update
    set state = 'done', batch_id = null, last_error = null, input = null, updated_at = now();

  return n;
end;
$$;

revoke all on function public.word_bank_pending(integer) from public, anon, authenticated;
revoke all on function public.word_bank_put(jsonb) from public, anon, authenticated;
grant execute on function public.word_bank_pending(integer) to service_role;
grant execute on function public.word_bank_put(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- budget: the word bank shares the monthly Claude cap of the picture pipeline
-- ---------------------------------------------------------------------------

alter table public.image_budget_holds drop constraint if exists image_budget_holds_purpose_check;
alter table public.image_budget_holds add constraint image_budget_holds_purpose_check
  check (purpose in ('instant', 'batch', 'check', 'visual', 'pilot', 'wordbank'));

-- Same as 20261025000200, but a word-bank hold also lives until its batch is collected
-- (hours to a day), so it is not released as stale either.
create or replace function public.image_budget_release_stale(p_older_than interval)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  h record;
  n integer := 0;
begin
  for h in
    select id, amount_usd from public.image_budget_holds
    where purpose not in ('batch', 'wordbank') and created_at < now() - p_older_than
  loop
    perform public.image_budget_settle(h.id, h.amount_usd);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.image_budget_release_stale(interval) from public, anon, authenticated;
grant execute on function public.image_budget_release_stale(interval) to service_role;
