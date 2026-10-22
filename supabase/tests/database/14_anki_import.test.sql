-- Anki import (20261023000100_anki_import.sql): review_logs.origin labels imported answers,
-- a log pushed without the column (older app) is stored as 'app', an unknown origin is
-- rejected, logs stay append-only, and sources accept kind 'anki'.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_column('public', 'review_logs', 'origin', 'review_logs.origin');

insert into auth.users (id, email, aud, role) values
  ('99999999-9999-4999-8999-999999999999', 'anki@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999999';
set local role authenticated;

create function pg_temp.rlog(p_id uuid, p_hlc text, p_origin text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'card_id', 'eeeeeeee-0000-7000-8000-000000000001', 'rating', 3,
    'reviewed_at', 1750000000000, 'duration_ms', 4000, 'device_id', 'deva', 'undo_of', null,
    'shown_sense_id', null, 'created_at', 1761000000000, 'hlc', p_hlc)
    || case when p_origin is null then '{}'::jsonb else jsonb_build_object('origin', p_origin) end
$$;

select is((public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
    pg_temp.rlog('eeeeeeee-0000-7000-8000-0000000000a1', '001761000000000:00001:deva', 'anki')),
  jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
    pg_temp.rlog('eeeeeeee-0000-7000-8000-0000000000a2', '001761000000000:00002:deva', null))
)) -> 'acked'),
  '["eeeeeeee-0000-7000-8000-0000000000a1", "eeeeeeee-0000-7000-8000-0000000000a2"]'::jsonb,
  'an imported log and a log without origin are both accepted');
select is((select origin from public.review_logs where id = 'eeeeeeee-0000-7000-8000-0000000000a1'),
  'anki', 'the imported log keeps origin anki');
select is((select origin from public.review_logs where id = 'eeeeeeee-0000-7000-8000-0000000000a2'),
  'app', 'a log from an older app version is stored as app');

select is(jsonb_array_length(public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
    pg_temp.rlog('eeeeeeee-0000-7000-8000-0000000000a3', '001761000000000:00003:deva', 'other'))
)) -> 'rejected'), 1, 'an unknown origin is rejected');

-- Append-only: the same id again changes nothing.
select is((public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
    pg_temp.rlog('eeeeeeee-0000-7000-8000-0000000000a1', '001761000000000:00009:deva', 'app'))
)) -> 'acked'), '["eeeeeeee-0000-7000-8000-0000000000a1"]'::jsonb, 'a repeated log is acked');
select is((select origin from public.review_logs where id = 'eeeeeeee-0000-7000-8000-0000000000a1'),
  'anki', 'and the stored log is unchanged');

select is((public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'sources', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'eeeeeeee-0000-7000-8000-0000000000b1', 'kind', 'anki', 'title', 'english',
    'file_name', 'english.apkg', 'page_count', null, 'created_at', 1761000000000,
    'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00004:deva'))
)) -> 'acked'), '["eeeeeeee-0000-7000-8000-0000000000b1"]'::jsonb, 'an anki source is accepted');

select ok(exists (
  select 1 from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
  where r ->> 'table' = 'review_logs' and r -> 'row' ->> 'origin' = 'anki'),
  'pulled logs carry their origin');

select * from finish();
rollback;
