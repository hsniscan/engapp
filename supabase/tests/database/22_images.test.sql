-- Picture pipeline (20261025000200_images.sql): who reads which pictures, that clients cannot
-- write any shared picture table, the review functions are admin-only, user requests, the
-- monthly budget guard and the daily limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (id, email, aud, role) values
  ('22222222-2222-4222-8222-222222222221', 'img1@test.local', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'img2@test.local', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222223', 'admin@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role: data
set local role service_role;

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"Pgimgapple","lemma_norm":"pgimgapple","term_type":"word","pos":"noun","gloss_en":"a round fruit","gloss_key":"fruit round","meaning_tr":"elma","ipa":null,"model":"test"},
  {"lemma":"Pgimgbridge","lemma_norm":"pgimgbridge","term_type":"word","pos":"noun","gloss_en":"a structure over a river","gloss_key":"river structure","meaning_tr":"köprü","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as
select (res -> 0 ->> 'sense_id')::uuid as apple, (res -> 1 ->> 'sense_id')::uuid as bridge from lex;
grant select on ids to public;

select is((public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>',
  'alt_tr', 'Bir elma', 'status', 'approved', 'model', 'm', 'prompt_version', 'image-v1',
  'cost_usd', 0.05)) ->> 'variant')::int, 0, 'first picture is variant 0');
select is((public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>',
  'alt_tr', 'Bir elma 2', 'status', 'review', 'checks', '{"vision":"pending"}'::jsonb, 'model', 'm',
  'prompt_version', 'image-v1', 'cost_usd', 0.05)) ->> 'variant')::int, 1, 'next picture is variant 1');
select is((public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '',
  'alt_tr', '', 'status', 'rejected', 'model', 'm', 'prompt_version', 'image-v1')) ->> 'variant')::int, 2,
  'a rejected attempt is kept with its cost');
select is((public.image_insert(jsonb_build_object('sense_id', (select bridge from ids), 'svg', '<svg/>',
  'alt_tr', 'Bir köprü', 'status', 'review', 'model', 'm', 'prompt_version', 'image-v1')) ->> 'variant')::int, 0,
  'variants count per sense');
select throws_ok($$ select public.image_insert(jsonb_build_object('sense_id', (select bridge from ids),
  'svg', '', 'alt_tr', '', 'status', 'approved', 'prompt_version', 'image-v1')) $$,
  '23514', null, 'an approved picture needs an SVG and a description');

-- Scoring a sense does not re-stamp it (devices do not pull it again); a real change does.
create temporary table seq0 as select server_seq, updated_at from public.lexicon_senses where id = (select apple from ids);
select is(public.image_visual_set(jsonb_build_array(jsonb_build_object('sense_id', (select apple from ids), 'score', 3, 'hint', 'a red apple'))), 1, 'visual score stored');
select is((select server_seq from public.lexicon_senses where id = (select apple from ids)), (select server_seq from seq0),
  'a visual-only update keeps server_seq');
select is((select visual_hint from public.lexicon_senses where id = (select apple from ids)), 'a red apple', 'hint stored');
update public.lexicon_senses set ipa = '/x/' where id = (select apple from ids);
select ok((select server_seq from public.lexicon_senses where id = (select apple from ids)) > (select server_seq from seq0),
  'any other update is stamped as before');
select is(public.image_visual_set(jsonb_build_array(jsonb_build_object('sense_id', (select bridge from ids), 'score', 2, 'hint', ''))), 1, 'second score');
select is((select visual_hint from public.lexicon_senses where id = (select bridge from ids)), null, 'an empty hint is stored as null');

-- User 1 has the apple in their cards; user 2 has nothing.
reset role;
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc) values
  ('22000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222221', 'Pgimgapple', 'pgimgapple', 'word', 1, 1, '001761000000000:00000:devt');
insert into public.senses (id, user_id, note_id, sense_no, lexicon_sense_id, meaning_tr, created_at, updated_at, hlc)
select '22000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222221', '22000000-0000-4000-8000-000000000001',
  1, apple, 'elma', 1, 1, '001761000000000:00000:devt' from ids;
insert into public.app_admins (user_id) values ('22222222-2222-4222-8222-222222222223');
create temporary table imgs as
select (select i.id from public.lexicon_images i where i.sense_id = ids.apple and i.variant = 1) as apple1,
       (select i.id from public.lexicon_images i where i.sense_id = ids.bridge and i.variant = 0) as bridge0
from ids;
grant select on imgs to public;

-- ---------------------------------------------------------------- user 1
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222221","role":"authenticated"}';
set local request.jwt.claim.sub to '22222222-2222-4222-8222-222222222221';
set local role authenticated;

select is((select count(*)::int from public.lexicon_images where sense_id = (select apple from ids)), 2,
  'user 1 sees the approved and the in-review picture of a sense in their cards');
select is((select count(*)::int from public.lexicon_images where sense_id = (select bridge from ids)), 0,
  'but not in-review pictures of other senses');
select is((select count(*)::int from public.lexicon_images where status = 'rejected'), 0, 'never rejected ones');
select throws_ok($$ select checks from public.lexicon_images $$, '42501', null, 'check details are server-only');
select throws_ok($$ select cost_usd from public.lexicon_images $$, '42501', null, 'cost is server-only');
select throws_ok($$ insert into public.lexicon_images (sense_id, variant, svg, status, prompt_version)
  values ((select apple from ids), 9, '<svg/>', 'approved', 'x') $$, '42501', null, 'clients cannot insert pictures');
select throws_ok($$ update public.lexicon_images set status = 'approved' $$, '42501', null, 'clients cannot approve pictures');
select throws_ok($$ delete from public.lexicon_images $$, '42501', null, 'clients cannot delete pictures');
select throws_ok($$ select * from public.image_requests $$, '42501', null, 'clients cannot read the queue');
select throws_ok($$ insert into public.image_requests (sense_id, source) values ((select bridge from ids), 'user') $$,
  '42501', null, 'clients cannot write the queue');
select throws_ok($$ select * from public.image_budget $$, '42501', null, 'clients cannot read the budget');
select throws_ok($$ select * from public.app_admins $$, '42501', null, 'clients cannot read app_admins');
select throws_ok($$ insert into public.app_admins values ('22222222-2222-4222-8222-222222222221') $$,
  '42501', null, 'clients cannot make themselves admin');
select throws_ok($$ select * from public.image_feedback $$, '42501', null, 'clients cannot read review feedback');
select throws_ok($$ select public.image_budget_reserve(1, 1000, 'instant') $$, '42501', null, 'clients cannot reserve budget');
select throws_ok($$ select public.image_consume('22222222-2222-4222-8222-222222222221', 1000) $$, '42501', null,
  'clients cannot use the daily counter');
select throws_ok($$ select public.image_insert('{}') $$, '42501', null, 'clients cannot call image_insert');
select is(public.is_app_admin(), false, 'user 1 is not an admin');
select throws_ok($$ select * from public.image_review_queue(10) $$, '42501', null, 'review queue is admin-only');
select throws_ok($$ select public.image_review_decide((select apple1 from imgs), 'approve', null) $$,
  '42501', null, 'review decisions are admin-only');

-- Requests: only for senses in the caller's cards; a repeat by the same user does not bump.
select is(public.image_request((select apple from ids)), '{"state": "queued", "priority": 3100}'::jsonb,
  'a user request queues the sense');
select is(public.image_request((select apple from ids)) ->> 'priority', '3100', 'the same user does not bump again');
select throws_ok($$ select public.image_request((select bridge from ids)) $$, '22023', null,
  'not for senses outside the caller''s cards');

-- ---------------------------------------------------------------- admin
reset role;
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222223","role":"authenticated"}';
set local request.jwt.claim.sub to '22222222-2222-4222-8222-222222222223';
set local role authenticated;

select is(public.is_app_admin(), true, 'the admin is an admin');
select is((select count(*)::int from public.image_review_queue(10)), 2, 'the queue lists the review pictures');
select is((select array_agg(lemma order by lemma) from public.image_review_queue(10)), array['Pgimgapple', 'Pgimgbridge'],
  'with the lemma of each');
select lives_ok($$ select public.image_review_decide(
  (select apple1 from imgs), 'approve', null) $$,
  'approve');
select lives_ok($$ select public.image_review_decide(
  (select bridge0 from imgs), 'redraw', 'unclear') $$,
  'redraw');
select throws_ok($$ select public.image_review_decide((select apple1 from imgs), 'publish', null) $$,
  '22023', null, 'unknown decisions are refused');

reset role;
select is((select status from public.lexicon_images where sense_id = (select apple from ids) and variant = 1), 'approved',
  'approved picture');
select is((select status from public.lexicon_images where sense_id = (select bridge from ids) and variant = 0), 'rejected',
  'a redrawn picture is rejected');
select is((select state || ':' || problem || ':' || priority from public.image_requests where sense_id = (select bridge from ids)),
  'queued:unclear:4000', 'and the sense is queued again with the reason');
select is((select count(*)::int from public.image_feedback), 2, 'decisions are recorded server-side');

-- ---------------------------------------------------------------- budget and daily limit
set local role service_role;
create temporary table h as select public.image_budget_reserve(30, 80, 'batch') as a, public.image_budget_reserve(40, 80, 'instant') as b;
select ok((select a is not null and b is not null from h), 'reservations under the cap pass');
select is(public.image_budget_reserve(10.000001, 80, 'instant'), null, 'a reservation over the cap is refused');
select is(public.image_budget_reserve(100, 80, 'instant'), null, 'one larger than the cap is refused');
select lives_ok($$ select public.image_budget_settle((select a from h), 2.5) $$, 'settle with the real cost');
select is((public.image_budget_status() ->> 'spent_usd')::numeric, 2.5, 'spent is the real cost');
select is((public.image_budget_status() ->> 'reserved_usd')::numeric, 40::numeric, 'the other hold is still reserved');
select is(public.image_budget_release_stale('-1 second'::interval), 1, 'stale non-batch holds are released');
select is((public.image_budget_status() ->> 'spent_usd')::numeric, 42.5, 'counted in full, on the safe side');
select is((public.image_consume('22222222-2222-4222-8222-222222222221', 1) ->> 'allowed')::boolean, true, 'first instant picture');
select is((public.image_consume('22222222-2222-4222-8222-222222222221', 1) ->> 'allowed')::boolean, false, 'the daily limit holds');

select * from finish();
rollback;
