-- Shared lexicon privacy and moderation (20261103000300_lexicon_privacy.sql, decision 0060):
-- no bulk reads for clients, lexicon_pull / lexicon_get still work, new terms outside the
-- reference lists are flagged, and picture requests are capped per user and day.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('62626262-6262-4262-8262-626262626201', 'l1@test.local', 'authenticated', 'authenticated'),
  ('62626262-6262-4262-8262-626262626202', 'l2@test.local', 'authenticated', 'authenticated');

set local role service_role;
create temporary table lex as select public.lexicon_upsert('[
  {"lemma":"house","lemma_norm":"house","term_type":"word","pos":"noun","gloss_en":"a building people live in pg62","gloss_key":"building live people pg62","meaning_tr":"ev","ipa":null,"model":"test"},
  {"lemma":"Zorbleflux","lemma_norm":"zorbleflux","term_type":"word","pos":"noun","gloss_en":"a private nickname","gloss_key":"nickname private","meaning_tr":"takma ad","ipa":null,"model":"test"},
  {"lemma":"zorble up","lemma_norm":"zorble up","term_type":"phrase","pos":"verb","gloss_en":"to gather things","gloss_key":"gather things","meaning_tr":"toplamak","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as select
  (res -> 0 ->> 'sense_id')::uuid as house, (res -> 1 ->> 'sense_id')::uuid as private_word from lex;
grant select on ids to public;

select is((select needs_review from public.lexicon_terms where lemma_norm = 'house'), false,
  'a word from the reference lists needs no review');
select is((select needs_review from public.lexicon_terms where lemma_norm = 'zorbleflux'), true,
  'an unknown single word is flagged for the owner');
select is((select needs_review from public.lexicon_terms where lemma_norm = 'zorble up'), false,
  'phrases are not flagged');
reset role;

-- User 1 has a card with the private word's sense.
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc)
  values ('0193a000-0000-7000-8000-000000006201', '62626262-6262-4262-8262-626262626201', 'Zorbleflux', 'zorbleflux', 'word', 1, 1, '001761000000000:00000:d');
insert into public.senses (id, user_id, note_id, sense_no, meaning_tr, lexicon_sense_id, created_at, updated_at, hlc)
  select '0193a000-0000-7000-8000-000000006202', '62626262-6262-4262-8262-626262626201',
         '0193a000-0000-7000-8000-000000006201', 1, 'takma ad', private_word, 1, 1, '001761000000000:00000:d' from ids;

-- ---------------------------------------------------------------- user 2: no listing
set local request.jwt.claims to '{"sub":"62626262-6262-4262-8262-626262626202","role":"authenticated"}';
set local request.jwt.claim.sub to '62626262-6262-4262-8262-626262626202';
set local role authenticated;
select throws_ok($$ select lemma from public.lexicon_terms $$, '42501', null, 'clients cannot list the terms');
select throws_ok($$ select gloss_en from public.lexicon_senses $$, '42501', null, 'nor the senses');
select throws_ok($$ select public.lexicon_find(array['zorbleflux'], 12) $$, '42501', null,
  'nor look words up (edge functions only)');
select is(jsonb_array_length(public.lexicon_pull(0, 500) -> 'rows'), 0,
  'lexicon_pull returns nothing for a user without cards');

-- ---------------------------------------------------------------- user 1: own senses
set local request.jwt.claims to '{"sub":"62626262-6262-4262-8262-626262626201","role":"authenticated"}';
set local request.jwt.claim.sub to '62626262-6262-4262-8262-626262626201';
select is((public.lexicon_pull(0, 500) -> 'rows' -> 0 ->> 'lemma'), 'Zorbleflux',
  'lexicon_pull still returns the senses of the user''s own cards');
select is(jsonb_array_length(public.lexicon_get(array[(select house from ids), (select private_word from ids)])), 2,
  'lexicon_get still returns senses by id');

-- ---------------------------------------------------------------- picture requests per day
reset role;
update public.sync_limits set value = 1 where name = 'image_requests_per_day';
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc)
  values ('0193a000-0000-7000-8000-000000006203', '62626262-6262-4262-8262-626262626201', 'house', 'house', 'word', 1, 1, '001761000000000:00000:d');
insert into public.senses (id, user_id, note_id, sense_no, meaning_tr, lexicon_sense_id, created_at, updated_at, hlc)
  select '0193a000-0000-7000-8000-000000006204', '62626262-6262-4262-8262-626262626201',
         '0193a000-0000-7000-8000-000000006203', 1, 'ev', house, 1, 1, '001761000000000:00000:d' from ids;
set local role authenticated;
select lives_ok($$ select public.image_request((select house from ids)) $$, 'the first picture request of the day');
select throws_ok($$ select public.image_request((select private_word from ids)) $$, '53400', null,
  'a request over the daily cap is refused');
select lives_ok($$ select public.image_request((select house from ids)) $$,
  'asking again for an already requested picture is not refused');

select * from finish();
rollback;
