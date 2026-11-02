-- Engapp v0.5.2 (decision 0060): the shared lexicon is no longer bulk-readable, new terms
-- outside the reference lists are flagged for the owner, and picture requests have a daily
-- cap per user (review S7, S13).
--
-- 1. Read path. Every signed-in user could `select * from lexicon_terms` and so list every
--    term anyone ever typed (ai-enrich stores a new term from the typed word once the model
--    accepts it). Clients never read these tables directly: they use lexicon_pull (senses
--    their own cards reference) and lexicon_get (senses by id, at most 500). Both become
--    SECURITY DEFINER and the table/view grants to `authenticated` go away. lexicon_find
--    (lookup by word) is used only by the edge functions with the service role.
-- 2. Moderation. A new single-word term whose lemma is in none of the reference lists
--    (ref_word_freq, ref_word_levels, word_bank) gets needs_review = true. Nothing changes for
--    the user; the owner sees the count in ops_health() and reviews with the SQL in
--    docs/runbook-backup-restore.md ("Sözlük denetimi").
-- 3. image_request: at most image_requests_per_day (default 20) new picture requests per
--    user and day, so one account cannot push everyone else's requests to the back.

-- ---------------------------------------------------------------------------
-- 1. read path
-- ---------------------------------------------------------------------------

-- Same body as 20261021000400_sync.sql; SECURITY DEFINER: reads the lexicon as the owner,
-- but only the senses the caller's own (RLS-free here, so filtered by auth.uid()) cards use.
create or replace function public.lexicon_pull(p_since bigint default 0, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_rows jsonb;
  v_count integer;
  v_next bigint;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  with page as (
    select e.* from public.lexicon_entries e
    where e.server_seq > v_since
      and e.id in (select s.lexicon_sense_id from public.senses s
                   where s.user_id = v_uid and s.lexicon_sense_id is not null)
    order by e.server_seq
    limit v_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by server_seq) as rn from page
  )
  select
    coalesce(jsonb_agg(to_jsonb(n) - 'rn' - 'server_seq' order by n.server_seq)
      filter (where n.rn <= v_limit), '[]'::jsonb),
    count(*),
    max(n.server_seq) filter (where n.rn <= v_limit)
  into v_rows, v_count, v_next
  from numbered n;

  return jsonb_build_object('rows', v_rows, 'next_seq', coalesce(v_next, v_since), 'has_more', v_count > v_limit);
end;
$$;

revoke all on function public.lexicon_pull(bigint, integer) from public, anon;
grant execute on function public.lexicon_pull(bigint, integer) to authenticated;

-- LexiconSense rows by id (max 500): fills lexicon_cache gaps for senses synced from another
-- device. Ids are random UUIDs, so this is no way to list the lexicon.
create or replace function public.lexicon_get(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) - 'server_seq' order by e.lemma_norm, e.id), '[]'::jsonb)
  from public.lexicon_entries e
  where e.id = any (p_ids[1:500])
$$;

revoke all on function public.lexicon_get(uuid[]) from public, anon;
grant execute on function public.lexicon_get(uuid[]) to authenticated, service_role;

revoke execute on function public.lexicon_find(text[], integer) from authenticated;
revoke select on table public.lexicon_terms, public.lexicon_senses from authenticated;
revoke select on public.lexicon_entries from authenticated;
drop policy if exists "lexicon: read for signed-in users" on public.lexicon_terms;
drop policy if exists "lexicon: read for signed-in users" on public.lexicon_senses;

-- ---------------------------------------------------------------------------
-- 2. new terms outside the reference lists
-- ---------------------------------------------------------------------------

alter table public.lexicon_terms add column needs_review boolean not null default false;
create index lexicon_terms_needs_review on public.lexicon_terms (created_at) where needs_review;

create or replace function public.tg_lexicon_terms_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.needs_review := new.term_type = 'word'
    and not exists (select 1 from public.ref_word_freq f where f.lemma_norm = new.lemma_norm)
    and not exists (select 1 from public.ref_word_levels l where l.lemma_norm = new.lemma_norm)
    and not exists (select 1 from public.word_bank w where w.lemma_norm = new.lemma_norm);
  return new;
end;
$$;

create trigger review_new_term before insert on public.lexicon_terms
  for each row execute function public.tg_lexicon_terms_review();

revoke all on function public.tg_lexicon_terms_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. picture requests per user and day
-- ---------------------------------------------------------------------------

insert into public.sync_limits (name, value) values ('image_requests_per_day', 20)
  on conflict (name) do nothing;

create index if not exists image_request_users_user_time
  on public.image_request_users (user_id, created_at);

create or replace function public.tg_image_request_users_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Asking again for a picture already asked for adds no row (on conflict do nothing).
  if exists (select 1 from public.image_request_users r
             where r.sense_id = new.sense_id and r.user_id = new.user_id) then
    return new;
  end if;
  if (select count(*) from public.image_request_users r
      where r.user_id = new.user_id and r.created_at > now() - interval '1 day')
     >= coalesce((select value from public.sync_limits where name = 'image_requests_per_day'), 20) then
    raise exception 'quota: too many picture requests today' using errcode = '53400';
  end if;
  return new;
end;
$$;

create trigger cap_per_user before insert on public.image_request_users
  for each row execute function public.tg_image_request_users_cap();

revoke all on function public.tg_image_request_users_cap() from public, anon, authenticated;
