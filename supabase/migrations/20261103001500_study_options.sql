-- Engapp v0.5.2 study (docs/decisions/0062-study-day-budget-and-clock.md).
--
-- settings.study_options   jsonb, the user's study options; every key optional:
--   mode_new_limits   {production, cloze, dictation}: each mode's own daily limit of
--                     first-time cards inside the shared "Günlük yeni kart" budget (null = none)
--   session_cards     most cards in one study session (null = the whole mode)
--   leech_auto_suspend  suspend a card when it becomes a leech (null/false = only flag it)
--
-- A column of the user's own settings row: the settings policies (auth.uid() = user_id) cover
-- it, the sync functions carry it like every settings column, and settings never move between
-- accounts. Nullable without a default: an older client upserts settings without the key
-- (jsonb_populate_record gives null), and a push that leaves the key out keeps the stored value
-- (_sync_upsert, 20261021001100_word_levels.sql). The client validates the shape (zod).

alter table public.settings
  add column study_options jsonb;

alter table public.settings
  add constraint settings_study_options_object
  check (study_options is null or jsonb_typeof(study_options) = 'object');

comment on column public.settings.study_options is
  'v0.5.2: study options (per-mode new-card limits, session length, leech auto-suspend); null = defaults.';
