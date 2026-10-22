-- Engapp v0.3 İP6: leeches and confusables (docs/decisions/0026-leeches-confusables.md).
--
-- Leeches are computed on the device from the synced review logs; nothing is stored for
-- them. What changes on the server:
--
--   notes.term_type gains 'contrast': a "fark kartı" for two terms the learner mixes up
--     ("affect ↔ effect"), recognition card only. Its two senses and the user's one-line
--     difference (user_content kind 'contrast') are the user's own rows, synced as before.
--     A reported or hidden pair is a user_content row of kind 'confusion' (the kind column
--     is open, no change). Clients older than this package skip a contrast note on pull (zod
--     rejects the unknown value); the new client re-pulls notes once after its Dexie upgrade.
--
--   lexicon_pair_notes gains kind 'contrast': the shared content of a pair of lexicon senses
--     {a: {lemma, sentence_en, span, sentence_tr}, b: {...}, difference_tr}, written by
--     ai-contrast (prompt contrast-v1) through lexicon_pair_notes_insert (service role only).
--     sense_id = the smaller sense id, content_key = '<smaller id>|<larger id>', so a pair
--     has one row whatever order it is asked in. Never user text: the request names two
--     lexicon sense ids and the model reads dictionary data.

-- ---------------------------------------------------------------------------
-- contrast notes
-- ---------------------------------------------------------------------------

alter table public.notes drop constraint notes_term_type_check;
alter table public.notes add constraint notes_term_type_check
  check (term_type in ('word', 'phrase', 'pattern', 'affix', 'contrast'));

-- ---------------------------------------------------------------------------
-- shared contrast content
-- ---------------------------------------------------------------------------

alter table public.lexicon_pair_notes drop constraint lexicon_pair_notes_kind_check;
alter table public.lexicon_pair_notes add constraint lexicon_pair_notes_kind_check
  check (kind in ('false_friend', 'mnemonic_suggestion', 'contrast'));

-- One side of a contrast note: lemma and an English sentence with the term's [start, end).
create or replace function public.contrast_side_ok(s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(s) = 'object'
    and jsonb_typeof(s -> 'lemma') = 'string'
    and char_length(s ->> 'lemma') between 1 and 120
    and jsonb_typeof(s -> 'sentence_en') = 'string'
    and char_length(s ->> 'sentence_en') between 1 and 300
    -- CASE: the casts run only on two numbers (AND does not fix the evaluation order).
    and case
      when jsonb_typeof(s -> 'span') is distinct from 'array' then false
      when jsonb_array_length(s -> 'span') <> 2
        or jsonb_typeof(s -> 'span' -> 0) is distinct from 'number'
        or jsonb_typeof(s -> 'span' -> 1) is distinct from 'number' then false
      else (s -> 'span' ->> 0)::numeric >= 0
        and (s -> 'span' ->> 1)::numeric > (s -> 'span' ->> 0)::numeric
        and (s -> 'span' ->> 1)::numeric <= char_length(s ->> 'sentence_en')
    end
    and (
      s -> 'sentence_tr' is null
      or jsonb_typeof(s -> 'sentence_tr') = 'null'
      or (jsonb_typeof(s -> 'sentence_tr') = 'string' and char_length(s ->> 'sentence_tr') between 1 and 300)
    )
$$;

revoke all on function public.contrast_side_ok(jsonb) from public, anon;
grant execute on function public.contrast_side_ok(jsonb) to authenticated, service_role;

alter table public.lexicon_pair_notes add constraint lexicon_pair_notes_contrast_check check (
  kind <> 'contrast' or (
    sense_id is not null
    and content_key ~ '^[0-9a-f-]{36}\|[0-9a-f-]{36}$'
    and split_part(content_key, '|', 1) = sense_id::text
    and split_part(content_key, '|', 1) < split_part(content_key, '|', 2)
    and public.contrast_side_ok(content -> 'a')
    and public.contrast_side_ok(content -> 'b')
    and jsonb_typeof(content -> 'difference_tr') = 'string'
    and char_length(content ->> 'difference_tr') between 1 and 300
  )
);

comment on function public.lexicon_pair_notes_insert(jsonb) is
  'AI pair notes (mnemonic suggestions, extract-v5 false friends, contrast cards). Service role only; never user text.';
