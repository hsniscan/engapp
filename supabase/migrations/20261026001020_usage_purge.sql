-- Engapp v0.4 İP10: the privacy policy says daily usage counters are deleted after 90 days
-- (src/legal/privacy.*.ts, "saklama"). purge_tombstones() does that for ai_usage only; the
-- read-aloud (tts_usage) and instant-picture (image_usage) counters were kept forever.
-- docs/decisions/0037-maintenance-jobs.md.

create or replace function public.purge_usage_counters(p_days integer default 90)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff date := (now() at time zone 'utc')::date - greatest(p_days, 1);
  v_tts integer;
  v_image integer;
begin
  delete from public.tts_usage where day < v_cutoff;
  get diagnostics v_tts = row_count;
  delete from public.image_usage where day < v_cutoff;
  get diagnostics v_image = row_count;
  return jsonb_build_object('tts_usage', v_tts, 'image_usage', v_image);
end;
$$;

revoke all on function public.purge_usage_counters(integer) from public, anon, authenticated;
grant execute on function public.purge_usage_counters(integer) to service_role;

-- Daily at 03:27 UTC with pg_cron when available (as purge_tombstones, 20261021000500).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-usage', '27 3 * * *', 'select public.purge_usage_counters(90)');
  else
    raise notice 'pg_cron is not available: schedule public.purge_usage_counters(90) manually';
  end if;
exception when others then
  raise notice 'could not schedule the usage purge with pg_cron (%): schedule public.purge_usage_counters(90) manually', sqlerrm;
end;
$$;
