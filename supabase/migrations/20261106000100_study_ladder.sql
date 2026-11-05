-- Engapp v0.5.3 study (docs/decisions/0071-v053-study-order-ladder-rescue.md).
--
-- review_logs.answer_mode  how the answer was given: 'choice' (picked from multiple choices),
--                          'typed' (typed and checked) or 'flip' (self-rated after showing the
--                          answer). null = unknown (older rows, Anki imports). The app reads it
--                          when it replays a card (a choice never moves a card to Öğrenildi) and
--                          leaves choice answers out of the personal FSRS fit. Logs stay
--                          insert-only: the column only labels them.
-- cards.rest_until         the card rests until this time (ms since epoch) after its sixth
--                          lapse ("30 gün dinlenmede"); null = not resting. The app skips the
--                          card in its queue until then and the user can end the rest early.
--
-- Both nullable without a default: sync_push inserts through jsonb_populate_record, so a row
-- from an older app version (no key) arrives as null, which is the right value for both. A push
-- that leaves cards.rest_until out keeps the stored value (_sync_upsert,
-- 20261021001100_word_levels.sql). The cards and review_logs policies (auth.uid() = user_id)
-- cover the new columns; no new table, so the sync registry is unchanged.

alter table public.review_logs
  add column answer_mode text check (answer_mode is null or answer_mode in ('choice', 'typed', 'flip'));

comment on column public.review_logs.answer_mode is
  'v0.5.3: how the answer was given (choice, typed, flip); null = unknown. Written by the app, never updated.';

alter table public.cards
  add column rest_until bigint check (rest_until is null or rest_until >= 0);

comment on column public.cards.rest_until is
  'v0.5.3: the card rests until this time (ms) after its sixth lapse; null = not resting.';
