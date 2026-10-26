-- The reader (20261101000100_reader.sql, ADR 0043): user_texts and user_encounters are
-- registered mutable tables, pushed and pulled through the registry-driven sync functions
-- with last-writer-wins and tombstones, never returned to v0.1 clients, isolated per user
-- (RLS on auth.uid()); the settings gain the reading fields; a user's text never reaches a
-- shared table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------- shape
select has_table('public', 'user_texts', 'user_texts exists');
select has_table('public', 'user_encounters', 'user_encounters exists');
select is(
  (select string_agg(name || ':' || insert_only::text || ':' || conflict_key, ',' order by name)
     from public.sync_tables where name in ('user_texts', 'user_encounters')),
  'user_encounters:false:(user_id, id),user_texts:false:(id)',
  'both are registered as mutable synced tables');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.user_texts'::regclass, 'public.user_encounters'::regclass)),
  'both have RLS enabled');
select ok(
  not has_table_privilege('authenticated', 'public.user_texts', 'DELETE')
  and not has_table_privilege('authenticated', 'public.user_encounters', 'DELETE')
  and not has_table_privilege('anon', 'public.user_texts', 'SELECT')
  and not has_table_privilege('anon', 'public.user_encounters', 'SELECT'),
  'clients cannot hard-delete; anonymous users cannot read');
select has_column('public', 'settings', 'reading_difficulty', 'settings.reading_difficulty exists');
select has_column('public', 'settings', 'reading_offset', 'settings.reading_offset exists');
select has_column('public', 'settings', 'reader_highlight', 'settings.reader_highlight exists');

insert into auth.users (id, email, aud, role) values
  ('43434343-4343-4343-8343-434343434301', 'r1@test.local', 'authenticated', 'authenticated'),
  ('43434343-4343-4343-8343-434343434302', 'r2@test.local', 'authenticated', 'authenticated');

-- The shared tables before anything is pushed (the privacy check at the end).
create temporary table shared_before as
  select (select count(*) from public.lexicon_senses) as senses,
         (select count(*) from public.lexicon_examples) as examples,
         (select count(*) from public.ai_chunk_cache) as chunks;
grant select on shared_before to authenticated;

set local request.jwt.claims to '{"sub":"43434343-4343-4343-8343-434343434301","role":"authenticated"}';
set local request.jwt.claim.sub to '43434343-4343-4343-8343-434343434301';
set local role authenticated;

create function pg_temp.text_row(p_hlc text, p_title text default 'A walk', p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', '0193a000-0000-7000-8000-000000000043', 'user_id', '43434343-4343-4343-8343-434343434302',
    'kind', 'paste', 'title', p_title, 'body', 'I went for a walk in the park.',
    'source_url', null, 'graded_id', null, 'progress_offset', 0, 'read_ms', 0, 'finished_at', null,
    'feedback', null,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc) || p_extra
$$;
create function pg_temp.enc_row(p_hlc text, p_n int, p_device text default 'deva')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', '0193a000-0000-7000-8000-0000000000aa|2026-11-01|reader|' || p_device,
    'user_id', '43434343-4343-4343-8343-434343434302',
    'note_id', '0193a000-0000-7000-8000-0000000000aa', 'day', '2026-11-01', 'source', 'reader',
    'n', p_n, 'device_id', p_device,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.push(p_table text, p_payload jsonb, p_op text default 'upsert')
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', p_table, 'op', p_op, 'payload', p_payload)))
$$;

-- ---------------------------------------------------------------- user_texts
select is(
  pg_temp.push('user_texts', pg_temp.text_row('001761000000000:00001:deva')) -> 'acked',
  '["0193a000-0000-7000-8000-000000000043"]'::jsonb, 'a text is pushed');
select is((select user_id from public.user_texts), '43434343-4343-4343-8343-434343434301'::uuid,
  'user_id comes from the session, not the payload');
select is(
  pg_temp.push('user_texts', pg_temp.text_row('001761000000000:00000:deva', 'Old title')) -> 'stale',
  '["0193a000-0000-7000-8000-000000000043"]'::jsonb, 'an older edit is acked as stale');
create temporary table w1 as select pg_temp.push('user_texts',
  pg_temp.text_row('001761000000000:00005:deva', 'A walk', '{"progress_offset": 12, "read_ms": 64000, "feedback": "hard"}'));
select is((select progress_offset || ' ' || read_ms || ' ' || feedback from public.user_texts), '12 64000 hard',
  'a newer edit wins (reading position, time, feedback)');
-- An older client that does not know feedback pushes the row: the stored answer stays.
create temporary table w2 as select pg_temp.push('user_texts',
  pg_temp.text_row('001761000000000:00006:devb', 'A walk', '{"progress_offset": 20}') - 'feedback');
select is((select progress_offset || ' ' || feedback from public.user_texts), '20 hard',
  'a push without feedback keeps it');
select is(
  (select jsonb_array_length(pg_temp.push('user_texts',
    pg_temp.text_row('001761000000000:00007:deva', 'x', '{"kind": "website"}')) -> 'rejected')),
  1, 'an unknown kind is rejected');
select is(
  (select jsonb_array_length(pg_temp.push('user_texts',
    pg_temp.text_row('001761000000000:00008:deva', 'x', jsonb_build_object('body', repeat('a', 300001)))) -> 'rejected')),
  1, 'a body over 300 000 characters is rejected');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'user_texts'),
  1, 'sync_pull_v3 returns the text');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r where r ->> 'table' like 'user_%')
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r where r ->> 'table' like 'user_%'),
  0, 'v0.1 pulls never return reader rows');
create temporary table w3 as select pg_temp.push('user_texts', jsonb_build_object(
  'id', '0193a000-0000-7000-8000-000000000043', 'hlc', '001761000000000:00009:deva',
  'deleted_at', 1761000000900, 'updated_at', 1761000000900), 'delete');
select is((select deleted_at from public.user_texts), 1761000000900::bigint, 'a delete is a tombstone');

-- ---------------------------------------------------------------- user_encounters
select is(
  pg_temp.push('user_encounters', pg_temp.enc_row('001761000000000:00010:deva', 1)) -> 'acked',
  '["0193a000-0000-7000-8000-0000000000aa|2026-11-01|reader|deva"]'::jsonb, 'an encounter row is pushed');
create temporary table w4 as select pg_temp.push('user_encounters', pg_temp.enc_row('001761000000000:00011:deva', 2));
create temporary table w5 as select pg_temp.push('user_encounters', pg_temp.enc_row('001761000000000:00012:devb', 3, 'devb'));
select is((select sum(n)::int from public.user_encounters), 5,
  'each device keeps its own count; nothing is overwritten');
select is(
  (select jsonb_array_length(pg_temp.push('user_encounters',
    pg_temp.enc_row('001761000000000:00013:deva', 1) || '{"source": "dream"}') -> 'rejected')),
  1, 'an unknown source is rejected');
select is(
  (select jsonb_array_length(pg_temp.push('user_encounters',
    pg_temp.enc_row('001761000000000:00014:deva', -1)) -> 'rejected')),
  1, 'a negative count is rejected');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'user_encounters'),
  2, 'sync_pull_v3 returns the encounter rows');

-- ---------------------------------------------------------------- settings
create temporary table w6 as select pg_temp.push('settings', jsonb_build_object(
  'id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
  'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1',
  'reading_difficulty', 'rahat', 'reading_offset', 0.2, 'reader_highlight', false,
  'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', '001761000000000:00020:deva'));
select is((select reading_difficulty || ' ' || reading_offset || ' ' || reader_highlight from public.settings),
  'rahat 0.2 false', 'the reading settings are stored');
create temporary table w7 as select pg_temp.push('settings', jsonb_build_object(
  'id', 'settings', 'daily_new_limit', 20, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
  'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1',
  'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', '001761000000000:00021:devo'));
select is((select reading_difficulty || ' ' || reading_offset || ' ' || daily_new_limit from public.settings),
  'rahat 0.2 20', 'an older client''s push keeps them');
select throws_ok($$ update public.settings set reading_difficulty = 'kolay' $$, '23514', null,
  'an unknown difficulty is rejected');
select throws_ok($$ update public.settings set reading_offset = 0.9 $$, '23514', null,
  'an offset outside ±0.5 is rejected');

-- ---------------------------------------------------------------- another user
set local request.jwt.claims to '{"sub":"43434343-4343-4343-8343-434343434302","role":"authenticated"}';
set local request.jwt.claim.sub to '43434343-4343-4343-8343-434343434302';
select is((select count(*)::int from public.user_texts) + (select count(*)::int from public.user_encounters), 0,
  'another user sees none of the texts or encounters');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' like 'user_%'),
  0, 'and pulls none');
select is(
  pg_temp.push('user_encounters', pg_temp.enc_row('001761000000000:00001:devz', 7, 'devz')) -> 'acked',
  '["0193a000-0000-7000-8000-0000000000aa|2026-11-01|reader|devz"]'::jsonb,
  'the same derived id can exist for another user without touching the first one''s rows');
select throws_ok(
  $$ update public.user_texts set title = 'mine' where id = '0193a000-0000-7000-8000-000000000043' returning 1 $$,
  null, null, 'updating someone else''s text changes nothing');
reset role;
select is((select sum(n)::int from public.user_encounters where user_id = '43434343-4343-4343-8343-434343434301'), 5,
  'the first user''s counts are unchanged');
select is((select title from public.user_texts), 'A walk', 'and so is the first user''s text');

-- ---------------------------------------------------------------- privacy
select ok((select senses = (select count(*) from public.lexicon_senses)
                  and examples = (select count(*) from public.lexicon_examples)
                  and chunks = (select count(*) from public.ai_chunk_cache) from shared_before),
  'pushing texts and encounters writes nothing into the shared tables');
select is_empty($$
  select 1 from public.lexicon_senses where gloss_en like '%walk in the park%' or meaning_tr like '%walk in the park%'
$$, 'the text body appears in no shared row');

select * from finish();
rollback;
