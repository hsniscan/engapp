-- Engapp v0.4: watercolour pictures (prompt image-v2, owner's choice on 2026-10-25) replace the
-- flat style-B ones (image-v1). docs/ai-image.md, supabase/functions/_shared/image-contract.ts.
--
--   image_insert       a stored image-v2 picture ('review' or 'approved') rejects the sense's
--                      older-style live pictures, with checks.replaced_by = 'image-v2'
--   image_queue_auto   "no live picture" now means no live image-v2 picture, so senses that
--                      only have flat pictures are queued again
--   image_request      a user asking again for a sense that only has flat pictures queues it
--   one-off            finished and declined requests of senses without an image-v2 picture go
--                      back to the queue (except senses that no longer exist)
--
-- Flat pictures stay visible until their sense has an image-v2 picture in review or approved.

-- Same as 20261025000200_images.sql, plus the replacement rule after the insert.
create or replace function public.image_insert(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sense uuid := (p ->> 'sense_id')::uuid;
  v_row public.lexicon_images;
begin
  if v_sense is null then
    raise exception 'sense_id is required' using errcode = '22023';
  end if;
  -- One writer per sense at a time, so variants never collide.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engapp.image:' || v_sense::text, 0));
  insert into public.lexicon_images (sense_id, variant, svg, alt_tr, status, checks, model, prompt_version, cost_usd)
  values (
    v_sense,
    coalesce((select max(i.variant) + 1 from public.lexicon_images i where i.sense_id = v_sense), 0),
    coalesce(p ->> 'svg', ''),
    coalesce(p ->> 'alt_tr', ''),
    p ->> 'status',
    coalesce(p -> 'checks', '{}'::jsonb),
    p ->> 'model',
    p ->> 'prompt_version',
    coalesce((p ->> 'cost_usd')::numeric, 0)
  )
  returning * into v_row;
  -- A watercolour picture that passed its checks replaces the sense's older-style pictures.
  if v_row.prompt_version = 'image-v2' and v_row.status in ('review', 'approved') then
    update public.lexicon_images i set
      status = 'rejected',
      checks = i.checks || '{"replaced_by": "image-v2"}'::jsonb,
      updated_at = now()
    where i.sense_id = v_sense
      and i.id <> v_row.id
      and i.prompt_version <> 'image-v2'
      and i.status in ('checking', 'review', 'approved');
  end if;
  return jsonb_build_object(
    'id', v_row.id, 'sense_id', v_row.sense_id, 'variant', v_row.variant, 'svg', v_row.svg,
    'alt_tr', v_row.alt_tr, 'status', v_row.status, 'created_at', v_row.created_at,
    'cost_usd', v_row.cost_usd);
end;
$$;

revoke all on function public.image_insert(jsonb) from public, anon, authenticated;
grant execute on function public.image_insert(jsonb) to service_role;

-- Same as 20261026001010_image_priority.sql, except the "no live picture" test: only a live
-- image-v2 picture counts, so a sense whose only live pictures are flat is queued again.
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
        select 1 from public.lexicon_images i
        where i.sense_id = p.sense_id and i.status <> 'rejected' and i.prompt_version = 'image-v2')
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

revoke all on function public.image_queue_auto(integer, integer) from public, anon, authenticated;
grant execute on function public.image_queue_auto(integer, integer) to service_role;

-- Same as 20261025000200_images.sql, plus one case: a finished ('done') request of a sense
-- that has a live flat picture but no live image-v2 one is queued again even when this user
-- asked before, so asking for a flat-only sense gets a watercolour picture. Declined
-- ('skipped') senses still need a new requester, as before, so repeated asks cannot make the
-- model decline the same meaning again and again.
create or replace function public.image_request(p_sense_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_new boolean;
  v_flat_only boolean;
  v_req public.image_requests;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.senses s
    where s.user_id = v_uid and s.lexicon_sense_id = p_sense_id and s.deleted_at is null
  ) then
    raise exception 'sense is not in your cards' using errcode = '22023';
  end if;

  insert into public.image_requests as r (sense_id, source, priority, requesters, state)
  values (p_sense_id, 'user', 3000, 0, 'queued')
  on conflict (sense_id) do nothing;

  insert into public.image_request_users (sense_id, user_id) values (p_sense_id, v_uid)
  on conflict do nothing
  returning true into v_new;
  v_new := coalesce(v_new, false);

  v_flat_only :=
    exists (
      select 1 from public.lexicon_images i
      where i.sense_id = p_sense_id and i.status <> 'rejected' and i.prompt_version <> 'image-v2')
    and not exists (
      select 1 from public.lexicon_images i
      where i.sense_id = p_sense_id and i.status <> 'rejected' and i.prompt_version = 'image-v2');

  update public.image_requests r set
    source = 'user',
    requesters = r.requesters + case when v_new then 1 else 0 end,
    priority = greatest(r.priority, 3000) + case when v_new then 100 else 0 end,
    -- A new requester puts a finished or declined sense back in the queue (another variant,
    -- or a picture "only if asked" for a low-visualizability meaning); so does any request
    -- for a finished sense that only has a flat picture.
    state = case
      when (v_new and r.state in ('done', 'skipped')) or (v_flat_only and r.state = 'done')
      then 'queued' else r.state end,
    attempt = case
      when (v_new and r.state in ('done', 'skipped')) or (v_flat_only and r.state = 'done')
      then 1 else r.attempt end,
    problem = case
      when (v_new and r.state in ('done', 'skipped')) or (v_flat_only and r.state = 'done')
      then null else r.problem end,
    updated_at = now()
  where r.sense_id = p_sense_id
  returning * into v_req;

  return jsonb_build_object('state', v_req.state, 'priority', v_req.priority);
end;
$$;

revoke all on function public.image_request(uuid) from public, anon;
grant execute on function public.image_request(uuid) to authenticated;

-- One-off: draw every finished or declined sense again in watercolour, unless it already has
-- a live image-v2 picture. Declined senses ('skipped' with last_error declined or refused, or
-- the instant path's not_visual) are drawn again too: the model may decline again, which only
-- costs one call. Requests skipped because the sense no longer exists ('sense not found',
-- scripts/lib/image-jobs.ts) stay as they are. Queued and submitted requests are not touched.
-- A function so the pgTAP tests can run it (32_image_watercolour.test.sql); the migration
-- calls it once below. Returns the number of requests queued again.
create or replace function public.image_requeue_watercolour()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with u as (
    update public.image_requests r set
      state = 'queued',
      attempt = 1,
      problem = null,
      batch_id = null,
      hold_id = null,
      last_error = null,
      updated_at = now()
    where r.state in ('done', 'skipped')
      and not (r.state = 'skipped' and coalesce(r.last_error, '') like 'sense not found%')
      and not exists (
        select 1 from public.lexicon_images i
        where i.sense_id = r.sense_id and i.status <> 'rejected' and i.prompt_version = 'image-v2')
    returning 1
  )
  select count(*)::integer from u
$$;

revoke all on function public.image_requeue_watercolour() from public, anon, authenticated;
grant execute on function public.image_requeue_watercolour() to service_role;

select public.image_requeue_watercolour();

comment on function public.image_insert(jsonb) is
  'Adds a picture as the sense''s next variant; an image-v2 picture in review or approved rejects the sense''s older-style live pictures (checks.replaced_by).';
comment on function public.image_queue_auto(integer, integer) is
  'Nightly: re-ranks queued auto requests and queues senses with no request and no live image-v2 picture, in priority order.';
