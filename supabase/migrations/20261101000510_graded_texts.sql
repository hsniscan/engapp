-- Engapp v0.5 İP5: the graded reading library (decision 0047, plan appendix A.2 / A.5).
--
-- graded_texts holds short texts written for learners (A2–C1, 150–600 words) by the
-- graded-v1 job (scripts/graded-batch.ts, .github/workflows/graded.yml), each sentence with
-- its Turkish translation and the object path of its pre-generated audio, checked against
-- the word lists (coverage) and by a second model (gradedcheck-v1) before it is approved.
-- System content, never user text (AGENTS.md rule 5): only the service role writes it.
--
-- Everyone (guests too, anon key) reads the rows that were ever approved: the app downloads
-- the catalogue's metadata after a cursor (server_seq, like the word bank) and a text's
-- sentences when it is opened. A text that is withdrawn after approval (status back to
-- 'rejected') stays visible with its new status, so devices learn to drop it; a text that
-- was never approved is never visible. The job's bookkeeping (cost, model, checks, plan key)
-- is not readable by clients.

create sequence if not exists public.graded_texts_seq as bigint;
revoke all on sequence public.graded_texts_seq from public, anon, authenticated;

create table public.graded_texts (
  id uuid primary key default gen_random_uuid(),
  -- The planner's slot this text fills: '<level>|<topic>|<slot>' (graded_jobs.plan_key).
  plan_key text not null check (plan_key ~ '^(A1|A2|B1|B2|C1|C2)\|[a-z_]{1,40}\|[0-9]{1,4}$'),
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  topic text not null check (topic ~ '^[a-z_]{1,40}$'),
  title text not null check (char_length(title) between 1 and 120),
  -- Plain text: the sentences joined, paragraphs separated by a blank line.
  body text not null check (char_length(body) between 1 and 8000),
  -- [{en, tr, audio_key, p}] in reading order (p: paragraph index; audio_key: the en-US MP3
  -- in the public `tts` bucket, content-addressed like every pre-generated clip). Checked in
  -- code (graded-contract.ts).
  sentences jsonb not null check (
    jsonb_typeof(sentences) = 'array'
    and jsonb_array_length(sentences) between 1 and 160
    and pg_column_size(sentences) <= 60000),
  -- Running-word counts per lemma ({lemma: n}, numbers, punctuation and proper nouns left
  -- out): the device measures a text against what the user knows from this (coverage.ts).
  lemma_profile jsonb not null check (
    jsonb_typeof(lemma_profile) = 'object' and pg_column_size(lemma_profile) <= 30000),
  -- Share of counted tokens at or below each level: {"A1": 0.81, …, "C2": 1}.
  coverage_by_level jsonb not null check (jsonb_typeof(coverage_by_level) = 'object'),
  -- Words above level + 2 that the text explains: [{word, tr}].
  glosses jsonb not null default '[]' check (jsonb_typeof(glosses) = 'array'),
  -- Words of the level the text practises (the model's list, checked against the text).
  target_lemmas text[] not null default '{}' check (cardinality(target_lemmas) <= 20),
  words integer not null check (words between 1 and 2000),
  tokens integer not null check (tokens between 0 and 2000),
  -- Coverage stats of the text's own level (the gate): share at or below the level, share at
  -- level + 1, and unglossed tokens above level + 2.
  cov_level numeric(5, 4) not null check (cov_level between 0 and 1),
  cov_next numeric(5, 4) not null check (cov_next between 0 and 1),
  above_unglossed integer not null default 0 check (above_unglossed >= 0),
  status text not null default 'checking' check (status in ('checking', 'approved', 'rejected')),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  check_version text check (char_length(check_version) <= 40),
  model text check (char_length(model) <= 100),
  check_model text check (char_length(check_model) <= 100),
  -- The coverage report and the checker's answer (private).
  checks jsonb not null default '{}' check (jsonb_typeof(checks) = 'object' and pg_column_size(checks) <= 20000),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  -- First approval; set by the trigger, never cleared (it makes the row public for good).
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  check (status <> 'approved' or approved_at is not null)
);

create index graded_texts_server_seq on public.graded_texts (server_seq) where approved_at is not null;
create index graded_texts_plan_key on public.graded_texts (plan_key);
create index graded_texts_cell on public.graded_texts (level, topic, status);

-- Same idea as tg_stamp_word_bank_row: one lock so rows commit in seq order and a device's
-- cursor never skips a row. Also stamps the first approval.
create or replace function public.tg_stamp_graded_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.graded_texts', 0));
  new.server_seq := pg_catalog.nextval('public.graded_texts_seq');
  new.updated_at := pg_catalog.now();
  if new.status = 'approved' and new.approved_at is null then
    new.approved_at := pg_catalog.now();
  end if;
  if tg_op = 'UPDATE' and old.approved_at is not null then
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_stamp_graded_text() from public, anon, authenticated;

create trigger stamp_graded_text before insert or update on public.graded_texts
  for each row execute function public.tg_stamp_graded_text();

alter table public.graded_texts enable row level security;
revoke all on table public.graded_texts from anon, authenticated;
grant select (id, level, topic, title, body, sentences, lemma_profile, coverage_by_level, glosses,
  target_lemmas, words, tokens, cov_level, status, prompt_version, approved_at, server_seq)
  on public.graded_texts to anon, authenticated;
create policy "graded texts: approved rows for everyone" on public.graded_texts
  for select to anon, authenticated using (approved_at is not null);
-- No write policies: only the service role (the job) writes.

-- ---------------------------------------------------------------------------
-- job bookkeeping (service role only)
-- ---------------------------------------------------------------------------

-- One row per planned slot. stage 'write': graded-v1 writes (or rewrites) the text;
-- stage 'check': gradedcheck-v1 reads the stored 'checking' text. Without a row the slot is
-- free for the planner.
create table public.graded_jobs (
  plan_key text primary key check (plan_key ~ '^(A1|A2|B1|B2|C1|C2)\|[a-z_]{1,40}\|[0-9]{1,4}$'),
  level text not null check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  topic text not null check (topic ~ '^[a-z_]{1,40}$'),
  slot integer not null check (slot between 0 and 9999),
  stage text not null default 'write' check (stage in ('write', 'check')),
  state text not null check (state in ('queued', 'submitted', 'done', 'failed')),
  -- Writer answers tried so far (one regeneration after a failed coverage check).
  attempt smallint not null default 0 check (attempt between 0 and 9),
  batch_id text check (char_length(batch_id) <= 200),
  custom_id text check (custom_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  -- The plan item and, on a rewrite, what to avoid (stored so collect reads the answer
  -- against the request it answers).
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 8000),
  graded_id uuid references public.graded_texts (id) on delete set null,
  last_error text check (char_length(last_error) <= 500),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'submitted') = (batch_id is not null)),
  check (stage = 'write' or graded_id is not null)
);

create index graded_jobs_batch on public.graded_jobs (batch_id) where batch_id is not null;
create index graded_jobs_state on public.graded_jobs (state, stage);

-- One row per Message Batch: its budget hold (text_budget) and, once collected, its cost.
create table public.graded_batches (
  id text primary key check (char_length(id) between 1 and 200),
  stage text not null check (stage in ('write', 'check')),
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

alter table public.graded_jobs enable row level security;
alter table public.graded_batches enable row level security;
revoke all on table public.graded_jobs, public.graded_batches from anon, authenticated;

-- Counts per level, topic and status for the planner and the report:
-- [{level, topic, status, n}] (texts) and the jobs still in flight.
create or replace function public.graded_cells()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('level', t.level, 'topic', t.topic, 'status', t.status, 'n', t.n)
        order by t.level, t.topic, t.status)
      from (select level, topic, status, count(*)::int as n from public.graded_texts
            group by level, topic, status) t), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('level', j.level, 'topic', j.topic, 'stage', j.stage,
          'state', j.state, 'n', j.n) order by j.level, j.topic, j.stage, j.state)
      from (select level, topic, stage, state, count(*)::int as n from public.graded_jobs
            group by level, topic, stage, state) j), '[]'::jsonb))
$$;

revoke all on function public.graded_cells() from public, anon, authenticated;
grant execute on function public.graded_cells() to service_role;
