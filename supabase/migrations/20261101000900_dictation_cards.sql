-- Engapp v0.5 İP9: dictation cards ("Dikte", docs/decisions/0051-study-modes-dictation.md).
--
-- A dictation card is an ordinary user card: card_type 'dictation', sense_id = the user's sense,
-- FSRS fields like every card, answers in review_logs (insert-only as always). The client
-- creates it when the sense has a shared example sentence (pre-generated audio) on the device;
-- its id is derived from the sense id, so two devices write the same row. It never changes the
-- word's stage (that is the recognition card's alone, decision 0041). Nothing else changes:
-- typed answers and the hands-free round store nothing on the server.

alter table public.cards drop constraint cards_card_type_check;
alter table public.cards add constraint cards_card_type_check
  check (card_type in ('recognition', 'production', 'cloze', 'image', 'dictation'));
