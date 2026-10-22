-- Engapp v0.4 İP3: pictures in the app (docs/decisions/0031-images-in-app.md).
--
-- The only server change of this package: the user's "Görseli ön yüzde de göster" setting.
-- Everything else the client stores about pictures is a user_content row (kind
-- 'image_choice': the picked picture or the hide flag; kind 'image_feedback': the reason of a
-- "Hayır") or a content_feedback row (target_kind 'image', verdict 'like' / 'reject'). Both
-- tables already take any kind matching '^[a-z][a-z_]{1,31}$', so they need no change. The
-- shared table public.lexicon_images and the review functions belong to İP2 / İP4's server
-- side (migrations 20261025000200…).

-- Nullable, no default: an older client upserts settings without the key
-- (jsonb_populate_record gives null), which must not be rejected. null = off.
alter table public.settings
  add column show_image_front boolean;

comment on column public.settings.show_image_front is
  'v0.4: show the picture of the asked sense on the front of the card too; null = off.';
