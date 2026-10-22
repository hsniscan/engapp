-- Example sentences (20261022000100_examples.sql): lexicon_examples is shared, read-only for
-- clients and free of user text; content_feedback and user_content are synced per user
-- through the registry, keyed (user_id, id), and never reach v0.1 pulls.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-4777-8777-777777777777', 'g@test.local', 'authenticated', 'authenticated'),
  ('88888888-8888-4888-8888-888888888888', 'h@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- service role writes
set local role service_role;

create temporary table lex as
select (public.lexicon_upsert('[
  {"lemma":"pgtapgiveup","lemma_norm":"pgtapgiveup","term_type":"word","pos":"verb","gloss_en":"stop doing a habit","gloss_key":"habit stop","meaning_tr":"bırakmak","ipa":null,"model":"test"},
  {"lemma":"pgtapother","lemma_norm":"pgtapother","term_type":"word","pos":"noun","gloss_en":"something else","gloss_key":"else","meaning_tr":"başka","ipa":null,"model":"test"}
]'::jsonb)) as res;
create temporary table ids as
select (res -> 0 ->> 'sense_id')::uuid as s1, (res -> 1 ->> 'sense_id')::uuid as s2 from lex;
grant select on ids to authenticated;

create temporary table ins1 as
select public.lexicon_examples_insert(jsonb_build_array(
  jsonb_build_object('sense_id', (select s1 from ids), 'context', 'daily', 'level_band', 'B1',
    'text_en', 'She pgtapgiveup sugar last year.', 'span', jsonb_build_array(4, 15),
    'translations', jsonb_build_object('tr', 'Geçen yıl şekeri bıraktı.'), 'model', 'm', 'prompt_version', 'examples-v1'),
  jsonb_build_object('sense_id', (select s1 from ids), 'context', 'work', 'level_band', 'B1',
    'text_en', 'Our team never pgtapgiveup.', 'span', jsonb_build_array(16, 27),
    'translations', jsonb_build_object('tr', 'Ekibimiz asla pes etmez.'), 'model', 'm', 'prompt_version', 'examples-v1'),
  jsonb_build_object('sense_id', (select s2 from ids), 'context', 'daily', 'level_band', 'C1',
    'text_en', 'A pgtapother example.', 'span', jsonb_build_array(2, 12),
    'translations', jsonb_build_object('tr', 'Başka bir örnek.'), 'model', 'm', 'prompt_version', 'examples-v1')
)) as res;

select is((select jsonb_array_length(res) from ins1), 3, 'the service role inserts examples');
select is((select res -> 0 -> 'span' from ins1), '[4, 15]'::jsonb, 'with the span as given');
select ok((select bool_and(server_seq > 0) from public.lexicon_examples), 'rows are stamped with lexicon_seq');

select is(
  (select jsonb_array_length(public.lexicon_examples_insert(jsonb_build_array(
    jsonb_build_object('sense_id', (select s1 from ids), 'context', 'formal', 'level_band', 'B2',
      'text_en', '  she PGTAPGIVEUP sugar, last year! ', 'span', jsonb_build_array(6, 17),
      'translations', '{}'::jsonb, 'model', 'm', 'prompt_version', 'examples-v1'))))),
  0, 'the same sentence (case and punctuation aside) is not stored twice for a sense');
select is((select count(*)::int from public.lexicon_examples where sense_id = (select s1 from ids)), 2, 'still two rows');

select throws_ok(
  $$ select public.lexicon_examples_insert(jsonb_build_array(jsonb_build_object(
       'sense_id', (select s1 from ids), 'context', 'daily', 'level_band', 'B1', 'text_en', 'Too short span.',
       'span', jsonb_build_array(10, 99), 'translations', '{}'::jsonb, 'prompt_version', 'examples-v1'))) $$,
  '23514', null, 'a span outside the sentence is refused');
select throws_ok(
  $$ select public.lexicon_examples_insert(jsonb_build_array(jsonb_build_object(
       'sense_id', (select s1 from ids), 'context', 'Daily Life', 'level_band', 'B1', 'text_en', 'Bad context.',
       'span', jsonb_build_array(0, 3), 'translations', '{}'::jsonb, 'prompt_version', 'examples-v1'))) $$,
  '23514', null, 'a malformed context key is refused');
select throws_ok(
  $$ select public.lexicon_examples_insert(jsonb_build_array(jsonb_build_object(
       'sense_id', gen_random_uuid(), 'context', 'daily', 'level_band', 'B1', 'text_en', 'No sense.',
       'span', jsonb_build_array(0, 2), 'translations', '{}'::jsonb, 'prompt_version', 'examples-v1'))) $$,
  '23503', null, 'an example needs an existing lexicon sense');

select is(jsonb_array_length(public.lexicon_examples_find(array[(select s1 from ids), (select s2 from ids)], 'B1')), 2,
  'lexicon_examples_find filters by band');
select is(jsonb_array_length(public.lexicon_examples_find(array[(select s1 from ids), (select s2 from ids)], null)), 3,
  'and returns every band without one');
update public.lexicon_examples set status = 'retired' where text_en = 'A pgtapother example.';
select is(jsonb_array_length(public.lexicon_examples_find(array[(select s2 from ids)], null)), 0,
  'retired examples are not offered again');

-- ---------------------------------------------------------------- clients: shared table
reset role;
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

select is((select count(*)::int from public.lexicon_examples), 3, 'signed-in users read lexicon_examples');
select throws_ok(
  $$ insert into public.lexicon_examples (sense_id, context, level_band, text_en, span, prompt_version)
     values ((select s1 from ids), 'daily', 'B1', 'my own sentence', '{0,2}', 'x') $$,
  '42501', null, 'clients cannot insert shared examples');
select throws_ok($$ update public.lexicon_examples set text_en = 'changed' $$, '42501', null,
  'clients cannot update shared examples');
select throws_ok($$ delete from public.lexicon_examples $$, '42501', null, 'clients cannot delete shared examples');
select throws_ok($$ select public.lexicon_examples_insert('[]'::jsonb) $$, '42501', null,
  'clients cannot call lexicon_examples_insert');

-- lexicon_examples_pull: only senses the caller uses.
select is(jsonb_array_length(public.lexicon_examples_pull(0, 500) -> 'rows'), 0, 'no senses yet: nothing to pull');
select is(jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'senses', 'op', 'upsert',
  'payload', jsonb_build_object('id', 'aaaaaaaa-0000-7000-8000-000000000001', 'note_id', 'aaaaaaaa-0000-7000-8000-0000000000a1',
    'sense_no', 1, 'lexicon_sense_id', (select s1 from ids), 'pos', 'verb', 'gloss_en', null, 'meaning_tr', 'bırakmak',
    'meaning_tr_override', null, 'source_sentence', null, 'source_sentence_tr', null, 'span', null, 'source_id', null,
    'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', '001761000000000:00001:devg')))) -> 'acked'), 1,
  'a sense that uses the lexicon sense is pushed');
create temporary table ep as select public.lexicon_examples_pull(0, 1) as r;
select is((select jsonb_array_length(r -> 'rows') from ep), 1, 'examples pull pages');
select ok((select (r ->> 'has_more')::boolean from ep), 'with has_more');
select is(jsonb_array_length(public.lexicon_examples_pull((select (r ->> 'next_seq')::bigint from ep), 500) -> 'rows'), 1,
  'the next page has the other example of the used sense, none of the unused one');
select is((select r -> 'rows' -> 0 -> 'translations' ->> 'tr' from ep), 'Geçen yıl şekeri bıraktı.', 'rows carry translations');

-- ---------------------------------------------------------------- clients: feedback and own content

create function pg_temp.fb(p_id uuid, p_verdict text, p_hlc text, p_deleted bigint default null)
returns jsonb language sql as $$
  select jsonb_build_object('table', 'content_feedback', 'op', case when p_deleted is null then 'upsert' else 'delete' end,
    'payload', jsonb_build_object(
      'id', p_id, 'user_id', '88888888-8888-4888-8888-888888888888', 'target_kind', 'example',
      'target_id', (select id from public.lexicon_examples where text_en like 'She pgtapgiveup%'),
      'verdict', p_verdict, 'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', p_deleted, 'hlc', p_hlc))
$$;

select is(public.sync_push(jsonb_build_array(pg_temp.fb('bbbbbbbb-0000-8000-8000-000000000001', 'like', '001761000000000:00002:devg'))) -> 'acked',
  '["bbbbbbbb-0000-8000-8000-000000000001"]'::jsonb, 'feedback is pushed');
select is((select user_id from public.content_feedback), '77777777-7777-4777-8777-777777777777'::uuid,
  'user_id comes from the session');
select is((public.sync_push(jsonb_build_array(pg_temp.fb('bbbbbbbb-0000-8000-8000-000000000001', 'reject', '001761000000000:00003:devg'))) -> 'stale'),
  '[]'::jsonb, 'a newer verdict replaces the old one');
select is((public.sync_push(jsonb_build_array(pg_temp.fb('bbbbbbbb-0000-8000-8000-000000000001', 'skip', '001761000000000:00001:devx'))) -> 'stale'),
  '["bbbbbbbb-0000-8000-8000-000000000001"]'::jsonb, 'an older verdict loses (last writer wins)');
select is((select verdict from public.content_feedback), 'reject', 'the newest verdict is stored');
select is(jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'content_feedback', 'op', 'upsert',
  'payload', (pg_temp.fb('bbbbbbbb-0000-8000-8000-000000000002', 'love', '001761000000000:00004:devg') -> 'payload')))) -> 'rejected'), 1,
  'an unknown verdict is rejected');

select is(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'user_content', 'op', 'upsert', 'payload', jsonb_build_object(
  'id', 'cccccccc-0000-8000-8000-000000000001', 'kind', 'example_sentence',
  'lexicon_sense_id', (select s1 from ids), 'sense_id', null, 'context', 'daily',
  'replaces_id', (select id from public.lexicon_examples where text_en like 'She pgtapgiveup%'),
  'text', 'MY PRIVATE pgtapgiveup sentence.', 'translations', jsonb_build_object('tr', 'Benim cümlem.'),
  'span', jsonb_build_array(11, 22), 'selected', null,
  'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00005:devg'))))
  -> 'acked', '["cccccccc-0000-8000-8000-000000000001"]'::jsonb, 'an edited sentence is pushed to user_content');

select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' in ('content_feedback', 'user_content')), 2, 'sync_pull_v3 returns feedback and own content');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r
    where r ->> 'table' in ('content_feedback', 'user_content'))
  + (select count(*)::int from jsonb_array_elements(public.sync_pull(0, 500) -> 'rows') r
    where r ->> 'table' in ('content_feedback', 'user_content')),
  0, 'v0.1 pulls never return them');

-- Tombstone without the full row (as the client's delete sends it).
select is(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'user_content', 'op', 'delete', 'payload',
  jsonb_build_object('id', 'cccccccc-0000-8000-8000-000000000001', 'hlc', '001761000000000:00006:devg', 'deleted_at', 1761000000500))))
  -> 'stale', '[]'::jsonb, 'own content can be deleted (tombstone)');
select ok((select deleted_at is not null from public.user_content), 'the row is a tombstone');

-- ---------------------------------------------------------------- settings
select is(jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert', 'payload',
  jsonb_build_object('id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'UTC', 'day_start_hour', 4,
    'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null, 'last_backup_at', null,
    'example_tr_visible', true, 'example_contexts', jsonb_build_array('daily', 'technology'),
    'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', '001761000000000:00007:devg')))) -> 'acked'), 1,
  'settings carry the example preferences');
select is(jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert', 'payload',
  jsonb_build_object('id', 'settings', 'daily_new_limit', 12, 'request_retention', 0.9, 'timezone', 'UTC', 'day_start_hour', 4,
    'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null, 'last_backup_at', null,
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'hlc', '001761000000000:00008:devg')))) -> 'acked'), 1,
  'an older client''s settings row without them is still accepted');

-- ---------------------------------------------------------------- the other user
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';

select is((select count(*)::int from public.content_feedback) + (select count(*)::int from public.user_content), 0,
  'another user sees none of it');
select is(public.sync_push(jsonb_build_array(pg_temp.fb('bbbbbbbb-0000-8000-8000-000000000001', 'like', '001761000000000:00001:devh'))) -> 'acked',
  '["bbbbbbbb-0000-8000-8000-000000000001"]'::jsonb, 'the same feedback id is that user''s own row');
select is((select verdict from public.content_feedback), 'like', 'and does not touch the first user''s verdict');
select is(jsonb_array_length(public.lexicon_examples_pull(0, 500) -> 'rows'), 0,
  'examples are pulled only for senses the user has');

reset role;
select is((select count(*)::int from public.lexicon_examples where text_en ilike '%PRIVATE%'), 0,
  'user text never reaches the shared table');

select * from finish();
rollback;
