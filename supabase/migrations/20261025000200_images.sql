-- Engapp v0.4 İP2: picture pipeline (docs/decisions/0030-image-pipeline.md, docs/ai-image.md).
--
--   lexicon_senses.visualizability / visual_hint   visual-v1 score (0 abstract … 3 concrete)
--   lexicon_images      shared pictures of lexicon senses (SVG, style B). Clients read approved
--                       rows, plus 'review' rows of senses in their own cards; nobody but the
--                       service role writes.
--   image_requests      one queue row per sense (auto or user); a user request bumps priority
--   image_budget(_holds) monthly Claude budget: reserve before a call, settle after
--   image_usage         instant pictures per user and UTC day (ai-image)
--   app_admins          who may review pictures (the owner); filled by hand or by the workflow
--   image_feedback      server-side record of review decisions (approve / reject / redraw)
--
-- Shared tables never store user text. Columns with cost and check details are not granted
-- to clients.

-- ---------------------------------------------------------------------------
-- Visualizability on the shared senses
-- ---------------------------------------------------------------------------
alter table public.lexicon_senses
  add column visualizability smallint check (visualizability between 0 and 3),
  add column visual_hint text check (char_length(visual_hint) between 1 and 300),
  add column visual_scored_at timestamptz;

create index lexicon_senses_visual_pending on public.lexicon_senses (id)
  where visual_scored_at is null;

-- Scoring thousands of senses must not make every device pull them again: the stamp trigger
-- (server_seq, updated_at) now skips updates that change only these columns. Inserts and every
-- other update are stamped exactly as before.
drop trigger stamp_lexicon_row on public.lexicon_senses;
create trigger stamp_lexicon_row before insert on public.lexicon_senses
  for each row execute function public.tg_stamp_lexicon_row();
create trigger stamp_lexicon_row_update before update on public.lexicon_senses
  for each row
  when (
    (pg_catalog.to_jsonb(old) - array['visualizability', 'visual_hint', 'visual_scored_at', 'server_seq'])
    is distinct from
    (pg_catalog.to_jsonb(new) - array['visualizability', 'visual_hint', 'visual_scored_at', 'server_seq'])
  )
  execute function public.tg_stamp_lexicon_row();

-- "Senses in anyone's cards" (auto queue, review visibility).
create index if not exists senses_lexicon_live on public.senses (lexicon_sense_id)
  where lexicon_sense_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- app_admins
-- ---------------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on table public.app_admins from anon, authenticated;
-- No policies: read through is_app_admin() only, written by the service role / SQL editor.

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
$$;

revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lexicon_images
-- ---------------------------------------------------------------------------
create table public.lexicon_images (
  id uuid primary key default gen_random_uuid(),
  sense_id uuid not null references public.lexicon_senses (id) on delete cascade,
  variant smallint not null check (variant >= 0),
  svg text not null check (octet_length(svg) <= 8192),
  alt_tr text not null default '' check (char_length(alt_tr) <= 200),
  status text not null check (status in ('checking', 'review', 'approved', 'rejected')),
  -- Server only: sanitizer/contrast/vision results, the model's confidence, the review decision.
  checks jsonb not null default '{}'::jsonb check (
    jsonb_typeof(checks) = 'object' and pg_column_size(checks) <= 8000),
  model text check (char_length(model) <= 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sense_id, variant),
  -- A picture anyone can see has an SVG and a description.
  check (status in ('checking', 'rejected') or (svg <> '' and alt_tr <> ''))
);

create index lexicon_images_sense on public.lexicon_images (sense_id, status);
create index lexicon_images_review on public.lexicon_images (created_at) where status = 'review';

alter table public.lexicon_images enable row level security;
revoke all on table public.lexicon_images from anon, authenticated;
grant select (id, sense_id, variant, svg, alt_tr, status, created_at)
  on table public.lexicon_images to authenticated;

create policy "images: approved, or in review for my own cards" on public.lexicon_images
  for select to authenticated
  using (
    status = 'approved'
    or (
      status = 'review'
      and exists (
        select 1 from public.senses s
        where s.user_id = (select auth.uid())
          and s.lexicon_sense_id = lexicon_images.sense_id
          and s.deleted_at is null
      )
    )
  );
-- No insert/update/delete policies: only the service role writes.

-- Adds a picture as the sense's next variant. p: {sense_id, svg, alt_tr, status, checks,
-- model, prompt_version, cost_usd}. Returns the row as the client sees it plus cost_usd.
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
  return jsonb_build_object(
    'id', v_row.id, 'sense_id', v_row.sense_id, 'variant', v_row.variant, 'svg', v_row.svg,
    'alt_tr', v_row.alt_tr, 'status', v_row.status, 'created_at', v_row.created_at,
    'cost_usd', v_row.cost_usd);
end;
$$;

revoke all on function public.image_insert(jsonb) from public, anon, authenticated;
grant execute on function public.image_insert(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- image_requests (queue) and image_request_users (distinct requesters)
-- ---------------------------------------------------------------------------
create table public.image_requests (
  sense_id uuid primary key references public.lexicon_senses (id) on delete cascade,
  source text not null check (source in ('auto', 'user')),
  priority integer not null default 0,
  requesters integer not null default 0 check (requesters >= 0),
  state text not null default 'queued' check (state in ('queued', 'submitted', 'done', 'skipped')),
  batch_id text check (char_length(batch_id) <= 200),
  -- 1 = first drawing, 2 = the one redraw after a failed check.
  attempt smallint not null default 1 check (attempt between 1 and 2),
  -- Why the next drawing is a redraw (a REDRAW_PROBLEMS key; never free text).
  problem text check (problem ~ '^[a-z_]{1,32}$'),
  -- Budget hold of the submitted batch request (settled by collect).
  hold_id uuid,
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index image_requests_queue on public.image_requests (priority desc, updated_at)
  where state = 'queued';
create index image_requests_batch on public.image_requests (batch_id) where state = 'submitted';

create table public.image_request_users (
  sense_id uuid not null references public.image_requests (sense_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sense_id, user_id)
);

alter table public.image_requests enable row level security;
alter table public.image_request_users enable row level security;
revoke all on table public.image_requests, public.image_request_users from anon, authenticated;
-- No policies: service role and the functions below only.

-- Priorities (higher first): admin redraw 4000; user request 3000 + 100 per distinct user;
-- auto: in an admin's (the owner's) cards 2000, in anyone's cards 1000 + users, else by word
-- frequency (zipf × 10).

-- A signed-in user asks for a picture of a sense in their own cards. Returns {state, priority}.
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

  update public.image_requests r set
    source = 'user',
    requesters = r.requesters + case when v_new then 1 else 0 end,
    priority = greatest(r.priority, 3000) + case when v_new then 100 else 0 end,
    -- A new requester puts a finished or declined sense back in the queue (another variant,
    -- or a picture "only if asked" for a low-visualizability meaning).
    state = case when v_new and r.state in ('done', 'skipped') then 'queued' else r.state end,
    attempt = case when v_new and r.state in ('done', 'skipped') then 1 else r.attempt end,
    problem = case when v_new and r.state in ('done', 'skipped') then null else r.problem end,
    updated_at = now()
  where r.sense_id = p_sense_id
  returning * into v_req;

  return jsonb_build_object('state', v_req.state, 'priority', v_req.priority);
end;
$$;

revoke all on function public.image_request(uuid) from public, anon;
grant execute on function public.image_request(uuid) to authenticated;

-- Nightly: queue senses scoring >= p_min that have no request and no live picture.
create or replace function public.image_queue_auto(p_min integer, p_limit integer)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with cand as (
    select ls.id,
      case
        when exists (
          select 1 from public.senses s join public.app_admins a on a.user_id = s.user_id
          where s.lexicon_sense_id = ls.id and s.deleted_at is null) then 2000
        when exists (
          select 1 from public.senses s where s.lexicon_sense_id = ls.id and s.deleted_at is null)
        then 1000 + (select count(distinct s.user_id)::integer from public.senses s
                     where s.lexicon_sense_id = ls.id and s.deleted_at is null)
        else coalesce(pg_catalog.round(t.zipf * 10)::integer, 0)
      end as priority
    from public.lexicon_senses ls
    join public.lexicon_terms t on t.id = ls.term_id
    where ls.visualizability >= p_min
      and not exists (select 1 from public.image_requests r where r.sense_id = ls.id)
      and not exists (
        select 1 from public.lexicon_images i where i.sense_id = ls.id and i.status <> 'rejected')
    order by 2 desc, ls.id
    limit greatest(0, least(p_limit, 10000))
  ), ins as (
    insert into public.image_requests (sense_id, source, priority)
    select id, 'auto', priority from cand
    on conflict (sense_id) do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;

revoke all on function public.image_queue_auto(integer, integer) from public, anon, authenticated;
grant execute on function public.image_queue_auto(integer, integer) to service_role;

-- What the model may see of senses: lemma, pos, Turkish meaning, hint. Nothing else.
create or replace function public.image_sense_inputs(p_sense_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sense_id', ls.id, 'lemma', t.lemma, 'pos', ls.pos, 'gloss_tr', ls.meaning_tr,
    'visual_hint', ls.visual_hint) order by ls.id), '[]'::jsonb)
  from public.lexicon_senses ls
  join public.lexicon_terms t on t.id = ls.term_id
  where ls.id = any (p_sense_ids)
$$;

revoke all on function public.image_sense_inputs(uuid[]) from public, anon, authenticated;
grant execute on function public.image_sense_inputs(uuid[]) to service_role;

create or replace function public.image_user_has_sense(p_user uuid, p_sense uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.senses s
    where s.user_id = p_user and s.lexicon_sense_id = p_sense and s.deleted_at is null)
$$;

revoke all on function public.image_user_has_sense(uuid, uuid) from public, anon, authenticated;
grant execute on function public.image_user_has_sense(uuid, uuid) to service_role;

-- Senses that visual-v1 has not scored yet: the ones in anyone's cards first, then by
-- word frequency. [{sense_id, lemma, pos, gloss_tr}]
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
    where ls.visual_scored_at is null
    order by
      exists (select 1 from public.senses s where s.lexicon_sense_id = ls.id and s.deleted_at is null) desc,
      t.zipf desc nulls last, ls.id
    limit greatest(0, least(p_limit, 5000))
  ) x
$$;

-- p_items: [{sense_id, score, hint}]. Returns the number of senses updated.
create or replace function public.image_visual_set(p_items jsonb)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with u as (
    update public.lexicon_senses ls set
      visualizability = (i ->> 'score')::smallint,
      visual_hint = nullif(pg_catalog.left(i ->> 'hint', 300), ''),
      visual_scored_at = now()
    from jsonb_array_elements(p_items) i
    where ls.id = (i ->> 'sense_id')::uuid
    returning 1
  )
  select count(*)::integer from u
$$;

revoke all on function public.image_visual_pending(integer) from public, anon, authenticated;
grant execute on function public.image_visual_pending(integer) to service_role;
revoke all on function public.image_visual_set(jsonb) from public, anon, authenticated;
grant execute on function public.image_visual_set(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Budget: reserve an upper bound before every model call, settle with the real cost after.
-- Refused when spent + held + amount > cap. The cap (80 % of CLAUDE_MONTHLY_CREDIT_USD) comes
-- from the caller and may change; a new month starts from zero.
-- ---------------------------------------------------------------------------
create table public.image_budget (
  month date primary key check (month = date_trunc('month', month)::date),
  cap_usd numeric(12, 6) not null check (cap_usd >= 0),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  updated_at timestamptz not null default now()
);

create table public.image_budget_holds (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.image_budget (month),
  amount_usd numeric(12, 6) not null check (amount_usd > 0),
  purpose text not null check (purpose in ('instant', 'batch', 'check', 'visual', 'pilot')),
  created_at timestamptz not null default now()
);

alter table public.image_budget enable row level security;
alter table public.image_budget_holds enable row level security;
revoke all on table public.image_budget, public.image_budget_holds from anon, authenticated;

-- Returns the hold id, or null when the month's budget cannot cover p_amount.
-- One statement takes the month row's lock (INSERT .. ON CONFLICT DO UPDATE .. WHERE), so
-- concurrent reservations are serialised and the sum never passes the cap.
create or replace function public.image_budget_reserve(p_amount numeric, p_cap numeric, p_purpose text)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_ok boolean;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_cap is null or p_cap < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_amount > p_cap then
    return null;
  end if;
  insert into public.image_budget as b (month, cap_usd, spent_usd, reserved_usd)
  values (v_month, p_cap, 0, p_amount)
  on conflict (month) do update
    set reserved_usd = b.reserved_usd + p_amount, cap_usd = p_cap, updated_at = now()
    where b.spent_usd + b.reserved_usd + p_amount <= p_cap
  returning true into v_ok;
  if v_ok is null then
    return null;
  end if;
  insert into public.image_budget_holds (month, amount_usd, purpose)
  values (v_month, p_amount, p_purpose)
  returning id into v_id;
  return v_id;
end;
$$;

-- Ends a hold: its amount leaves `reserved`, the real cost joins `spent` (of the hold's
-- month). An unknown hold (already settled or released) only adds the real cost.
create or replace function public.image_budget_settle(p_hold uuid, p_actual numeric)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_amount numeric;
begin
  if p_actual is null or p_actual < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  delete from public.image_budget_holds h where h.id = p_hold
  returning h.month, h.amount_usd into v_month, v_amount;
  if v_month is null then
    v_month := date_trunc('month', now() at time zone 'utc')::date;
    v_amount := 0;
    insert into public.image_budget (month, cap_usd) values (v_month, 0) on conflict do nothing;
  end if;
  update public.image_budget b set
    reserved_usd = greatest(0, b.reserved_usd - v_amount),
    spent_usd = b.spent_usd + p_actual,
    updated_at = now()
  where b.month = v_month;
end;
$$;

-- Holds of calls that never settled (a crashed function): counted as spent in full, which
-- errs on the safe side. Batch holds live until collect and are not touched here.
create or replace function public.image_budget_release_stale(p_older_than interval)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  h record;
  n integer := 0;
begin
  for h in
    select id, amount_usd from public.image_budget_holds
    where purpose <> 'batch' and created_at < now() - p_older_than
  loop
    perform public.image_budget_settle(h.id, h.amount_usd);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- {month, cap_usd, spent_usd, reserved_usd} of the current month (zeros when none yet).
create or replace function public.image_budget_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('month', b.month, 'cap_usd', b.cap_usd, 'spent_usd', b.spent_usd,
       'reserved_usd', b.reserved_usd)
     from public.image_budget b where b.month = date_trunc('month', now() at time zone 'utc')::date),
    jsonb_build_object('month', date_trunc('month', now() at time zone 'utc')::date,
      'cap_usd', 0, 'spent_usd', 0, 'reserved_usd', 0))
$$;

revoke all on function public.image_budget_reserve(numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.image_budget_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.image_budget_release_stale(interval) from public, anon, authenticated;
revoke all on function public.image_budget_status() from public, anon, authenticated;
grant execute on function public.image_budget_reserve(numeric, numeric, text) to service_role;
grant execute on function public.image_budget_settle(uuid, numeric) to service_role;
grant execute on function public.image_budget_release_stale(interval) to service_role;
grant execute on function public.image_budget_status() to service_role;

-- ---------------------------------------------------------------------------
-- Instant pictures per user and UTC day (same shape and locking as tts_consume)
-- ---------------------------------------------------------------------------
create table public.image_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);
alter table public.image_usage enable row level security;
revoke all on table public.image_usage from anon, authenticated;

create or replace function public.image_consume(p_user uuid, p_limit integer)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if p_user is null or p_limit is null or p_limit < 1 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  insert into public.image_usage as u (user_id, day, calls)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1
    where u.calls + 1 <= p_limit
  returning calls into v_used;
  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
  end if;
  select calls into v_used from public.image_usage where user_id = p_user and day = v_day;
  return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
end;
$$;

revoke all on function public.image_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.image_consume(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Review (admins only, checked here on the server)
-- ---------------------------------------------------------------------------
create table public.image_feedback (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.lexicon_images (id) on delete cascade,
  sense_id uuid not null,
  -- null = the automatic check; a reviewer's rows go with their account (ADR 0035).
  user_id uuid references auth.users (id) on delete cascade,
  decision text not null check (decision in ('approve', 'reject', 'redraw', 'check_failed')),
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index image_feedback_image on public.image_feedback (image_id);
alter table public.image_feedback enable row level security;
revoke all on table public.image_feedback from anon, authenticated;

-- Oldest 'review' pictures first: [{image, lemma, pos, gloss_tr}].
create or replace function public.image_review_queue(p_limit integer default 20)
returns table (image jsonb, lemma text, pos text, gloss_tr text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
    select
      jsonb_build_object('id', i.id, 'sense_id', i.sense_id, 'variant', i.variant, 'svg', i.svg,
        'alt_tr', i.alt_tr, 'status', i.status, 'created_at', i.created_at),
      t.lemma, ls.pos, ls.meaning_tr
    from public.lexicon_images i
    join public.lexicon_senses ls on ls.id = i.sense_id
    join public.lexicon_terms t on t.id = ls.term_id
    where i.status = 'review'
    order by i.created_at, i.id
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

-- approve → approved; reject → rejected; redraw → rejected and the sense queued again at the
-- top with the reason as the redraw problem. Every decision is kept in image_feedback.
create or replace function public.image_review_decide(p_image_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_img public.lexicon_images;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_problem text;
begin
  if not public.is_app_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject', 'redraw') then
    raise exception 'decision must be approve, reject or redraw' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_reason) > 200 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;
  select * into v_img from public.lexicon_images where id = p_image_id for update;
  if v_img.id is null then
    raise exception 'no such picture' using errcode = 'P0002';
  end if;
  if p_decision = 'approve' and (v_img.svg = '' or v_img.alt_tr = '') then
    raise exception 'this picture cannot be approved' using errcode = '22023';
  end if;

  update public.lexicon_images set
    status = case p_decision when 'approve' then 'approved' else 'rejected' end,
    checks = checks || jsonb_build_object('review', jsonb_build_object(
      'decision', p_decision, 'reason', v_reason, 'at', now())),
    updated_at = now()
  where id = p_image_id;

  insert into public.image_feedback (image_id, sense_id, user_id, decision, reason)
  values (p_image_id, v_img.sense_id, (select auth.uid()), p_decision, v_reason);

  if p_decision = 'redraw' then
    -- Only the fixed reasons reach the model; anything else becomes 'other'.
    v_problem := case when v_reason in ('wrong_meaning', 'unclear', 'ugly') then v_reason else 'other' end;
    insert into public.image_requests as r (sense_id, source, priority, state, attempt, problem)
    values (v_img.sense_id, 'auto', 4000, 'queued', 1, v_problem)
    on conflict (sense_id) do update set
      priority = greatest(r.priority, 4000),
      state = case when r.state = 'submitted' then r.state else 'queued' end,
      attempt = 1,
      problem = v_problem,
      updated_at = now();
  end if;
end;
$$;

revoke all on function public.image_review_queue(integer) from public, anon;
grant execute on function public.image_review_queue(integer) to authenticated;
revoke all on function public.image_review_decide(uuid, text, text) from public, anon;
grant execute on function public.image_review_decide(uuid, text, text) to authenticated;
