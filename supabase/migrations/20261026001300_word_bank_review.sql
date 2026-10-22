-- Engapp v0.4: review (clean-up) pass of the Kelime Bankası rows, decision 0040.
--
-- The bank (20261026001100_word_bank.sql, decision 0038) was written by Claude Haiku; a check
-- by eye found about one meaning in twenty wrong. The review job (scripts/word-bank.ts
-- review-submit / review-collect) sends every row once more to a stronger model, in groups,
-- and applies its corrections. This migration adds only service-role bookkeeping and two
-- functions; public.word_bank itself is unchanged. A corrected row is updated in place, so its
-- server_seq moves (stamp trigger) and devices pull it again; a row with nothing left is
-- retired (devices delete it).

-- One row per reviewed (or in-flight) bank row. Without a row, or 'queued', the bank row still
-- needs its review.
create table public.word_bank_review (
  lemma_norm text not null,
  pos text not null,
  state text not null check (state in ('queued', 'submitted', 'done', 'failed')),
  -- Answers tried so far (a rejected correction is asked again once).
  attempt smallint not null default 0 check (attempt between 0 and 9),
  batch_id text check (char_length(batch_id) <= 200),
  -- The request (group of rows) this row went out in.
  custom_id text check (custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  last_error text check (char_length(last_error) <= 500),
  -- What was sent (the row as it was and its place in the group) while the batch runs.
  input jsonb check (input is null or (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 8000)),
  -- Once done: what the review did ({kept, fixed[{sense, old, new, reason}], dropped[...],
  -- rejected[], retired}) and the senses before a change, so a change can be undone by hand.
  outcome jsonb check (outcome is null or (jsonb_typeof(outcome) = 'object' and pg_column_size(outcome) <= 12000)),
  previous_senses jsonb check (previous_senses is null or jsonb_typeof(previous_senses) = 'array'),
  model text check (char_length(model) <= 100),
  prompt_version text check (char_length(prompt_version) <= 40),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (lemma_norm, pos),
  foreign key (lemma_norm, pos) references public.word_bank (lemma_norm, pos) on delete cascade,
  check ((state = 'submitted') = (batch_id is not null))
);

create index word_bank_review_batch on public.word_bank_review (batch_id) where batch_id is not null;

-- One row per review Message Batch: its budget hold and, once collected, its real cost. Kept
-- apart from word_bank_batches so the generation collect never reads a review batch.
create table public.word_bank_review_batches (
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

alter table public.word_bank_review enable row level security;
alter table public.word_bank_review_batches enable row level security;
revoke all on table public.word_bank_review, public.word_bank_review_batches from anon, authenticated;

-- Bank rows still to review, easiest level first: [{lemma_norm, pos, lemma, cefr, list_source,
-- zipf, lexicon_term_id, senses, attempt, problem}]. Retired rows, rows in flight and rows
-- given up are left out.
create or replace function public.word_bank_review_pending(p_limit integer default 1000)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with todo as (
    select b.lemma_norm, b.pos, b.lemma, b.cefr, b.list_source, b.zipf, b.lexicon_term_id, b.senses,
      coalesce(r.attempt, 0) as attempt, r.last_error as problem
    from public.word_bank b
    left join public.word_bank_review r on r.lemma_norm = b.lemma_norm and r.pos = b.pos
    where not b.retired and (r.state is null or r.state = 'queued')
    order by public.cefr_rank(b.cefr), b.zipf desc nulls last, b.lemma_norm, b.pos
    limit least(greatest(coalesce(p_limit, 1000), 1), 20000)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lemma_norm', t.lemma_norm, 'pos', t.pos, 'lemma', t.lemma, 'cefr', t.cefr,
    'list_source', t.list_source, 'zipf', t.zipf::double precision,
    'lexicon_term_id', t.lexicon_term_id, 'senses', t.senses,
    'attempt', t.attempt, 'problem', t.problem
  ) order by public.cefr_rank(t.cefr), t.zipf desc nulls last, t.lemma_norm, t.pos), '[]'::jsonb)
  from todo t
$$;

-- Applies reviewed rows. p_rows: [{lemma_norm, pos, expected, senses, retire, lexicon_term_id,
-- attempt, outcome, model, prompt_version, cost_usd}]. A bank row is changed only while it
-- still has the reviewed senses (`expected`): new `senses` replace them, `retire` withdraws the
-- row; the stamp trigger moves server_seq, so devices pull the change. A row that changed or
-- was retired meanwhile is not touched: its review goes back to 'queued' (asked again with the
-- current senses). Every other row's review is marked done. Returns {changed, retired, stale}.
create or replace function public.word_bank_review_apply(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  x record;
  cur record;
  n_changed integer := 0;
  n_retired integer := 0;
  n_stale integer := 0;
  did_change boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'p_rows must be an array of at most 1000 rows' using errcode = '22023';
  end if;

  for x in
    select * from jsonb_to_recordset(p_rows) as r(
      lemma_norm text, pos text, expected jsonb, senses jsonb, retire boolean,
      lexicon_term_id uuid, attempt integer, outcome jsonb, model text, prompt_version text,
      cost_usd numeric)
  loop
    select b.senses, b.retired into cur
      from public.word_bank b where b.lemma_norm = x.lemma_norm and b.pos = x.pos
      for update;
    if not found then
      continue;
    end if;

    if cur.retired or cur.senses is distinct from x.expected then
      insert into public.word_bank_review as v (lemma_norm, pos, state, attempt, last_error, updated_at)
      values (x.lemma_norm, x.pos, 'queued', 0, 'stale', now())
      on conflict (lemma_norm, pos) do update
        set state = 'queued', batch_id = null, custom_id = null, input = null,
            last_error = 'stale', updated_at = now();
      n_stale := n_stale + 1;
      continue;
    end if;

    did_change := false;
    if coalesce(x.retire, false) then
      update public.word_bank set retired = true
        where lemma_norm = x.lemma_norm and pos = x.pos;
      n_retired := n_retired + 1;
      did_change := true;
    elsif x.senses is not null and x.senses is distinct from cur.senses then
      update public.word_bank b
        set senses = x.senses, lexicon_term_id = coalesce(b.lexicon_term_id, x.lexicon_term_id)
        where b.lemma_norm = x.lemma_norm and b.pos = x.pos;
      n_changed := n_changed + 1;
      did_change := true;
    end if;

    insert into public.word_bank_review as v (
      lemma_norm, pos, state, attempt, batch_id, custom_id, last_error, input, outcome,
      previous_senses, model, prompt_version, cost_usd, reviewed_at, updated_at)
    values (
      x.lemma_norm, x.pos, 'done', least(greatest(coalesce(x.attempt, 0), 0), 9), null, null, null,
      null, x.outcome, case when did_change then cur.senses end, x.model, x.prompt_version,
      greatest(coalesce(x.cost_usd, 0), 0), now(), now())
    on conflict (lemma_norm, pos) do update set
      state = 'done', attempt = excluded.attempt, batch_id = null, custom_id = null,
      last_error = null, input = null, outcome = excluded.outcome,
      previous_senses = excluded.previous_senses, model = excluded.model,
      prompt_version = excluded.prompt_version, cost_usd = excluded.cost_usd,
      reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  end loop;

  return jsonb_build_object('changed', n_changed, 'retired', n_retired, 'stale', n_stale);
end;
$$;

revoke all on function public.word_bank_review_pending(integer) from public, anon, authenticated;
revoke all on function public.word_bank_review_apply(jsonb) from public, anon, authenticated;
grant execute on function public.word_bank_review_pending(integer) to service_role;
grant execute on function public.word_bank_review_apply(jsonb) to service_role;
