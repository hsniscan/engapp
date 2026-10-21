-- Engapp: senses.source_sentence_tr, the user's Turkish translation of source_sentence
-- (from ai-extract or typed by hand). Per-user data like the sentence itself: it lives only
-- on the user's sense and is never written to lexicon_terms / lexicon_senses.
--
-- No function needs to change: _sync_upsert builds its column list from pg_attribute, and
-- sync_pull / sync_pull_v2 return to_jsonb(row), so the new column is pushed and pulled as
-- soon as it exists. A client that does not know the column yet sends rows without it;
-- jsonb_populate_record then yields null (its edit clears the translation, like any other
-- full-row last-writer-wins update). Clients treat a missing field in pulled rows as null.
alter table public.senses
  add column source_sentence_tr text check (char_length(source_sentence_tr) <= 2000);
