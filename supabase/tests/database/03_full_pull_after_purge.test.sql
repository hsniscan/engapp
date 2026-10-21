-- A full pull (from cursor 0) must be able to page past a purged tombstone
-- (20261021000600_sync_pull_from.sql). sync_pull answered full_resync on page 2.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, aud, role)
values ('33333333-3333-4333-8333-333333333333', 'c@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
set local request.jwt.claim.sub to '33333333-3333-4333-8333-333333333333';
set local role authenticated;

-- Three live notes, then a fourth that is deleted (its tombstone has the highest seq).
create temporary table pushed as select public.sync_push((
  select jsonb_agg(jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', ('cccccccc-0000-7000-8000-00000000000' || i)::uuid, 'term', 't' || i, 'term_norm', 't' || i,
    'term_type', 'word', 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'created_at', 1, 'updated_at', 1, 'deleted_at', case when i = 4 then 2 end,
    'hlc', '001761000000000:0000' || i || ':devc')))
  from generate_series(1, 4) i));

reset role;
alter table public.notes disable trigger stamp_sync_row;
update public.notes set server_updated_at = now() - interval '31 days' where deleted_at is not null
  and user_id = '33333333-3333-4333-8333-333333333333';
alter table public.notes enable trigger stamp_sync_row;
select is((public.purge_tombstones(30) ->> 'notes')::int >= 1, true, 'the tombstone is purged');

set local role authenticated;
create temporary table p1 as select public.sync_pull_v2(0, 1, 0) as r;
select is((select jsonb_array_length(r -> 'rows') from p1), 1, 'page 1 of a full pull');
select is((public.sync_pull((select (r ->> 'next_seq')::bigint from p1), 1) ->> 'full_resync')::boolean, true,
  'old sync_pull: page 2 of a full pull wrongly answers full_resync');
select is((public.sync_pull_v2((select (r ->> 'next_seq')::bigint from p1), 1, 0) ->> 'full_resync')::boolean, false,
  'sync_pull_v2: page 2 of a pull that started at 0 is a normal page');
select is((public.sync_pull_v2((select (r ->> 'next_seq')::bigint from p1), 500, 0) -> 'rows')::jsonb ->> 0 is not null, true,
  'and it returns the remaining rows');
select is((public.sync_pull_v2((select (r ->> 'next_seq')::bigint from p1), 500, (select (r ->> 'next_seq')::bigint from p1))
  ->> 'full_resync')::boolean, true, 'an incremental pull that started below the horizon still gets full_resync');
select is((select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows')), 3,
  'a full pull returns the three live notes');

select * from finish();
rollback;
