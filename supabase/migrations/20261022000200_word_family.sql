-- Engapp v0.2 İP6 (part 1): word families, roots/affixes, false friends.
--
-- Reference tables (ref_*): derived from MorphyNet, Wiktionary (kaikki.org) and wordfreq,
-- licensed CC BY-SA 4.0 (docs/licenses/morphology.md). They stay in their own tables so the
-- share-alike licence never touches the AI lexicon. Loaded by
-- scripts/build-morphology/load-sql.ts with the service role; clients only read them.
-- The app itself reads the same data from a static file (public/data/morphology-*.json),
-- so guests and offline devices see families too (docs/decisions/0014-word-family.md).
--
-- lexicon_pair_notes: shared notes for an English term (optionally one lexicon sense) in a
-- language pair: hand-written false friends now, AI false friends and mnemonic suggestions
-- later. Never contains user text or user ids; only the service role writes.
--
-- notes.term_type gains 'affix' (root/affix cards, recognition card only).

-- ---------------------------------------------------------------------------
-- reference tables
-- ---------------------------------------------------------------------------

create table public.ref_sources (
  key text primary key check (key ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) <= 300),
  version text not null check (char_length(version) <= 300),
  url text not null check (char_length(url) <= 500),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  license text not null check (char_length(license) <= 200),
  attribution text not null check (char_length(attribution) <= 1000),
  loaded_at timestamptz not null default now()
);

create table public.ref_morphemes (
  id text primary key check (id ~ '^-?[a-z]{1,20}-?$'),
  form text not null check (char_length(form) between 2 and 40),
  kind text not null check (kind in ('prefix', 'suffix', 'root')),
  origin text not null check (origin in ('latin', 'greek', 'germanic', 'french')),
  gloss_en text not null check (char_length(gloss_en) between 1 and 200),
  -- Per language: {"tr": {"meaning": "bakmak", "note": "...", "source": "ai" | "curated",
  --                       "model": "...", "prompt_version": "morpheme-tr-v1"}}
  meanings jsonb not null default '{}'::jsonb check (jsonb_typeof(meanings) = 'object'),
  word_count integer not null default 0 check (word_count >= 0),
  source_version text not null check (char_length(source_version) <= 100),
  updated_at timestamptz not null default now()
);

create table public.ref_word_morphemes (
  lemma_norm text not null check (lemma_norm ~ '^[a-z]{1,60}$'),
  morpheme_id text not null references public.ref_morphemes (id) on delete cascade,
  position smallint not null check (position >= 0),
  primary key (lemma_norm, morpheme_id)
);
create index ref_word_morphemes_morpheme on public.ref_word_morphemes (morpheme_id);

create table public.ref_families (
  lemma_norm text primary key check (lemma_norm ~ '^[a-z]{1,60}$'),
  -- The family's base word ("decide" for decision, decisive, …).
  family_id text not null check (family_id ~ '^[a-z]{1,60}$'),
  pos text check (pos in ('noun', 'verb', 'adjective', 'adverb')),
  -- Display order inside the family (0 = base, then by frequency).
  rank smallint not null check (rank >= 0)
);
create index ref_families_family on public.ref_families (family_id, rank);

alter table public.ref_sources enable row level security;
alter table public.ref_morphemes enable row level security;
alter table public.ref_word_morphemes enable row level security;
alter table public.ref_families enable row level security;
revoke all on table public.ref_sources, public.ref_morphemes, public.ref_word_morphemes, public.ref_families
  from anon, authenticated;
grant select on table public.ref_sources, public.ref_morphemes, public.ref_word_morphemes, public.ref_families
  to authenticated;
create policy "reference: read for signed-in users" on public.ref_sources for select to authenticated using (true);
create policy "reference: read for signed-in users" on public.ref_morphemes for select to authenticated using (true);
create policy "reference: read for signed-in users" on public.ref_word_morphemes for select to authenticated using (true);
create policy "reference: read for signed-in users" on public.ref_families for select to authenticated using (true);
-- No insert/update/delete policies or grants: only the service role writes.

-- ---------------------------------------------------------------------------
-- lexicon_pair_notes
-- ---------------------------------------------------------------------------

create table public.lexicon_pair_notes (
  id uuid primary key default gen_random_uuid(),
  term_norm text not null check (
    char_length(term_norm) between 1 and 120
    and term_norm = lower(term_norm)
    and term_norm = btrim(term_norm)
  ),
  -- null: the note is about the term as a whole (the hand-written false friends).
  sense_id uuid references public.lexicon_senses (id) on delete cascade,
  lang_pair text not null check (lang_pair in ('en-tr')),
  kind text not null check (kind in ('false_friend', 'mnemonic_suggestion')),
  -- Dedup key within (lang_pair, kind, term, sense): the Turkish look-alike, lower-cased,
  -- for false friends; a normalized keyword for mnemonics.
  content_key text not null check (char_length(content_key) between 1 and 120),
  -- false_friend: {tr_word, en_meaning_tr, tr_meaning_tr, tr_meaning_en, strength, note_tr}
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 4000),
  curated boolean not null default false,
  model text check (char_length(model) <= 100),
  prompt_version text check (char_length(prompt_version) <= 40),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  -- A hand-written note has no model; an AI note names its model and prompt.
  check (curated or (model is not null and prompt_version is not null))
);

create unique index lexicon_pair_notes_key on public.lexicon_pair_notes
  (lang_pair, kind, term_norm, coalesce(sense_id, '00000000-0000-0000-0000-000000000000'::uuid), content_key);
create index lexicon_pair_notes_term on public.lexicon_pair_notes (term_norm);
create index lexicon_pair_notes_seq on public.lexicon_pair_notes (server_seq);

-- Same ordering guarantee as the lexicon (shared lexicon_seq): a later lexicon pull can
-- page through pair notes by cursor without skipping rows.
create trigger stamp_lexicon_row before insert or update on public.lexicon_pair_notes
  for each row execute function public.tg_stamp_lexicon_row();

alter table public.lexicon_pair_notes enable row level security;
revoke all on table public.lexicon_pair_notes from anon, authenticated;
grant select on table public.lexicon_pair_notes to authenticated;
create policy "lexicon: read for signed-in users" on public.lexicon_pair_notes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- affix notes
-- ---------------------------------------------------------------------------
-- A root/affix card ("-spect-": bakmak) is a note of its own with term_type 'affix'. Clients
-- older than this package skip such a row on pull (zod rejects the unknown value) and the
-- new client re-pulls once after its Dexie upgrade, so nothing is lost.

alter table public.notes drop constraint notes_term_type_check;
alter table public.notes add constraint notes_term_type_check
  check (term_type in ('word', 'phrase', 'pattern', 'affix'));
