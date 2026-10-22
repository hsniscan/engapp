-- v0.2 İP4 smart extraction (docs/decisions/0018-smart-extraction.md).
--
-- The preview's sections and the default selection are decided on the device; what the user
-- already knows never reaches the server, so the only server change is one synced setting:
-- settings.show_easy_candidates opens the "Kolay" section of the import preview.
--
-- Nullable on purpose: a device on an older app version inserts its settings row without the
-- key (jsonb_populate_record gives null), and null means "closed" like false. A push that
-- leaves the key out keeps the stored value (_sync_upsert, 20261021001100_word_levels.sql).
-- The extract prompt bump (extract-v4) needs no migration: ai_chunk_cache is keyed by the
-- prompt version already.

alter table public.settings
  add column show_easy_candidates boolean default false;

comment on column public.settings.show_easy_candidates is
  'Import preview: show the "Kolay" (below-level) candidates open. null = false.';
