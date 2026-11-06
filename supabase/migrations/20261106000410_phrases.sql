-- Engapp v0.5.3 C4 (decision 0074): phrasal verbs and collocations in the Kelime Bankası.
--
-- The reference lists (CEFR-J, Octanove) hold almost no phrasal verbs or collocations. A
-- candidate list is built once by scripts/build-phrases.ts (word-bank workflow, job
-- `phrases`): phrasal-verb headwords from Wiktionary's "English phrasal verbs" category
-- (CC BY-SA 4.0; only the headword list is used) and verb/adjective + noun collocations from
-- the word bank's own words, both ranked by how often they occur in the Tatoeba English
-- sentences (CC BY 2.0 FR) and, when given, Simple English Wikipedia (CC BY-SA 4.0). The top
-- ~500 phrasal verbs and ~300 collocations are stored in ref_phrases with a level from their
-- frequency band. The normal word-bank job then gives them Turkish meanings and examples
-- (word_bank_pending lists them after this migration) and the review pass checks them.
--
-- word_bank gains two parts of speech, 'phrasal verb' and 'phrase' (the lexicon's own names),
-- and two list sources, 'wiktionary' and 'corpus'. Older app versions skip rows they do not
-- know; the new app re-reads the bank once (Dexie v42).

-- ---------------------------------------------------------------------------
-- ref_phrases
-- ---------------------------------------------------------------------------

create table public.ref_phrases (
  lemma_norm text primary key check (
    char_length(lemma_norm) between 3 and 60 and lemma_norm = lower(lemma_norm)
    and lemma_norm ~ '^[a-z]+(?:[ ''-][a-z]+){1,4}$'),
  pos text not null check (pos in ('phrasal verb', 'phrase')),
  cefr text not null check (cefr in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  -- Estimated Zipf value of the whole phrase (log10 of occurrences per billion words).
  zipf numeric(4, 2) check (zipf between 0 and 9),
  source text not null check (source in ('wiktionary', 'corpus')),
  -- Occurrences counted in the corpora (particle split included for phrasal verbs).
  corpus_count integer not null default 0 check (corpus_count >= 0),
  source_version text not null check (char_length(source_version) between 1 and 60),
  updated_at timestamptz not null default now()
);

alter table public.ref_phrases enable row level security;
revoke all on table public.ref_phrases from anon, authenticated;

-- Service role only. p_rows: [{lemma_norm, pos, cefr, zipf, source, corpus_count,
-- source_version}], at most 2000. With p_replace, rows of the same parts of speech that are not
-- in p_rows and have no bank row yet are removed (a rebuild may rank other phrases higher).
-- Returns {stored, removed}.
create or replace function public.ref_phrases_put(p_rows jsonb, p_replace boolean default false)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  n_stored integer;
  n_removed integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'p_rows must be an array of at most 2000 rows' using errcode = '22023';
  end if;
  insert into public.ref_phrases as r (lemma_norm, pos, cefr, zipf, source, corpus_count, source_version, updated_at)
  select x.lemma_norm, x.pos, x.cefr, x.zipf, x.source, coalesce(x.corpus_count, 0), x.source_version, now()
  from jsonb_to_recordset(p_rows) as x(
    lemma_norm text, pos text, cefr text, zipf numeric, source text, corpus_count integer,
    source_version text)
  on conflict (lemma_norm) do update set
    pos = excluded.pos, cefr = excluded.cefr, zipf = excluded.zipf, source = excluded.source,
    corpus_count = excluded.corpus_count, source_version = excluded.source_version,
    updated_at = now();
  get diagnostics n_stored = row_count;
  if p_replace then
    delete from public.ref_phrases r
    where r.pos in (select distinct x ->> 'pos' from jsonb_array_elements(p_rows) x)
      and r.lemma_norm not in (select x ->> 'lemma_norm' from jsonb_array_elements(p_rows) x)
      and not exists (select 1 from public.word_bank b where b.lemma_norm = r.lemma_norm and b.pos = r.pos);
    get diagnostics n_removed = row_count;
  end if;
  return jsonb_build_object('stored', n_stored, 'removed', n_removed);
end;
$$;

revoke all on function public.ref_phrases_put(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ref_phrases_put(jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- word_bank: two more parts of speech and list sources
-- ---------------------------------------------------------------------------

alter table public.word_bank drop constraint if exists word_bank_pos_check;
alter table public.word_bank add constraint word_bank_pos_check check (pos in (
  'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun',
  'determiner', 'interjection', 'other', 'phrasal verb', 'phrase'));
alter table public.word_bank drop constraint if exists word_bank_list_source_check;
alter table public.word_bank add constraint word_bank_list_source_check
  check (list_source in ('cefrj', 'octanove', 'wiktionary', 'corpus'));

-- Same as 20261026001100, plus the phrases of ref_phrases (their own level and Zipf value).
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
      case when r.tr_cefr is not null and r.tr_base_cefr = r.cefr then r.tr_cefr else r.cefr end as cefr,
      f.zipf
    from public.ref_word_levels r
    left join public.ref_word_freq f on f.lemma_norm = r.lemma_norm
    order by r.lemma_norm, r.pos, (r.source = 'cefrj') desc
  ),
  allrefs as (
    select ref.lemma_norm, ref.pos, ref.source, ref.cefr, ref.zipf from ref
    union all
    select p.lemma_norm, p.pos, p.source, p.cefr, p.zipf from public.ref_phrases p
  ),
  todo as (
    select a.lemma_norm, a.pos, a.cefr, a.source, a.zipf, coalesce(j.attempt, 0) as attempt,
      j.last_error as problem
    from allrefs a
    left join public.word_bank_jobs j on j.lemma_norm = a.lemma_norm and j.pos = a.pos
    where not exists (
        select 1 from public.word_bank b where b.lemma_norm = a.lemma_norm and b.pos = a.pos)
      and (j.state is null or j.state = 'queued')
    order by public.cefr_rank(a.cefr), a.zipf desc nulls last, a.lemma_norm, a.pos
    limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lemma_norm', t.lemma_norm, 'pos', t.pos, 'cefr', t.cefr, 'source', t.source,
    'zipf', t.zipf::double precision, 'attempt', t.attempt, 'problem', t.problem
  ) order by public.cefr_rank(t.cefr), t.zipf desc nulls last, t.lemma_norm, t.pos), '[]'::jsonb)
  from todo t
$$;

revoke all on function public.word_bank_pending(integer) from public, anon, authenticated;
grant execute on function public.word_bank_pending(integer) to service_role;
