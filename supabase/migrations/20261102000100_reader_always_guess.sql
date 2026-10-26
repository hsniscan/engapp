-- Engapp v0.5.1 reader (docs/decisions/0054-reader-toparlama.md).
--
-- settings.reader_always_guess   "Hep tahmin ettir": a tapped word the user already has a card
--                                for asks for a guess first too. null/false = off: its meaning
--                                shows at once (Hasan's choice, 2026-10-26).
--
-- A column of the user's own settings row: the settings policies (auth.uid() = user_id) cover
-- it, the sync functions carry it like every settings column, and settings never move between
-- accounts. Nullable without a default: an older client upserts settings without the key
-- (jsonb_populate_record gives null), and a push that leaves the key out keeps the stored value
-- (_sync_upsert, 20261021001100_word_levels.sql).

alter table public.settings
  add column reader_always_guess boolean;

comment on column public.settings.reader_always_guess is
  'v0.5.1: the reader asks for a guess before showing the meaning of a word the user has a card for; null = off.';
