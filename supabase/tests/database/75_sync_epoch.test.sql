-- Restore epoch (20261106000500_sync_epoch.sql, decision 0075): sync_pull_v5 tells devices the
-- database's epoch and the head of sync_seq; sync_after_restore() moves the sequences ahead and
-- bumps the epoch. The restore is simulated: rows written after the "backup" are removed and
-- sync_seq is set back, as a dump restore would.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, aud, role)
values ('75757575-7575-4575-8575-757575757501', 'e@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"75757575-7575-4575-8575-757575757501","role":"authenticated"}';
set local request.jwt.claim.sub to '75757575-7575-4575-8575-757575757501';
set local role authenticated;

create function pg_temp.note(p_id text, p_hlc text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', p_id, 'term', 'w' || right(p_id, 2), 'term_norm', 'w' || right(p_id, 2), 'term_type', 'word',
    'tags', '[]'::jsonb, 'possible_duplicate', false, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'hlc', p_hlc)))
$$;

select is(public.sync_push(pg_temp.note('75750000-0000-7000-8000-000000000001', '001761000000000:00001:deva')) -> 'acked',
  '["75750000-0000-7000-8000-000000000001"]'::jsonb, 'a note is pushed (before the backup)');

create temporary table v5 as select public.sync_pull_v5(0, 500, 0) as r;
select is(((select r from v5) ->> 'epoch')::bigint, 1::bigint, 'the epoch is 1 before any restore');
select ok(((select r from v5) ->> 'seq_head')::bigint >= ((select r from v5) ->> 'next_seq')::bigint,
  'seq_head is at or above every row the user can pull');
select is((select r from v5) - 'epoch' - 'seq_head', public.sync_pull_v4(0, 500, 0),
  'otherwise v5 answers exactly what v4 answers');

-- The nightly backup: sync_seq's value at that moment.
reset role;
create temporary table backup as select last_value as seq from public.sync_seq;
grant select on backup, v5 to authenticated;
set local role authenticated;

-- After the backup the device pushes another note and pulls it (its cursor passes it).
select is(public.sync_push(pg_temp.note('75750000-0000-7000-8000-000000000002', '001761000000000:00002:deva')) -> 'acked',
  '["75750000-0000-7000-8000-000000000002"]'::jsonb, 'a note is pushed after the backup');
create temporary table device as select (public.sync_pull_v5(0, 500, 0) ->> 'next_seq')::bigint as cursor;
grant select on device to authenticated;

-- The failure and the restore: the second note is gone, the sequence is back at its backup value.
reset role;
delete from public.notes where id = '75750000-0000-7000-8000-000000000002';
select setval('public.sync_seq', (select seq from backup), true);
set local role authenticated;

select ok((public.sync_pull_v5((select cursor from device), 500, 0) ->> 'seq_head')::bigint < (select cursor from device),
  'without the after-restore step the device sees seq_head below its cursor');
select is((public.sync_pull_v5((select cursor from device), 500, 0) ->> 'epoch')::bigint, 1::bigint,
  'and the epoch has not changed yet');

reset role;
create temporary table restored as select public.sync_after_restore() as r;
grant select on restored to authenticated;
select ok(((select r from restored) ->> 'epoch')::bigint > 1, 'sync_after_restore gives a new epoch');
select ok((select last_value from public.sync_seq) >= (select seq from backup) + 1000000000,
  'sync_seq moves a billion ahead');
select ok((select last_value from public.lexicon_seq) >= 1000000000, 'so does the lexicon sequence');
select ok((select last_value from public.word_bank_seq) >= 1000000000 and (select last_value from public.graded_texts_seq) >= 1000000000,
  'and the word bank and library sequences');
select ok(((public.sync_after_restore() ->> 'epoch')::bigint) > ((select r from restored) ->> 'epoch')::bigint,
  'a second run gives a newer epoch again');
set local role authenticated;

select ok((public.sync_pull_v5((select cursor from device), 500, 0) ->> 'epoch')::bigint > 1,
  'devices see the new epoch on their next pull');
select is(public.sync_push(pg_temp.note('75750000-0000-7000-8000-000000000003', '001761000000000:00003:deva')) -> 'acked',
  '["75750000-0000-7000-8000-000000000003"]'::jsonb, 'a note is pushed after the restore');
select is(jsonb_array_length(public.sync_pull_v5((select cursor from device), 500, (select cursor from device)) -> 'rows'), 1,
  'and a device whose cursor is past the backup still pulls it');

select throws_ok($$ select public.sync_after_restore() $$, '42501', null, 'clients cannot bump the epoch');

select * from finish();
rollback;
