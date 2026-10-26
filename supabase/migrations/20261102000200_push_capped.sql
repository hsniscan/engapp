-- v0.5.1 (ADR 0055): the reminder's count follows the app's daily capacity.
--
-- push_due_counts counted every studied card due today, so after a break the reminder could say
-- "300 kart, yaklaşık 50 dk" while the app itself shows at most the capacity (default 20
-- minutes) through catch-up (docs/decisions/0021). Now the reviews (Review state) are capped the
-- way the app's catch-up caps them: when they exceed the capacity (catch-up on, the default),
-- the count is the capacity. Learning steps are never capped, as in the app. New cards are still
-- not counted.
--
-- capacity = floor(minutes · 60 / seconds per answer), at least 1, with
--   minutes = settings.daily_capacity_min clamped to 5–180 (null = 20, domain/capacity.ts),
--   seconds = the median answer time of the last 30 days clamped to 3–60, or 10 with fewer than
--             20 answers (domain/capacity.ts MIN_PACE_SAMPLES, FALLBACK_SEC_PER_CARD).
-- The returned sec_per_card is unchanged (push-rule.ts applies its own fallback).
-- The signature is the same, so `create or replace` keeps the service_role-only grants.

create or replace function public.push_due_counts(p_items jsonb)
returns table (user_id uuid, due integer, sec_per_card double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select (i ->> 'user_id')::uuid as user_id, (i ->> 'until')::bigint as until
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ),
  base as (
    select
      it.user_id,
      (select count(*) from public.cards c
        where c.user_id = it.user_id and c.deleted_at is null and not c.suspended and c.unlocked
          and c.state in (1, 3) and c.due < it.until)::integer as learning,
      (select count(*) from public.cards c
        where c.user_id = it.user_id and c.deleted_at is null and not c.suspended and c.unlocked
          and c.state = 2 and c.due < it.until)::integer as reviews,
      pace.median_sec,
      pace.samples,
      (select s.daily_capacity_min from public.settings s
        where s.user_id = it.user_id and s.id = 'settings' and s.deleted_at is null) as capacity_min,
      (select s.catchup_auto from public.settings s
        where s.user_id = it.user_id and s.id = 'settings' and s.deleted_at is null) as catchup_auto
    from items it
    cross join lateral (
      select
        percentile_cont(0.5) within group (order by least(r.duration_ms, 60000)) / 1000.0 as median_sec,
        count(*)::integer as samples
      from public.review_logs r
      where r.user_id = it.user_id and r.undo_of is null and r.duration_ms > 0
        and r.reviewed_at >= (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000
    ) pace
  ),
  capped as (
    select
      b.*,
      greatest(1, floor(
        least(180, greatest(5, coalesce(b.capacity_min, 20)))::double precision * 60.0
        / (case when b.samples >= 20 and b.median_sec is not null
                then least(60.0, greatest(3.0, b.median_sec)) else 10.0 end)
      ))::integer as capacity
    from base b
  )
  select
    c.user_id,
    c.learning + case
      when coalesce(c.catchup_auto, true) and c.reviews > c.capacity then c.capacity
      else c.reviews
    end,
    c.median_sec
  from capped c
$$;
