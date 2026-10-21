-- settings.interests / settings.muted_topics / sources.topics (20261022000300_interests_profile.sql):
-- they round-trip through sync_push / sync_pull_v3, an older client's row (without them) keeps
-- the stored lists, an empty list clears, oversized lists are rejected, rows stay per user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-4777-8777-777777777777', 'p@test.local', 'authenticated', 'authenticated'),
  ('78787878-7878-4878-8878-787878787878', 'q@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

create function pg_temp.push(p_table text, p_payload jsonb)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', p_table, 'op', 'upsert', 'payload', p_payload)))
$$;

-- A settings row as a v0.1 client sends it (no profile fields).
create function pg_temp.settings(p_theme text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object('id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9,
    'timezone', 'Europe/Istanbul', 'day_start_hour', 4, 'theme', p_theme, 'voice', 'en-US', 'level', 'B1',
    'fsrs_params', null, 'last_backup_at', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;

create function pg_temp.source(p_title text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object('id', '77777777-0000-7000-8000-000000000001', 'kind', 'text', 'title', p_title,
    'file_name', null, 'page_count', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;

select has_column('public', 'settings', 'interests', 'settings has interests');
select has_column('public', 'settings', 'muted_topics', 'settings has muted_topics');
select has_column('public', 'sources', 'topics', 'sources has topics');

-- ---------------------------------------------------------------- settings

select is(pg_temp.push('settings', pg_temp.settings('system', '001761000000000:00001:devp')
    || '{"interests":["technology","travel"],"muted_topics":["sports"]}'::jsonb) -> 'acked',
  '["settings"]'::jsonb, 'settings with interests are pushed');

select is(
  (select r -> 'row' -> 'interests' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  '["technology", "travel"]'::jsonb, 'interests come back on pull');

-- An older device changes the theme: its row has no profile fields.
select is(pg_temp.push('settings', pg_temp.settings('dark', '001761000000000:00002:devo')) -> 'stale',
  '[]'::jsonb, 'an older client''s settings row is applied');
select results_eq(
  $$ select theme, interests, muted_topics from public.settings $$,
  $$ values ('dark'::text, array['technology', 'travel']::text[], array['sports']::text[]) $$,
  'its change lands and the lists are kept');

select lives_ok(
  $$ select pg_temp.push('settings', pg_temp.settings('dark', '001761000000000:00003:devp')
       || '{"interests":[],"muted_topics":[]}'::jsonb) $$,
  'a newer client clears the lists with []');
select results_eq(
  $$ select interests, muted_topics from public.settings $$,
  $$ values ('{}'::text[], '{}'::text[]) $$,
  'an empty list is stored as empty, not kept');

select is(jsonb_array_length(pg_temp.push('settings', pg_temp.settings('dark', '001761000000000:00004:devp')
    || jsonb_build_object('interests', (select jsonb_agg('t' || g) from generate_series(1, 41) g))) -> 'rejected'),
  1, 'more than 40 topics are rejected');
select is(jsonb_array_length(pg_temp.push('settings', pg_temp.settings('dark', '001761000000000:00005:devp')
    || jsonb_build_object('interests', jsonb_build_array(repeat('x', 41)))) -> 'rejected'),
  1, 'a topic key over 40 characters is rejected');

-- ---------------------------------------------------------------- sources

select is(pg_temp.push('sources', pg_temp.source('Article', '001761000000000:00006:devp')
    || '{"topics":["science"]}'::jsonb) -> 'acked',
  '["77777777-0000-7000-8000-000000000001"]'::jsonb, 'a source with topics is pushed');
select lives_ok(
  $$ select pg_temp.push('sources', pg_temp.source('Renamed', '001761000000000:00007:devo')) $$,
  'an older client updates the source without topics');
select results_eq(
  $$ select title, topics from public.sources $$,
  $$ values ('Renamed'::text, array['science']::text[]) $$,
  'the source keeps its topics');

-- ---------------------------------------------------------------- isolation

set local request.jwt.claims to '{"sub":"78787878-7878-4878-8878-787878787878","role":"authenticated"}';
set local request.jwt.claim.sub to '78787878-7878-4878-8878-787878787878';
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' in ('settings', 'sources')),
  0, 'another user pulls none of these rows');

select * from finish();
rollback;
