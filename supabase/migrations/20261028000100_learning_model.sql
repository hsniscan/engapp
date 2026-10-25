-- Engapp redesign: the learning model (docs/decisions/0041-learning-model.md).
--
-- Cards gain two columns that the app derives from the review logs (domain/fsrs.ts
-- applyRating, replayed by domain/recompute.ts replayCard):
--   ramp_step   counted reviews since graduation or the last lapse ("sağlam tekrar");
--   learned_at  the first time the card reached Öğrenildi (ms since epoch), never cleared.
-- The server only stores them: nothing on the server reads or computes them.
--
-- sync_push inserts a row through jsonb_populate_record, so a key the payload lacks (an older
-- app version creating a card) arrives as null, not as the column default: a trigger fills the
-- default, like settings_level_defaults (20261022000500_level_test.sql). A push that leaves the
-- keys out keeps the stored values (_sync_upsert, 20261021001100_word_levels.sql); the next
-- recompute on a new client heals anything an older client left behind.
alter table public.cards
  add column ramp_step smallint not null default 0 check (ramp_step >= 0),
  add column learned_at bigint check (learned_at >= 0);

comment on column public.cards.ramp_step is
  'Learning model (ADR 0041): counted reviews since graduation or the last lapse; derived from review_logs by the app.';
comment on column public.cards.learned_at is
  'Learning model (ADR 0041): first time the card reached the Öğrenildi stage (ms); derived from review_logs by the app.';

create or replace function public.tg_cards_ramp_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ramp_step := coalesce(new.ramp_step, 0);
  return new;
end;
$$;

revoke all on function public.tg_cards_ramp_defaults() from public, anon, authenticated;

create trigger cards_ramp_defaults before insert or update on public.cards
  for each row execute function public.tg_cards_ramp_defaults();
