-- Dictation cards (20261101000900_dictation_cards.sql): cards take card_type 'dictation', every
-- earlier type still works, an unknown type is still rejected, and a user only ever reaches
-- their own dictation cards (the cards RLS is unchanged).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role)
values ('d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1', 'dict@test.local', 'authenticated', 'authenticated'),
       ('d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2', 'other@test.local', 'authenticated', 'authenticated');

select lives_ok(
  $$ insert into public.cards (id, user_id, note_id, sense_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values ('d1000000-0000-4000-8000-000000000001', 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1', gen_random_uuid(),
       gen_random_uuid(), 'dictation', 0, 0, 0, 0, false, false, 1, 1, '001762000000000:00001:devd') $$,
  'a dictation card is accepted');
select lives_ok(
  $$ insert into public.cards (id, user_id, note_id, sense_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values (gen_random_uuid(), 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1', gen_random_uuid(), gen_random_uuid(),
       'image', 0, 0, 0, 0, false, false, 1, 1, '001762000000000:00002:devd') $$,
  'picture cards still work');
select lives_ok(
  $$ insert into public.cards (id, user_id, note_id, sense_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values (gen_random_uuid(), 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2', gen_random_uuid(), gen_random_uuid(),
       'cloze', 0, 0, 0, 0, false, false, 1, 1, '001762000000000:00003:devd') $$,
  'cloze cards still work');
select throws_ok(
  $$ insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values (gen_random_uuid(), 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1', gen_random_uuid(),
       'listening', 0, 0, 0, 0, false, false, 1, 1, '001762000000000:00004:devd') $$,
  '23514', null, 'an unknown card type is still rejected');

set local request.jwt.claims to '{"sub":"d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2","role":"authenticated"}';
set local request.jwt.claim.sub to 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2';
set local role authenticated;

select is((select count(*)::int from public.cards where card_type = 'dictation'), 0,
  'another user does not see the dictation card');

reset role;
set local request.jwt.claims to '{"sub":"d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1","role":"authenticated"}';
set local request.jwt.claim.sub to 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1';
set local role authenticated;

select is((select count(*)::int from public.cards where card_type = 'dictation'), 1,
  'the owner sees their dictation card');

select * from finish();
rollback;
