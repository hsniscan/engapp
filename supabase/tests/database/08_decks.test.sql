-- decks (20261022000400_decks.sql): a registered mutable table. Pushed and pulled through the
-- registry-driven sync functions with last-writer-wins and tombstones, never returned to
-- v0.1 clients, isolated per user, filter stored as an opaque JSON object.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'decks', 'decks exists');
select is(
  (select insert_only from public.sync_tables where name = 'decks'), false,
  'decks is registered as a mutable synced table');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.decks'::regclass),
  'decks has RLS enabled');
select ok(
  not has_table_privilege('authenticated', 'public.decks', 'DELETE')
  and not has_table_privilege('anon', 'public.decks', 'SELECT'),
  'clients cannot hard-delete decks; anonymous users cannot read them');

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-4777-8777-777777777777', 'g@test.local', 'authenticated', 'authenticated'),
  ('88888888-8888-4888-8888-888888888888', 'h@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

create function pg_temp.deck(p_name text, p_hlc text, p_filter jsonb default '{"v":1,"states":["struggling"],"tags":["iş"]}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'dddddddd-0000-7000-8000-000000000001', 'user_id', '88888888-8888-4888-8888-888888888888',
    'name', p_name, 'filter', p_filter, 'sort', 1,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc)
$$;

select is(
  (public.sync_push(jsonb_build_array(jsonb_build_object('table', 'decks', 'op', 'upsert', 'payload',
    pg_temp.deck('İş · zorlandıklarım', '001761000000000:00001:devd')))) -> 'acked'),
  '["dddddddd-0000-7000-8000-000000000001"]'::jsonb, 'a deck is pushed');
select is((select user_id from public.decks), '77777777-7777-4777-8777-777777777777'::uuid,
  'user_id comes from the session, not the payload');
select is((select filter -> 'tags' ->> 0 from public.decks), 'iş', 'the filter JSON is stored as sent');

-- Newer and older writes (last writer wins by hlc).
select is(
  (public.sync_push(jsonb_build_array(jsonb_build_object('table', 'decks', 'op', 'upsert', 'payload',
    pg_temp.deck('Eski ad', '001761000000000:00000:devd')))) -> 'stale'),
  '["dddddddd-0000-7000-8000-000000000001"]'::jsonb, 'an older edit is acked as stale');
create temporary table w1 as select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'decks', 'op', 'upsert', 'payload',
  pg_temp.deck('İş', '001761000000000:00005:devd', '{"v":1,"tags":["iş"],"levels":["B2"],"future_key":true}'))));
select is((select name from public.decks), 'İş', 'a newer edit wins');
select ok((select filter ? 'future_key' from public.decks), 'keys unknown to the server are kept (versioned client schema)');

select is(
  (select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'decks', 'op', 'upsert', 'payload',
    pg_temp.deck('Bozuk', '001761000000000:00006:devd', '[1,2]')))) -> 'rejected')),
  1, 'a filter that is not a JSON object is rejected');

-- Pull.
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'decks'),
  1, 'sync_pull_v3 returns the deck');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r where r ->> 'table' = 'decks')
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r where r ->> 'table' = 'decks'),
  0, 'v0.1 pulls never return decks');

-- Tombstone.
create temporary table w2 as select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'decks', 'op', 'delete', 'payload',
  jsonb_build_object('id', 'dddddddd-0000-7000-8000-000000000001', 'hlc', '001761000000000:00007:devd',
    'deleted_at', 1761000000500, 'updated_at', 1761000000500))));
select is((select deleted_at from public.decks), 1761000000500::bigint, 'a delete is a tombstone');
select is(
  (select r -> 'row' ->> 'deleted_at' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'decks'),
  '1761000000500', 'and the tombstone is pulled');

-- Another user.
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
select is((select count(*)::int from public.decks), 0, 'another user sees no decks');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'decks'),
  0, 'and pulls none');

select * from finish();
rollback;
