-- One user can neither read nor write another user's rows; review_logs are append-only;
-- sync_push / sync_pull behave as documented in docs/sync-strategy.md.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Two users. (Inserting into auth.users fires the profile trigger.)
insert into auth.users (id, email, aud, role, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'a@test.local', 'authenticated', 'authenticated', '{"full_name":"User A"}'),
  ('22222222-2222-4222-8222-222222222222', 'b@test.local', 'authenticated', 'authenticated', '{}');

select is(
  (select display_name from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'),
  'User A', 'profile row is created for a new auth user');

-- Payload helpers (plain SQL so they can be reused under any role).
create function pg_temp.note(p_id uuid, p_term text, p_hlc text, p_user uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', p_user, 'term', p_term, 'term_norm', lower(p_term), 'term_type', 'word',
    'lexicon_term_id', null, 'ipa', null, 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.log(p_id uuid, p_card uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'card_id', p_card, 'rating', 3, 'reviewed_at', 1761000000000, 'duration_ms', 4200,
    'device_id', 'dev-a', 'undo_of', null, 'shown_sense_id', null, 'created_at', 1761000000000,
    'hlc', '001761000000000:00001:deva')
$$;
grant execute on function pg_temp.note(uuid, text, text, uuid), pg_temp.log(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- user A pushes
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub to '11111111-1111-4111-8111-111111111111'; -- older auth.uid() reads this one
set local role authenticated;

create temporary table r as
select public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload',
    pg_temp.note('aaaaaaaa-0000-7000-8000-000000000001', 'bank', '001761000000000:00001:deva',
                 '22222222-2222-4222-8222-222222222222')), -- spoofed user_id: must be ignored
  jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
    pg_temp.log('aaaaaaaa-0000-7000-8000-0000000000a1', 'aaaaaaaa-0000-7000-8000-0000000000c1')),
  jsonb_build_object('table', 'nope', 'op', 'upsert', 'payload', '{"id":"x"}'::jsonb),
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload',
    pg_temp.note('aaaaaaaa-0000-7000-8000-000000000002', 'bad', 'not-an-hlc'))
)) as res;

select is((select res -> 'acked' from r),
  '["aaaaaaaa-0000-7000-8000-000000000001","aaaaaaaa-0000-7000-8000-0000000000a1"]'::jsonb,
  'push acks the valid rows');
select is((select jsonb_array_length(res -> 'rejected') from r), 2, 'push rejects unknown table and bad hlc');
select is((select user_id from public.notes where id = 'aaaaaaaa-0000-7000-8000-000000000001'),
  '11111111-1111-4111-8111-111111111111'::uuid, 'user_id comes from auth.uid(), not the payload');
select ok((select server_seq > 0 from public.notes where id = 'aaaaaaaa-0000-7000-8000-000000000001'),
  'server_seq is stamped');

-- Same batch again: idempotent.
select is(
  public.sync_push(jsonb_build_array(
    jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload',
      pg_temp.note('aaaaaaaa-0000-7000-8000-000000000001', 'bank', '001761000000000:00001:deva')),
    jsonb_build_object('table', 'review_logs', 'op', 'upsert', 'payload',
      pg_temp.log('aaaaaaaa-0000-7000-8000-0000000000a1', 'aaaaaaaa-0000-7000-8000-0000000000c1')))) -> 'stale',
  '["aaaaaaaa-0000-7000-8000-000000000001"]'::jsonb,
  're-sent row with equal hlc is acked as stale');
select is((select count(*)::int from public.review_logs), 1, 'duplicate review log is ignored');

-- Last writer wins on hlc.
select is(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload',
  pg_temp.note('aaaaaaaa-0000-7000-8000-000000000001', 'bank2', '001761000000500:00000:devb')))) -> 'stale',
  '[]'::jsonb, 'newer hlc applies');
select is(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload',
  pg_temp.note('aaaaaaaa-0000-7000-8000-000000000001', 'bank-old', '001761000000100:00000:deva')))) -> 'stale',
  '["aaaaaaaa-0000-7000-8000-000000000001"]'::jsonb, 'older hlc is reported stale');
select is((select term from public.notes where id = 'aaaaaaaa-0000-7000-8000-000000000001'), 'bank2',
  'newer hlc wins, older hlc is ignored');

-- Delete = tombstone, with a minimal payload.
select is(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'delete', 'payload',
  '{"id":"aaaaaaaa-0000-7000-8000-000000000001","hlc":"001761000000600:00000:deva","deleted_at":1761000000600}'::jsonb))) -> 'stale',
  '[]'::jsonb, 'delete with newer hlc applies');
select is((select deleted_at from public.notes where id = 'aaaaaaaa-0000-7000-8000-000000000001'),
  1761000000600::bigint, 'delete sets deleted_at');

-- review_logs are immutable for clients.
select throws_ok(
  $$ update public.review_logs set rating = 1 $$, '42501', null, 'review_logs cannot be updated');
select throws_ok(
  $$ delete from public.review_logs $$, '42501', null, 'review_logs cannot be deleted');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object(
  'table', 'review_logs', 'op', 'delete', 'payload',
  pg_temp.log('aaaaaaaa-0000-7000-8000-0000000000a1', 'aaaaaaaa-0000-7000-8000-0000000000c1')))) -> 'rejected')),
  1, 'review_logs delete via push is rejected');
select throws_ok($$ delete from public.notes $$, '42501', null, 'hard delete of notes is not granted');

-- Pull.
select is((select jsonb_array_length(public.sync_pull(0, 500) -> 'rows')), 2, 'A pulls its two rows');
select ok(not (public.sync_pull(0, 500) -> 'rows' -> 0 -> 'row' ? 'server_seq'), 'server columns are stripped');
select is((select (public.sync_pull(0, 1) ->> 'has_more')::boolean), true, 'pagination: has_more');
select is(
  (select jsonb_array_length(public.sync_pull((public.sync_pull(0, 1) ->> 'next_seq')::bigint, 500) -> 'rows')),
  1, 'pagination: next page from next_seq');
select throws_ok($$ select public.sync_push((select jsonb_agg('{}'::jsonb) from generate_series(1, 101))) $$,
  '22023', null, 'batches over 100 rows are refused');

-- Settings rows use (user_id, id): both users can own id = 'settings'.
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":10,"request_retention":0.9,"timezone":"Europe/Istanbul","day_start_hour":4,"theme":"system","voice":"en-US","level":"B1","fsrs_params":null,"last_backup_at":null,"created_at":1,"updated_at":1,"deleted_at":null,"hlc":"001761000000000:00000:deva"}'::jsonb))) -> 'acked')),
  1, 'A stores settings');

-- ---------------------------------------------------------------- user B
reset role;
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
set local request.jwt.claim.sub to '22222222-2222-4222-8222-222222222222'; -- older auth.uid() reads this one
set local role authenticated;

select is_empty($$ select id from public.notes $$, 'B cannot read A''s notes');
select is_empty($$ select id from public.review_logs $$, 'B cannot read A''s review logs');
select is((select jsonb_array_length(public.sync_pull(0, 500) -> 'rows')), 0, 'B pulls nothing of A');

update public.notes set term = 'hacked';
select is((select count(*)::int from public.notes), 0, 'B''s update touches no rows');

select throws_ok(
  $$ insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc)
     values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'x', 'x', 'word', 1, 1, '001761000000000:00000:devb') $$,
  '42501', null, 'B cannot insert rows owned by A');

-- B pushes a row with A's id and a newer hlc: rejected by RLS, A's row untouched.
select is((select res -> 'rejected' -> 0 ->> 'code' from (select public.sync_push(jsonb_build_array(jsonb_build_object(
  'table', 'notes', 'op', 'upsert', 'payload',
  pg_temp.note('aaaaaaaa-0000-7000-8000-000000000001', 'stolen', '009999999999999:00000:devb')))) as res) x),
  '42501', 'B cannot overwrite A''s row through push');
select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert',
  'payload', '{"id":"settings","daily_new_limit":20,"request_retention":0.9,"timezone":"UTC","day_start_hour":4,"theme":"dark","voice":"en-GB","level":"B2","fsrs_params":null,"last_backup_at":null,"created_at":1,"updated_at":1,"deleted_at":null,"hlc":"001761000000000:00000:devb"}'::jsonb))) -> 'acked')),
  1, 'B stores its own settings row with the same id');

-- ---------------------------------------------------------------- checks as owner
reset role;
select is((select term from public.notes where id = 'aaaaaaaa-0000-7000-8000-000000000001'), 'bank2',
  'A''s note is unchanged');
select is((select count(*)::int from public.settings where user_id in
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2, 'two settings rows, one per user');

-- Tombstone purge -> full_resync for an old cursor.
-- (the stamp trigger would reset server_updated_at, so age the row with it disabled)
alter table public.notes disable trigger stamp_sync_row;
update public.notes set server_updated_at = now() - interval '31 days'
  where id = 'aaaaaaaa-0000-7000-8000-000000000001';
alter table public.notes enable trigger stamp_sync_row;
select is((public.purge_tombstones(30) ->> 'notes')::int, 1, 'purge removes the 31-day-old tombstone');

set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub to '11111111-1111-4111-8111-111111111111'; -- older auth.uid() reads this one
set local role authenticated;
select is((public.sync_pull(1, 500) ->> 'full_resync')::boolean, true, 'cursor below the horizon -> full_resync');
select is((public.sync_pull(0, 500) ->> 'full_resync')::boolean, false, 'pull from 0 is never a full resync');

-- anon gets nothing.
reset role;
set local role anon;
select throws_ok($$ select * from public.notes $$, '42501', null, 'anon cannot read notes');

select * from finish();
rollback;
