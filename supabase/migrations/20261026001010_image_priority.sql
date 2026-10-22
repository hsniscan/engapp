-- Engapp v0.4 İP9: bulk picture priority (docs/decisions/0037-maintenance-jobs.md).
--
-- Auto-queue order (only senses with visualizability >= p_min, no request and no live picture):
--   1. in any user's cards: an app admin's first (2000 + users), else 1000 + users
--   2. within the owner's CEFR level ±1 (settings.level of the app admins): 500 + zipf × 10
--   3. the rest of the 5,000 most frequent lemmas (ref_word_freq): 100 + zipf × 10
--   anything else: not queued automatically (a user request still queues it).
-- Admin redraws (4000) and user requests (3000 + 100 per user) stay above every auto tier.
--
-- Word frequency: lexicon_terms.zipf, else the reference data (ref_word_freq) directly, so the
-- order is right also before the nightly level job has filled lexicon_terms.zipf. While no
-- frequency data is loaded at all, tier 3 takes every sense (the queue still fills).
--
-- TypeScript twin and tests: supabase/functions/_shared/image-priority.ts.

-- The formula (immutable; null = not auto-queued).
create or replace function public.image_auto_priority(
  p_in_admin_cards boolean, p_users integer, p_in_band boolean, p_zipf numeric, p_in_top boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_in_admin_cards then 2000 + least(greatest(coalesce(p_users, 0), 0), 999)
    when coalesce(p_users, 0) > 0 then 1000 + least(p_users, 999)
    when p_in_band then 500 + least(greatest(coalesce(pg_catalog.round(p_zipf * 10)::integer, 0), 0), 90)
    when p_in_top then 100 + least(greatest(coalesce(pg_catalog.round(p_zipf * 10)::integer, 0), 0), 90)
  end
$$;

-- Every lexicon sense with its auto priority (null: not auto-queued) and visualizability.
create or replace function public.image_sense_priorities()
returns table (sense_id uuid, priority integer, visualizability smallint)
language sql
stable
security invoker
set search_path = ''
as $$
  with lv (cefr, n) as (
    values ('A1', 1), ('A2', 2), ('B1', 3), ('B2', 4), ('C1', 5), ('C2', 6)
  ),
  owner_levels as (
    select distinct lv.n
    from public.app_admins a
    cross join lateral (
      select st.level from public.settings st
      where st.user_id = a.user_id and st.deleted_at is null
      order by st.updated_at desc
      limit 1
    ) s
    join lv on lv.cefr = s.level
  ),
  freq as (
    select
      exists (select 1 from public.ref_word_freq) as have,
      (select f.zipf from public.ref_word_freq f order by f.zipf desc offset 4999 limit 1) as floor
  ),
  users as (
    select s.lexicon_sense_id as sense_id,
      count(distinct s.user_id)::integer as users,
      bool_or(exists (select 1 from public.app_admins a where a.user_id = s.user_id)) as admin
    from public.senses s
    where s.lexicon_sense_id is not null and s.deleted_at is null
    group by s.lexicon_sense_id
  )
  select ls.id,
    public.image_auto_priority(
      coalesce(u.admin, false),
      coalesce(u.users, 0),
      exists (
        select 1 from lv join owner_levels o on pg_catalog.abs(o.n - lv.n) <= 1
        where lv.cefr = ls.cefr),
      z.zipf,
      case
        when not fq.have then true
        when z.zipf is null then false
        else z.zipf >= coalesce(fq.floor, 0)
      end),
    ls.visualizability
  from public.lexicon_senses ls
  join public.lexicon_terms t on t.id = ls.term_id
  cross join freq fq
  left join users u on u.sense_id = ls.id
  cross join lateral (
    select coalesce(t.zipf, (select f.zipf from public.ref_word_freq f where f.lemma_norm = t.lemma_norm)) as zipf
  ) z
$$;

-- Nightly: (1) re-rank queued auto requests (a sense that entered someone's cards moves up),
-- never touching redraws or user requests; (2) queue new senses in priority order.
-- Returns the number of newly queued senses (as before).
create or replace function public.image_queue_auto(p_min integer, p_limit integer)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.image_requests r set priority = p.priority
  from public.image_sense_priorities() p
  where p.sense_id = r.sense_id
    and r.source = 'auto' and r.state = 'queued' and r.priority < 3000
    and p.priority is not null and p.priority <> r.priority;

  with cand as (
    select p.sense_id, p.priority
    from public.image_sense_priorities() p
    where p.priority is not null
      and p.visualizability >= p_min
      and not exists (select 1 from public.image_requests r where r.sense_id = p.sense_id)
      and not exists (
        select 1 from public.lexicon_images i where i.sense_id = p.sense_id and i.status <> 'rejected')
    order by p.priority desc, p.sense_id
    limit greatest(0, least(p_limit, 10000))
  ), ins as (
    insert into public.image_requests (sense_id, source, priority)
    select sense_id, 'auto', priority from cand
    on conflict (sense_id) do nothing
    returning 1
  )
  select count(*)::integer into v_count from ins;
  return v_count;
end;
$$;

-- visual-v1 scores the senses that would be queued first first, then the rest by frequency.
create or replace function public.image_visual_pending(p_limit integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sense_id', x.id, 'lemma', x.lemma, 'pos', x.pos, 'gloss_tr', x.meaning_tr)), '[]'::jsonb)
  from (
    select ls.id, t.lemma, ls.pos, ls.meaning_tr
    from public.lexicon_senses ls
    join public.lexicon_terms t on t.id = ls.term_id
    left join public.image_sense_priorities() p on p.sense_id = ls.id
    left join public.ref_word_freq f on f.lemma_norm = t.lemma_norm
    where ls.visual_scored_at is null
    order by p.priority desc nulls last, coalesce(t.zipf, f.zipf) desc nulls last, ls.id
    limit greatest(0, least(p_limit, 5000))
  ) x
$$;

revoke all on function public.image_auto_priority(boolean, integer, boolean, numeric, boolean) from public, anon, authenticated;
grant execute on function public.image_auto_priority(boolean, integer, boolean, numeric, boolean) to service_role;
revoke all on function public.image_sense_priorities() from public, anon, authenticated;
grant execute on function public.image_sense_priorities() to service_role;
revoke all on function public.image_queue_auto(integer, integer) from public, anon, authenticated;
grant execute on function public.image_queue_auto(integer, integer) to service_role;
revoke all on function public.image_visual_pending(integer) from public, anon, authenticated;
grant execute on function public.image_visual_pending(integer) to service_role;
