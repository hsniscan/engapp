-- Leeches and confusables (20261023000800_leech_contrast.sql, decision 0026): shared contrast
-- content is written only by the service role, one row per pair of lexicon senses, shape- and
-- key-checked; a signed-in user reads it but cannot write it; the user's contrast card
-- (a note with term_type 'contrast'), its one-line difference (user_content kind 'contrast')
-- and a reported pair (user_content kind 'confusion') sync per user and never reach a shared
-- table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email, aud, role) values
  ('99999999-9999-4999-8999-999999999a91', 'l1@test.local', 'authenticated', 'authenticated'),
  ('99999999-9999-4999-8999-999999999a92', 'l2@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role writes
set local role service_role;

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"pgtapaffect","lemma_norm":"pgtapaffect","term_type":"word","pos":"verb","gloss_en":"to change something","gloss_key":"change something","meaning_tr":"etkilemek","ipa":null,"model":"test"},
  {"lemma":"pgtapeffect","lemma_norm":"pgtapeffect","term_type":"word","pos":"noun","gloss_en":"a change caused by something","gloss_key":"cause change something","meaning_tr":"etki","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as
select least(s1, s2) as lo, greatest(s1, s2) as hi
from (select (res -> 0 ->> 'sense_id')::uuid as s1, (res -> 1 ->> 'sense_id')::uuid as s2 from lex) x;
grant select on ids to authenticated;

create temporary table good as
select jsonb_build_object(
  'term_norm', 'pgtapaffect', 'sense_id', (select lo from ids), 'lang_pair', 'en-tr', 'kind', 'contrast',
  'content_key', (select lo::text || '|' || hi::text from ids),
  'content', jsonb_build_object(
    'a', jsonb_build_object('lemma', 'pgtapaffect', 'sentence_en', 'Sleep can pgtapaffect your mood.', 'span', jsonb_build_array(10, 21), 'sentence_tr', 'Uyku ruh halini etkiler.'),
    'b', jsonb_build_object('lemma', 'pgtapeffect', 'sentence_en', 'The pgtapeffect was big.', 'span', jsonb_build_array(4, 15), 'sentence_tr', null),
    'difference_tr', 'pgtapaffect fiildir, pgtapeffect isimdir.'),
  'model', 'm', 'prompt_version', 'contrast-v1') as item;
grant select on good to authenticated;

select is((select jsonb_array_length(public.lexicon_pair_notes_insert(jsonb_build_array(item))) from good), 1,
  'the service role stores a contrast note');
select is((select jsonb_array_length(public.lexicon_pair_notes_insert(jsonb_build_array(item))) from good), 0,
  'the same pair is skipped, not stored twice');
select ok((select bool_and(not curated and model = 'm' and prompt_version = 'contrast-v1' and server_seq > 0)
           from public.lexicon_pair_notes where kind = 'contrast' and term_norm = 'pgtapaffect'),
  'AI row: model and prompt version kept, stamped from lexicon_seq');

select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select item || jsonb_build_object('content_key', (select hi::text || '|' || lo::text from ids)) from good))) $$,
  '23514', null, 'the key must be the sorted pair');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select item || jsonb_build_object('sense_id', (select hi from ids),
          'content_key', (select lo::text || '|' || hi::text from ids)) from good))) $$,
  '23514', null, 'sense_id must be the first id of the key');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select jsonb_set(item, '{content,a,span}', '[10, 999]') from good))) $$,
  '23514', null, 'a span outside the sentence is refused');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select jsonb_set(item, '{content,a,span}', '"x"') from good))) $$,
  '23514', null, 'a span that is not two numbers is refused');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select item #- '{content,difference_tr}' from good))) $$,
  '23514', null, 'the difference line is required');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select item #- '{content,b}' from good))) $$,
  '23514', null, 'both sides are required');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(
       (select jsonb_set(item, '{content,difference_tr}', to_jsonb(repeat('a', 301))) from good))) $$,
  '23514', null, 'an over-long difference line is refused');

-- ---------------------------------------------------------------- a signed-in user reads only
reset role;
set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999a91","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999a91';
set local role authenticated;

select is(
  (select jsonb_array_length(public.lexicon_pair_notes_find(array[(select lo from ids)], 'contrast'))),
  1, 'a signed-in user can look up the contrast note of a sense');
select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, sense_id, lang_pair, kind, content_key, content, model, prompt_version)
     select 'pgtapaffect', lo, 'en-tr', 'contrast', lo::text || '|' || hi::text || 'x', '{}', 'm', 'contrast-v1' from ids $$,
  '42501', null, 'a client cannot insert a contrast note');
select throws_ok(
  $$ update public.lexicon_pair_notes set content = jsonb_set(content, '{difference_tr}', '"MY OWN difference"')
     where kind = 'contrast' $$,
  '42501', null, 'a client cannot edit a contrast note');

-- The user's contrast card, its edited difference line and a reported pair: private, synced rows.
create temporary table pushed as
select public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'aaaaaaaa-0000-7000-8000-0000000019a1', 'term', 'pgtapaffect ↔ pgtapeffect',
    'term_norm', 'pgtapaffect ↔ pgtapeffect', 'term_type', 'contrast',
    'lexicon_term_id', null, 'ipa', null, 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00001:devl')),
  jsonb_build_object('table', 'user_content', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'dddddddd-0000-8000-8000-0000000019b1', 'kind', 'contrast',
    'lexicon_sense_id', null, 'sense_id', null, 'context', null, 'replaces_id', null,
    'text', 'MY SECRET difference: pgtapaffect is a verb', 'translations', null, 'span', null, 'selected', true,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00002:devl')),
  jsonb_build_object('table', 'user_content', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'dddddddd-0000-8000-8000-0000000019b2', 'kind', 'confusion',
    'lexicon_sense_id', null, 'sense_id', 'aaaaaaaa-0000-7000-8000-0000000019c1', 'context', 'reported',
    'replaces_id', 'aaaaaaaa-0000-7000-8000-0000000019c2',
    'text', 'pgtapaffect ↔ pgtapeffect', 'translations', null, 'span', null, 'selected', true,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00003:devl'))
)) as res;
select is((select res -> 'acked' from pushed),
  '["aaaaaaaa-0000-7000-8000-0000000019a1", "dddddddd-0000-8000-8000-0000000019b1", "dddddddd-0000-8000-8000-0000000019b2"]'::jsonb,
  'a contrast note, its difference line and a reported pair are pushed');
select is((select term_type from public.notes where id = 'aaaaaaaa-0000-7000-8000-0000000019a1'), 'contrast',
  'the note is stored with term_type contrast');
select is((select string_agg(kind, ',' order by kind) from public.user_content), 'confusion,contrast',
  'the user''s text is stored in user_content');
select is((select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
            where r ->> 'table' in ('notes', 'user_content')), 3,
  'sync_pull_v3 brings them back to the user''s other devices');

-- ---------------------------------------------------------------- another user sees none of it
reset role;
set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999a92","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999a92';
set local role authenticated;
select is((select count(*)::int from public.user_content) + (select count(*)::int from public.notes), 0,
  'another user sees neither the contrast card nor the reported pair');
select is(
  (select jsonb_array_length(public.lexicon_pair_notes_find(array[(select lo from ids)], 'contrast'))),
  1, 'another user still gets the shared contrast content');

-- ---------------------------------------------------------------- user text never in shared tables
reset role;
select is((select count(*)::int from public.lexicon_pair_notes
            where content::text ilike '%SECRET%' or content::text ilike '%MY OWN%'), 0,
  'the user''s text never reaches lexicon_pair_notes');
select is((select count(*)::int from public.lexicon_senses where gloss_en ilike '%SECRET%' or meaning_tr ilike '%SECRET%'), 0,
  'nor lexicon_senses');
select is((select count(*)::int from public.lexicon_examples where text_en ilike '%SECRET%' or translations::text ilike '%SECRET%'), 0,
  'nor lexicon_examples');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$ select public.lexicon_pair_notes_find(array[]::uuid[], 'contrast') $$, '42501', null,
  'anon cannot look up contrast notes');

select * from finish();
rollback;
