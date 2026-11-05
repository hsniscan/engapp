-- Engapp v0.5.3 (decision 0075, review "sağlamlık" item 3, the cheap and safe part): reclaim
-- database space that holds nothing a user needs.
--
-- 1. cron.job_run_details was never purged (about 200 rows a day from the 15-minute jobs).
--    Records older than 7 days are deleted every night; ops_health looks at the last day only.
-- 2. lexicon_images.checks (server-only diagnostics, up to 8 KB a picture): once a picture has
--    been approved or rejected for 30 days only a short summary is kept; a picture rejected
--    90 days ago also drops its SVG (nobody sees it, nothing reads it again).
-- 3. Library texts are no longer copied into every reader's account. A user_texts row of kind
--    'graded' points at the shared library text (graded_id); the server stores its body as ''
--    (trigger graded_body_ref). The device keeps its own copy of the plain text (made from the
--    library sentences when the text is opened, decision 0054) and never replaces it with the
--    empty server body (src/domain/syncMerge.ts keepGradedBody). Existing rows are emptied with
--    their HLC unchanged, so no device takes the empty body over its own copy. Graded rows no
--    longer count towards the text quota.

-- ---------------------------------------------------------------------------
-- 1 + 2. nightly purges
-- ---------------------------------------------------------------------------

create or replace function public.purge_image_checks(p_days integer default 30, p_svg_days integer default 90)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_checks integer;
  v_svgs integer;
begin
  -- Keep the scalar facts (verdicts, costs, attempts, the review decision); drop reports.
  update public.lexicon_images i set checks = (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each(i.checks) as e(k, v)
      where k in ('vision', 'vision_cost_usd', 'confidence', 'attempt', 'problem', 'redraw_of',
                  'replaced_by', 'batch', 'sanitize')
        and jsonb_typeof(v) in ('string', 'number', 'boolean')
    ) || case when i.checks ? 'review'
         then jsonb_build_object('review', jsonb_build_object('decision', i.checks -> 'review' -> 'decision',
                                                              'at', i.checks -> 'review' -> 'at'))
         else '{}'::jsonb end
  where i.status in ('approved', 'rejected')
    and i.updated_at < now() - make_interval(days => greatest(p_days, 1))
    and pg_catalog.pg_column_size(i.checks) > 300;
  get diagnostics v_checks = row_count;

  update public.lexicon_images i set svg = ''
  where i.status = 'rejected' and i.svg <> ''
    and i.updated_at < now() - make_interval(days => greatest(p_svg_days, 30));
  get diagnostics v_svgs = row_count;

  return jsonb_build_object('checks_trimmed', v_checks, 'svgs_dropped', v_svgs);
end;
$$;

revoke all on function public.purge_image_checks(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_image_checks(integer, integer) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-cron-history', '41 3 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '7 days'$q$);
    perform cron.schedule('engapp-purge-image-checks', '43 3 * * *', 'select public.purge_image_checks(30, 90)');
  else
    raise notice 'pg_cron is not available: purge cron.job_run_details and run public.purge_image_checks() manually';
  end if;
exception when others then
  raise notice 'could not schedule the cleanup jobs with pg_cron (%): run them manually', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. library texts by reference
-- ---------------------------------------------------------------------------

create or replace function public.tg_user_texts_graded_body()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'graded' and new.graded_id is not null then
    new.body := '';
  end if;
  return new;
end;
$$;

-- Fires before quota_db_guard, quota_user_texts and stamp_sync_row (name order).
create trigger graded_body_ref before insert or update on public.user_texts
  for each row execute function public.tg_user_texts_graded_body();

revoke all on function public.tg_user_texts_graded_body() from public, anon, authenticated;

-- The text quota counts the user's own texts only (a library text costs a few hundred bytes).
create or replace function public.tg_user_texts_quota()
returns trigger
language plpgsql
security definer -- counts the user's rows regardless of the caller's grants
set search_path = ''
as $$
declare
  v_rows bigint;
  v_bytes bigint;
begin
  if new.kind = 'graded' and new.graded_id is not null then
    return new;
  end if;
  select count(*), coalesce(sum(octet_length(t.body)), 0) into v_rows, v_bytes
  from public.user_texts t
  where t.user_id = new.user_id and not (t.kind = 'graded' and t.graded_id is not null);
  if v_rows + 1 > (select value from public.sync_limits where name = 'texts_per_user')
     or v_bytes + octet_length(new.body) > (select value from public.sync_limits where name = 'text_bytes_per_user') then
    raise exception 'quota: too many saved texts' using errcode = '53400';
  end if;
  return new;
end;
$$;

-- Existing copies: emptied without a new HLC (devices keep their own copy, see above).
update public.user_texts set body = '' where kind = 'graded' and graded_id is not null and body <> '';
