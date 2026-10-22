-- Mnemonics and extract-v5 false friends (20261023000200_mnemonics.sql, decision 0020):
-- AI pair notes are written only by the service role through lexicon_pair_notes_insert,
-- deduplicated and shape-checked; a signed-in user reads them but cannot write them; the
-- user's own mnemonic (user_content kind 'mnemonic') and rejection (content_feedback
-- target_kind 'mnemonic') sync per user and never reach a shared table (plan v0.3
-- acceptance criterion 9).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email, aud, role) values
  ('99999999-9999-4999-8999-999999999991', 'm1@test.local', 'authenticated', 'authenticated'),
  ('99999999-9999-4999-8999-999999999992', 'm2@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role writes
set local role service_role;

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"pgtapreluctant","lemma_norm":"pgtapreluctant","term_type":"word","pos":"adjective","gloss_en":"not willing to do something","gloss_key":"not something willing","meaning_tr":"isteksiz","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as select (res -> 0 ->> 'sense_id')::uuid as s1 from lex;
grant select on ids to authenticated;

create temporary table ins as
select public.lexicon_pair_notes_insert(jsonb_build_array(
  jsonb_build_object('term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'lang_pair', 'en-tr',
    'kind', 'mnemonic_suggestion', 'content_key', 'rolantide kalan motor',
    'content', jsonb_build_object('type', 'sound', 'text_tr', 'Rölantide kalan motor gibi isteksiz: pgtapreluctant biri.', 'why', 'Aynı seslerle başlar.'),
    'model', 'm', 'prompt_version', 'mnemonic-v1'),
  jsonb_build_object('term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'lang_pair', 'en-tr',
    'kind', 'false_friend', 'content_key', 'pgtaprelüktan',
    'content', jsonb_build_object('tr_word', 'pgtaprelüktan', 'en_meaning_tr', 'isteksiz', 'tr_meaning_tr', 'başka', 'tr_meaning_en', null, 'strength', 'full', 'note_tr', null),
    'model', 'm', 'prompt_version', 'extract-v5')
)) as res;

grant select on ins to authenticated;

select is((select jsonb_array_length(res) from ins), 2, 'the service role stores a suggestion and a false friend');
select is((select res -> 0 ->> 'kind' from ins), 'mnemonic_suggestion', 'rows come back in input order');
select ok((select (res -> 0 ->> 'updated_at')::bigint > 0 and res -> 0 -> 'model' is null from ins),
  'returned rows carry epoch-ms updated_at and no model name');
select ok((select bool_and(not curated and model = 'm' and server_seq > 0) from public.lexicon_pair_notes
           where term_norm = 'pgtapreluctant'), 'AI rows: not curated, model kept, stamped from lexicon_seq');
select is(
  (select jsonb_array_length(public.lexicon_pair_notes_insert(jsonb_build_array(
    jsonb_build_object('term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'lang_pair', 'en-tr',
      'kind', 'mnemonic_suggestion', 'content_key', 'rolantide kalan motor',
      'content', jsonb_build_object('type', 'story', 'text_tr', 'Başka bir pgtapreluctant hikâyesi.'),
      'model', 'm', 'prompt_version', 'mnemonic-v1'))))),
  0, 'the same (pair, kind, term, sense, key) is skipped, not stored twice');
select is(
  (select jsonb_array_length(public.lexicon_pair_notes_insert(jsonb_build_array(
    jsonb_build_object('term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'lang_pair', 'en-tr',
      'kind', 'mnemonic_suggestion', 'content_key', '-none-', 'content', jsonb_build_object('type', 'none'),
      'model', 'm', 'prompt_version', 'mnemonic-v1'))))),
  1, 'the "no good association" marker is accepted');

select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(jsonb_build_object(
       'term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'kind', 'mnemonic_suggestion',
       'content_key', 'x', 'content', jsonb_build_object('type', 'joke', 'text_tr', 'x'),
       'model', 'm', 'prompt_version', 'mnemonic-v1'))) $$,
  '23514', null, 'an unknown mnemonic type is refused');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(jsonb_build_object(
       'term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'kind', 'mnemonic_suggestion',
       'content_key', 'y', 'content', jsonb_build_object('type', 'story', 'text_tr', repeat('a', 301)),
       'model', 'm', 'prompt_version', 'mnemonic-v1'))) $$,
  '23514', null, 'an over-long suggestion is refused');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(jsonb_build_object(
       'term_norm', 'pgtapreluctant', 'sense_id', null, 'kind', 'mnemonic_suggestion',
       'content_key', 'z', 'content', jsonb_build_object('type', 'story', 'text_tr', 'pgtapreluctant'),
       'model', 'm', 'prompt_version', 'mnemonic-v1'))) $$,
  '23514', null, 'a suggestion belongs to a sense');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert(jsonb_build_array(jsonb_build_object(
       'term_norm', 'pgtapreluctant', 'sense_id', (select s1 from ids), 'kind', 'mnemonic_suggestion',
       'content_key', 'w', 'content', jsonb_build_object('type', 'story', 'text_tr', 'pgtapreluctant hikâye'),
       'prompt_version', 'mnemonic-v1'))) $$,
  '23514', null, 'an AI note must name its model');

select is(
  (select jsonb_array_length(public.lexicon_pair_notes_find(array[(select s1 from ids)], 'mnemonic_suggestion'))),
  2, 'find returns the active suggestions of the sense (marker included; the function hides it)');

-- ---------------------------------------------------------------- a signed-in user reads only
reset role;
set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999991","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999991';
set local role authenticated;

select is(
  (select jsonb_array_length(public.lexicon_pair_notes_find(array[(select s1 from ids)], 'false_friend'))),
  1, 'a signed-in user can look up false friends of a sense');
select ok(not has_function_privilege('authenticated', 'public.lexicon_pair_notes_insert(jsonb)', 'execute'),
  'a signed-in user cannot execute lexicon_pair_notes_insert');
select throws_ok(
  $$ select public.lexicon_pair_notes_insert('[]'::jsonb) $$,
  '42501', null, 'calling it is refused');
select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, sense_id, lang_pair, kind, content_key, content, model, prompt_version)
     values ('pgtapreluctant', (select s1 from ids), 'en-tr', 'mnemonic_suggestion', 'mine',
             '{"type":"story","text_tr":"MY OWN pgtapreluctant"}', 'm', 'mnemonic-v1') $$,
  '42501', null, 'a client cannot insert a suggestion');
select throws_ok(
  $$ update public.lexicon_pair_notes set content = '{"type":"story","text_tr":"MY OWN pgtapreluctant"}'
     where term_norm = 'pgtapreluctant' $$,
  '42501', null, 'a client cannot edit a suggestion');

-- The user's own mnemonic and a rejection: private, synced rows.
select is(public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'user_content', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'dddddddd-0000-8000-8000-000000000001', 'kind', 'mnemonic',
    'lexicon_sense_id', (select s1 from ids), 'sense_id', null, 'context', null,
    'replaces_id', (select (res -> 0 ->> 'id')::uuid from ins),
    'text', 'MY SECRET pgtapreluctant anımsatıcım', 'translations', null, 'span', null, 'selected', true,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00001:devm')),
  jsonb_build_object('table', 'content_feedback', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'dddddddd-0000-8000-8000-000000000002', 'target_kind', 'mnemonic',
    'target_id', (select (res -> 0 ->> 'id')::uuid from ins), 'verdict', 'reject',
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00002:devm'))
)) -> 'acked',
  '["dddddddd-0000-8000-8000-000000000001", "dddddddd-0000-8000-8000-000000000002"]'::jsonb,
  'the user''s mnemonic and rejection are pushed to their own rows');
select is((select kind from public.user_content where id = 'dddddddd-0000-8000-8000-000000000001'), 'mnemonic',
  'stored as user_content kind mnemonic');
select is((select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
            where r ->> 'table' in ('content_feedback', 'user_content')), 2,
  'sync_pull_v3 brings both back to the user''s other devices');

-- ---------------------------------------------------------------- another user sees none of it
reset role;
set local request.jwt.claims to '{"sub":"99999999-9999-4999-8999-999999999992","role":"authenticated"}';
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999992';
set local role authenticated;
select is((select count(*)::int from public.user_content) + (select count(*)::int from public.content_feedback), 0,
  'another user sees neither the mnemonic nor the rejection');
select is(
  (select jsonb_array_length(public.lexicon_pair_notes_find(array[(select s1 from ids)], 'mnemonic_suggestion'))),
  2, 'another user still gets the shared suggestions (a rejection hides them for its author only)');

-- ---------------------------------------------------------------- user text never in shared tables
reset role;
select is((select count(*)::int from public.lexicon_pair_notes where content::text ilike '%SECRET%' or content::text ilike '%MY OWN%'), 0,
  'the user''s mnemonic never reaches lexicon_pair_notes');
select is((select count(*)::int from public.lexicon_senses where gloss_en ilike '%SECRET%' or meaning_tr ilike '%SECRET%'), 0,
  'nor lexicon_senses');
select is((select count(*)::int from public.lexicon_examples where text_en ilike '%SECRET%' or translations::text ilike '%SECRET%'), 0,
  'nor lexicon_examples');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$ select public.lexicon_pair_notes_find(array[]::uuid[], 'mnemonic_suggestion') $$, '42501', null,
  'anon cannot look up pair notes');

select * from finish();
rollback;
