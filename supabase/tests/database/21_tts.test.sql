-- Server pronunciation audio (20261024000100_tts.sql): which texts may be spoken, the daily
-- budget, and that clients cannot touch either.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, aud, role) values
  ('21212121-2121-4121-8121-212121212121', 't1@test.local', 'authenticated', 'authenticated'),
  ('21212121-2121-4121-8121-212121212122', 't2@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role
set local role service_role;

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"Pgtapspeak","lemma_norm":"pgtapspeak","term_type":"word","pos":"verb","gloss_en":"say words","gloss_key":"say words","meaning_tr":"konuşmak","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ex as
select public.lexicon_examples_insert(jsonb_build_array(
  jsonb_build_object('sense_id', (select (res -> 0 ->> 'sense_id')::uuid from lex), 'context', 'daily',
    'level_band', 'B1', 'text_en', 'We pgtapspeak every day.', 'span', jsonb_build_array(3, 13),
    'translations', jsonb_build_object('tr', 'Her gün konuşuruz.'), 'model', 'm', 'prompt_version', 'examples-v1')
)) as res;

reset role;
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc) values
  ('21000000-0000-4000-8000-000000000001', '21212121-2121-4121-8121-212121212121', 'Pgtapmine', 'pgtapmine', 'word', 1, 1, '001761000000000:00000:devt');
insert into public.senses (id, user_id, note_id, sense_no, meaning_tr, source_sentence, created_at, updated_at, hlc) values
  ('21000000-0000-4000-8000-000000000002', '21212121-2121-4121-8121-212121212121', '21000000-0000-4000-8000-000000000001',
   1, 'benim', 'I read   my pgtapmine
 notes.', 1, 1, '001761000000000:00000:devt');
set local role service_role;

select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', 'pgtapspeak'), 'public',
  'a lexicon headword is public');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', 'PgtapSpeak'), 'public',
  'in any letter case');
select is(public.tts_text_source(null, 'We pgtapspeak every day.'), 'public',
  'a shared example sentence is public');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', 'Pgtapmine'), 'private',
  'the user''s own word is private');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', 'I read my pgtapmine notes.'), 'private',
  'the user''s source sentence matches after whitespace folding');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212122', 'I read my pgtapmine notes.'), null,
  'another user cannot have it spoken');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', 'Read me anything at all'), null,
  'text on no card is refused');
select is(public.tts_text_source('21212121-2121-4121-8121-212121212121', repeat('a', 301)), null,
  'text over 300 characters is refused');

-- tts_consume enforces the daily limit atomically.
select is((public.tts_consume('21212121-2121-4121-8121-212121212121', 2) ->> 'allowed')::boolean, true, 'miss 1 allowed');
select is((public.tts_consume('21212121-2121-4121-8121-212121212121', 2) ->> 'allowed')::boolean, true, 'miss 2 allowed');
select is(public.tts_consume('21212121-2121-4121-8121-212121212121', 2),
  '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'miss 3 refused at the limit');
select is((public.tts_consume('21212121-2121-4121-8121-212121212122', 2) ->> 'used')::int, 1,
  'budgets are per user');

-- ---------------------------------------------------------------- clients
reset role;
set local request.jwt.claims to '{"sub":"21212121-2121-4121-8121-212121212121","role":"authenticated"}';
set local request.jwt.claim.sub to '21212121-2121-4121-8121-212121212121';
set local role authenticated;

select throws_ok($$ select public.tts_consume('21212121-2121-4121-8121-212121212121', 1000) $$,
  '42501', null, 'clients cannot use the TTS budget function');
select throws_ok($$ select public.tts_text_source('21212121-2121-4121-8121-212121212121', 'x') $$,
  '42501', null, 'clients cannot probe tts_text_source');
select throws_ok($$ select * from public.tts_usage $$,
  '42501', null, 'clients cannot read tts_usage');

reset role;
-- The bucket exists wherever the Storage schema does (it is absent on the CI test stack).
create function pg_temp.tts_bucket_ok() returns boolean language plpgsql as $f$
declare
  r boolean;
begin
  if pg_catalog.to_regclass('storage.buckets') is null or not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'
  ) then
    return true;
  end if;
  execute $q$ select exists (select 1 from storage.buckets where id = 'tts' and public) $q$ into r;
  return r;
end;
$f$;
select ok(pg_temp.tts_bucket_ok(), 'the tts bucket is public where Storage is installed');

select * from finish();
rollback;
