-- Engapp v0.5 İP10: streak protections ("Seri koruması", docs/decisions/0052-smart-review.md).
--
-- settings.streak_freezes   days (YYYY-MM-DD, the user's local day) a protection covered,
--                           ascending, at most 48. Two a calendar month are applied on the
--                           device (src/domain/streakFreeze.ts); the server only stores them,
--                           so every device of the account counts the same protections.
--
-- A column of the user's own settings row: the settings policies (auth.uid() = user_id) cover
-- it, the sync functions carry it like every settings column, and settings never move between
-- accounts. Nullable without a default: an older client upserts settings without the key
-- (jsonb_populate_record gives null), and a push that leaves the key out keeps the stored value
-- (_sync_upsert, 20261021001100_word_levels.sql). null = none.

create function public.is_streak_freeze_list(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 48
    and coalesce(
      (select bool_and(jsonb_typeof(e) = 'string' and (e #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$')
         from jsonb_array_elements(p) as e),
      true)
  )
$$;

alter table public.settings
  add column streak_freezes jsonb check (public.is_streak_freeze_list(streak_freezes));

comment on column public.settings.streak_freezes is
  'v0.5: local days a streak protection covered (array of "YYYY-MM-DD", at most 48); null = none.';
