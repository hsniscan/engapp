-- v0.3 İP4 personal FSRS parameters (docs/decisions/0022-fsrs-optimizer.md).
--
-- The optimizer runs on the device; the review history never leaves it for this. Only the
-- outcome syncs, as two optional settings next to the existing settings.fsrs_params:
--   fsrs_params_prev  the parameters in use before the last adoption ("Eski ayara dön");
--                     null = the defaults were in use, or nothing to go back to.
--   fsrs_opt_at       when the check last ran on any device (epoch ms; the monthly offer).
--
-- Nullable without defaults: a device on an older app version pushes its settings row without
-- the keys, and _sync_upsert keeps the stored values (20261021001100_word_levels.sql).

alter table public.settings
  add column fsrs_params_prev double precision[]
    check (fsrs_params_prev is null or cardinality(fsrs_params_prev) <= 64),
  add column fsrs_opt_at bigint check (fsrs_opt_at is null or fsrs_opt_at >= 0);

comment on column public.settings.fsrs_params_prev is
  'FSRS parameters before the last personal adoption (one-tap revert). null = defaults / none.';
comment on column public.settings.fsrs_opt_at is
  'Epoch ms of the last personal-parameter check (adopted or not). null = never.';
