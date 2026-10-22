-- Engapp v0.4 İP8: picture recall cards ("Görselden hatırlama", docs/decisions/0036-image-card.md).
--
-- A picture card is an ordinary user card: card_type 'image', sense_id = the user's sense, FSRS
-- fields like every card, answers in review_logs (insert-only as always). The client creates
-- it when an approved (or chosen) picture of the sense is on the device and removes it with a
-- tombstone when the picture is hidden or rejected; its id is derived from the sense id, so two
-- devices write the same row. Nothing about pictures is copied to another account: an account
-- copy re-adds notes (decision 0009) and the new account's device makes its own picture cards.

alter table public.cards drop constraint cards_card_type_check;
alter table public.cards add constraint cards_card_type_check
  check (card_type in ('recognition', 'production', 'cloze', 'image'));

-- Nullable, no default: an older client upserts settings without the key (jsonb_populate_record
-- gives null), which must not be rejected and must not turn the cards off. null = on.
alter table public.settings
  add column image_cards boolean;

comment on column public.settings.image_cards is
  'v0.4: picture recall cards ("Görselden hatırlama"); null = on, false = off.';
