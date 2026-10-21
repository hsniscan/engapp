-- Engapp v0.2 İP7: interests and profile (docs/decisions/0015-interests-profile.md).
--
-- settings.interests      topics the user picked; null = never asked, '{}' = asked, none picked
-- settings.muted_topics   topics the user turned off (weight 0)
-- sources.topics          topics of an imported text (from the extract call)
--
-- Values are topic keys from src/domain/topics.ts. They are not an enum or a CHECK against a
-- fixed list: a newer client may know more topics, and a row the server rejected would wait in
-- the outbox forever. Topic weights are computed on the device and never stored.
--
-- Both tables are already in public.sync_tables, and _sync_upsert / sync_pull_v3 / sync_pull_v2
-- build their column lists at run time, so no sync function changes. A client that does not
-- know the columns pushes rows without them; jsonb_populate_record turns that into null. The
-- keep_profile_fields trigger below keeps the stored lists in that case, so a settings change
-- on an older device (theme, backup date…) never wipes the user's interests. A newer client
-- clears a list with '{}', never with null.

create function public.is_topic_list(p text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    cardinality(p) <= 40
    and coalesce((select bool_and(char_length(t) between 1 and 40) from unnest(p) as t), true)
  )
$$;

alter table public.settings
  add column interests text[] check (public.is_topic_list(interests)),
  add column muted_topics text[] check (public.is_topic_list(muted_topics));

alter table public.sources
  add column topics text[] check (public.is_topic_list(topics));

create function public.tg_keep_settings_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.interests is null then new.interests := old.interests; end if;
  if new.muted_topics is null then new.muted_topics := old.muted_topics; end if;
  return new;
end;
$$;

create function public.tg_keep_source_topics()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.topics is null then new.topics := old.topics; end if;
  return new;
end;
$$;

create trigger keep_profile_fields before update on public.settings
  for each row execute function public.tg_keep_settings_profile();
create trigger keep_profile_fields before update on public.sources
  for each row execute function public.tg_keep_source_topics();

revoke all on function public.tg_keep_settings_profile() from public, anon, authenticated;
revoke all on function public.tg_keep_source_topics() from public, anon, authenticated;
