-- "Kelimelerimle metin oluştur" (20261102000300_picked_texts.sql): its own daily counter next to
-- the day's story, one regeneration per text, service role only, refunds never below zero.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('53535353-5353-4053-8053-535353535351', 'p1@test.local', 'authenticated', 'authenticated');

set local role service_role;
select is(public.picked_story_consume('53535353-5353-4053-8053-535353535351', true, 5),
  '{"allowed": false, "used": 0, "limit": 5}'::jsonb, 'no regeneration before a text');
select is((public.picked_story_consume('53535353-5353-4053-8053-535353535351', false, 2) ->> 'used')::int, 1,
  'the first text of the day is allowed');
select is((public.picked_story_consume('53535353-5353-4053-8053-535353535351', false, 2) ->> 'used')::int, 2,
  'the second text is allowed');
select is(public.picked_story_consume('53535353-5353-4053-8053-535353535351', false, 2),
  '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'over the limit is refused');
select is((public.picked_story_consume('53535353-5353-4053-8053-535353535351', true, 2) ->> 'allowed')::boolean,
  true, 'a regeneration of a text made today is allowed');

-- The day's story is counted apart.
select is((public.story_consume('53535353-5353-4053-8053-535353535351', false, 1) ->> 'allowed')::boolean,
  true, 'picked texts do not use up the day''s story');
select is((select picked from public.story_usage where user_id = '53535353-5353-4053-8053-535353535351'), 2,
  'the story does not count as a picked text');

select public.picked_story_refund('53535353-5353-4053-8053-535353535351', false);
select is((select picked from public.story_usage where user_id = '53535353-5353-4053-8053-535353535351'), 1,
  'a failed text is given back');
select public.picked_story_refund('53535353-5353-4053-8053-535353535351', false);
select public.picked_story_refund('53535353-5353-4053-8053-535353535351', false);
select is((select picked from public.story_usage where user_id = '53535353-5353-4053-8053-535353535351'), 0,
  'a refund never goes below zero');
select throws_ok($$ select public.picked_story_consume(null, false, 5) $$, '22023', null, 'a user is required');

reset role;
set local role authenticated;
select throws_ok($$ select public.picked_story_consume('53535353-5353-4053-8053-535353535351', false, 5) $$,
  '42501', null, 'clients cannot take from the counter');
select throws_ok($$ select public.picked_story_refund('53535353-5353-4053-8053-535353535351', false) $$,
  '42501', null, 'clients cannot give back');

select * from finish();
rollback;
