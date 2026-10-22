-- Engapp v0.4: smart new-card order (docs/decisions/0039-smart-new-card-order.md).
--
-- The only server change of this package: the user's "Yeni kelime sırası" setting. The order
-- itself is computed on the device (src/domain/newOrder.ts) and never stored.
--
-- Nullable, no default: an older client upserts settings without the key (jsonb_populate_record
-- gives null), which must not be rejected, and a push that leaves the key out keeps the stored
-- value (_sync_upsert, 20261021001100_word_levels.sql). null = 'smart'.
alter table public.settings
  add column new_card_order text
    check (new_card_order is null or new_card_order in ('smart', 'added'));

comment on column public.settings.new_card_order is
  'v0.4: order of new cards: smart (level, frequency, own signals, no confusable pair on one day) or added (insertion order); null = smart.';
