-- The daily story (20261101000800_story.sql): one story per user and day plus one
-- regeneration, service role only, refunds, purged after 90 days; user_texts.story is the
-- user's own row under the RLS of user_texts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email, aud, role) values
  ('50505050-5050-4050-8050-505050505051', 's1@test.local', 'authenticated', 'authenticated'),
  ('50505050-5050-4050-8050-505050505052', 's2@test.local', 'authenticated', 'authenticated');

set local role service_role;
select is(public.story_consume('50505050-5050-4050-8050-505050505051', true, 1),
  '{"allowed": false, "used": 0, "limit": 1}'::jsonb, 'no regeneration before a story');
select is(public.story_consume('50505050-5050-4050-8050-505050505051', false, 1),
  '{"allowed": true, "used": 1, "limit": 1}'::jsonb, 'the first story of the day is allowed');
select is(public.story_consume('50505050-5050-4050-8050-505050505051', false, 1),
  '{"allowed": false, "used": 1, "limit": 1}'::jsonb, 'a second story the same day is refused');
select is((public.story_consume('50505050-5050-4050-8050-505050505051', true, 1) ->> 'allowed')::boolean,
  true, 'one regeneration of today''s story is allowed');
select is((public.story_consume('50505050-5050-4050-8050-505050505051', true, 1) ->> 'allowed')::boolean,
  false, 'a second regeneration is refused');
select is((public.story_consume('50505050-5050-4050-8050-505050505052', false, 1) ->> 'used')::int, 1,
  'counters are per user');
select throws_ok($$ select public.story_consume(null, false, 1) $$, '22023', null, 'a user is required');
select throws_ok($$ select public.story_consume('50505050-5050-4050-8050-505050505051', false, 0) $$,
  '22023', null, 'the limit must be positive');

-- Refunds: a failed regeneration, then a failed story, give the counts back.
select public.story_refund('50505050-5050-4050-8050-505050505051', true);
select is((select retries from public.story_usage where user_id = '50505050-5050-4050-8050-505050505051'), 0,
  'a refunded regeneration can be asked again');
select public.story_refund('50505050-5050-4050-8050-505050505051', false);
select is((select stories from public.story_usage where user_id = '50505050-5050-4050-8050-505050505051'), 0,
  'a refunded story can be asked again');
select public.story_refund('50505050-5050-4050-8050-505050505051', false);
select is((select stories from public.story_usage where user_id = '50505050-5050-4050-8050-505050505051'), 0,
  'a refund never goes below zero');
select is((public.story_consume('50505050-5050-4050-8050-505050505051', false, 1) ->> 'allowed')::boolean,
  true, 'after the refund the day''s story is allowed again');

reset role;
insert into public.story_usage (user_id, day, stories) values
  ('50505050-5050-4050-8050-505050505052', current_date - 120, 1);
set local role service_role;
select is(public.purge_story_usage(90), 1, 'counters older than 90 days are purged');
select is((select count(*)::int from public.story_usage where user_id = '50505050-5050-4050-8050-505050505052'), 1,
  'today''s counter stays');

select is((select count(*)::int from information_schema.columns
  where table_schema = 'public' and table_name = 'story_usage'
    and column_name not in ('user_id', 'day', 'stories', 'retries', 'picked', 'picked_retries')), 0,
  'the counter table has no column that could hold a word or a text');

-- user_texts.story: pushed with the row through sync_push, read back only by the owner.
reset role;
set local request.jwt.claims to '{"sub":"50505050-5050-4050-8050-505050505051","role":"authenticated"}';
set local request.jwt.claim.sub to '50505050-5050-4050-8050-505050505051';
set local role authenticated;
create function pg_temp.story_row(p_hlc text, p_story jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', '0193a000-0000-7000-8000-000000000050', 'kind', 'story', 'title', 'A walk',
    'body', 'They walked to the river.', 'source_url', null, 'graded_id', null,
    'progress_offset', 0, 'read_ms', 0, 'finished_at', null, 'feedback', null,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc,
    'story', p_story)
$$;
create function pg_temp.push(p_payload jsonb)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'user_texts', 'op', 'upsert', 'payload', p_payload)))
$$;
select is(pg_temp.push(pg_temp.story_row('001761000000000:00001:deva',
    '{"day": "2026-11-01", "targets": [], "questions": []}')) -> 'acked',
  '["0193a000-0000-7000-8000-000000000050"]'::jsonb, 'a story with its extras is pushed');
select is((select story ->> 'day' from public.user_texts), '2026-11-01', 'the owner reads the extras back');
select is(jsonb_array_length(pg_temp.push(pg_temp.story_row('001761000000000:00002:deva', '[1, 2]')) -> 'rejected'), 1,
  'extras that are not a JSON object are rejected');

reset role;
set local request.jwt.claims to '{"sub":"50505050-5050-4050-8050-505050505052","role":"authenticated"}';
set local request.jwt.claim.sub to '50505050-5050-4050-8050-505050505052';
set local role authenticated;
select is((select count(*)::int from public.user_texts), 0, 'another user sees no story');
select throws_ok($$ select public.story_consume('50505050-5050-4050-8050-505050505052', false, 1000) $$,
  '42501', null, 'clients cannot use the story budget function');
select throws_ok($$ select * from public.story_usage $$,
  '42501', null, 'clients cannot read story_usage');

select * from finish();
rollback;
