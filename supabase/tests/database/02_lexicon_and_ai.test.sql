-- The shared lexicon is read-only for clients; dedup is race-safe; AI bookkeeping is
-- service-role only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, aud, role)
values ('33333333-3333-4333-8333-333333333333', 'c@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role writes
set local role service_role;

create temporary table up1 as
select public.lexicon_upsert('[
  {"lemma":"pgtapbank","lemma_norm":"pgtapbank","term_type":"word","pos":"noun","gloss_en":"the land beside a river","gloss_key":"beside land river","meaning_tr":"kıyı","ipa":"/bæŋk/","model":"test"},
  {"lemma":"pgtapbank","lemma_norm":"pgtapbank","term_type":"word","pos":"noun","gloss_en":"an organisation that keeps money","gloss_key":"keep money organisation","meaning_tr":"banka","ipa":"/bæŋk/","model":"test"}
]'::jsonb) as res;

select is((select (res -> 0 ->> 'term_created')::boolean from up1), true, 'first item creates the term');
select is((select (res -> 1 ->> 'term_created')::boolean from up1), false, 'second item reuses the term');
select is((select res -> 0 ->> 'term_id' from up1), (select res -> 1 ->> 'term_id' from up1), 'same term id');

create temporary table up2 as
select public.lexicon_upsert('[
  {"lemma":"Pgtapbank","lemma_norm":"pgtapbank","term_type":"word","pos":"noun","gloss_en":"Land beside rivers.","gloss_key":"beside land river","meaning_tr":"nehir kıyısı","ipa":null,"model":"test"}
]'::jsonb) as res;
select is((select res -> 0 ->> 'sense_id' from up2), (select res -> 0 ->> 'sense_id' from up1),
  'same (term, pos, gloss_key) returns the existing sense id');
select is((select (res -> 0 ->> 'sense_created')::boolean from up2), false, 'and creates nothing');
select is((select count(*)::int from public.lexicon_senses s join public.lexicon_terms t on t.id = s.term_id
  where t.lemma_norm = 'pgtapbank'), 2, 'exactly two senses stored');
select is((select s.meaning_tr from public.lexicon_senses s join public.lexicon_terms t on t.id = s.term_id
  where t.lemma_norm = 'pgtapbank' and s.gloss_key = 'beside land river'), 'kıyı',
  'the first writer''s content is kept');

select throws_ok(
  $$ select public.lexicon_upsert('[{"lemma":"x","lemma_norm":"X","term_type":"word"}]'::jsonb) $$,
  '23514', null, 'lemma_norm must be normalised');

-- ai_consume enforces the daily limit atomically.
select is((public.ai_consume('33333333-3333-4333-8333-333333333333', 2) ->> 'allowed')::boolean, true, 'call 1 allowed');
select is((public.ai_consume('33333333-3333-4333-8333-333333333333', 2) ->> 'allowed')::boolean, true, 'call 2 allowed');
select is(public.ai_consume('33333333-3333-4333-8333-333333333333', 2),
  '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'call 3 refused at the limit');

-- ---------------------------------------------------------------- clients
reset role;
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
set local request.jwt.claim.sub to '33333333-3333-4333-8333-333333333333'; -- older auth.uid() reads this one
set local role authenticated;

select is((select count(*)::int from public.lexicon_entries where lemma_norm = 'pgtapbank'), 2, 'signed-in users can read the lexicon');
select throws_ok($$ insert into public.lexicon_terms (lemma, lemma_norm, term_type) values ('evil', 'evil', 'word') $$,
  '42501', null, 'clients cannot insert lexicon terms');
select throws_ok($$ update public.lexicon_senses set meaning_tr = 'yanlış' $$,
  '42501', null, 'clients cannot update lexicon senses');
select throws_ok($$ select public.lexicon_upsert('[]'::jsonb) $$,
  '42501', null, 'clients cannot call lexicon_upsert');
select throws_ok($$ select public.ai_consume('33333333-3333-4333-8333-333333333333', 1000) $$,
  '42501', null, 'clients cannot reset their AI budget');
select throws_ok($$ select * from public.ai_chunk_cache $$,
  '42501', null, 'clients cannot read the chunk cache');

select * from finish();
rollback;
