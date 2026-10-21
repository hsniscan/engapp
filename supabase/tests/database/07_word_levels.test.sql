-- Word levels (20261021001100_word_levels.sql, 20261021001200_ref_word_data.sql): reference
-- tables are readable by signed-in users and written only by the service role; the
-- Turkish-learner correction is at most one step; lexicon level columns reach clients
-- through lexicon_entries; level writes move the lexicon cursor; notes.level_override syncs
-- and survives a push from an app version without the column; the system AI budget.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ---------------------------------------------------------------- reference data

select has_table('public', 'ref_word_levels', 'ref_word_levels exists');
select has_table('public', 'ref_word_freq', 'ref_word_freq exists');
select ok((select count(*) from public.ref_word_levels where source = 'cefrj') > 7000,
  'the CEFR-J list is loaded');
select ok((select count(*) from public.ref_word_levels where source = 'octanove') > 2000,
  'the Octanove C1/C2 list is loaded');
select ok((select count(*) from public.ref_word_freq) > 25000, 'the frequency table is loaded');
select is((select cefr from public.ref_word_levels where lemma_norm = 'television' and source = 'cefrj'),
  'A1', 'television is A1 in CEFR-J');
select is((select count(*)::int from public.ref_sources), 3, 'three sources are recorded');
select ok((select bool_and(sha256 ~ '^[0-9a-f]{64}$' and license <> '') from public.ref_sources),
  'every source has a checksum and a licence');

select throws_ok(
  $$ update public.ref_word_levels set tr_checked_at = now(), tr_base_cefr = 'B1', tr_cefr = 'C1', tr_reason = 'x'
      where lemma_norm = 'abandon' and pos = 'verb' and source = 'cefrj' $$,
  '23514', null, 'a correction of two steps is refused by the table');

-- ---------------------------------------------------------------- service role: level job helpers

set local role service_role;

select is(public.ref_set_level_tr('[
  {"lemma_norm":"television","pos":"noun","source":"cefrj","base_cefr":"A1","cefr":null,"reason":null,"model":"m","prompt_version":"level-tr-v1"},
  {"lemma_norm":"abandon","pos":"verb","source":"cefrj","base_cefr":"B1","cefr":"B2","reason":"Türkçede karşılığı soyut","model":"m","prompt_version":"level-tr-v1"},
  {"lemma_norm":"abandoned","pos":"adjective","source":"cefrj","base_cefr":"A1","cefr":"A2","reason":"stale","model":"m","prompt_version":"level-tr-v1"}
]'::jsonb), 2, 'corrections are stored only for the list level they were made for');

select is((select tr_cefr from public.ref_word_levels where lemma_norm = 'abandon' and pos = 'verb'), 'B2',
  'abandon moved one step');
select ok(not exists (
  select 1 from jsonb_array_elements(public.ref_level_tr_pending(1000)) p
   where p ->> 'lemma_norm' in ('television', 'abandon')),
  'checked entries are no longer pending');

select is(
  (select r -> 'refs' -> 0 ->> 'tr_cefr' from jsonb_array_elements(public.level_refs(array['abandon', 'nosuchwordxyz']) -> 'rows') r
    where r ->> 'lemma_norm' = 'abandon'),
  'B2', 'level_refs returns the correction');
select is(jsonb_array_length(public.level_refs(array['nosuchwordxyz']) -> 'rows'), 0, 'unknown lemmas are left out');
-- A new list version changes the level: the old correction no longer applies.
update public.ref_word_levels set cefr = 'B2' where lemma_norm = 'abandon' and pos = 'verb' and source = 'cefrj';
select is(
  (select r -> 'refs' -> 0 -> 'tr_cefr' from jsonb_array_elements(public.level_refs(array['abandon']) -> 'rows') r),
  'null'::jsonb, 'a correction made for an older list level is not used');

-- lexicon_upsert stores the resolved level and the term's frequency.
create temporary table up as select public.lexicon_upsert('[
  {"lemma":"pgtapcope","lemma_norm":"pgtapcope","term_type":"word","pos":"verb","gloss_en":"deal with something difficult",
   "gloss_key":"deal difficult","meaning_tr":"başa çıkmak","ipa":null,"model":"test","zipf":4.1,
   "cefr":"B2","cefr_source":"ai","cefr_guess":"B2"}
]'::jsonb) as r;
grant select on up to authenticated;
select is((select cefr || '/' || cefr_source || '/' || cefr_guess || '/' || (cefr_guess_at is not null)
             from public.lexicon_senses where id = ((select r from up) -> 0 ->> 'sense_id')::uuid),
  'B2/ai/B2/true', 'a new sense keeps its level and is marked as asked');
select is((select zipf from public.lexicon_terms where lemma_norm = 'pgtapcope'), 4.10::numeric(4,2),
  'a new term keeps its Zipf value');

create temporary table seq0 as select server_seq from public.lexicon_senses
  where id = ((select r from up) -> 0 ->> 'sense_id')::uuid;
select is(public.lexicon_set_levels(jsonb_build_array(jsonb_build_object(
  'id', (select r from up) -> 0 ->> 'sense_id', 'cefr', 'B2', 'cefr_source', 'ai', 'cefr_list', null, 'cefr_reason_tr', null))),
  '{"senses": 0, "terms": 0}'::jsonb, 'an unchanged level is not written');
select is(public.lexicon_set_levels(jsonb_build_array(jsonb_build_object(
  'id', (select r from up) -> 0 ->> 'sense_id', 'cefr', 'B1', 'cefr_source', 'cefrj', 'cefr_list', 'A2',
  'cefr_reason_tr', 'Türkçede yaygın değil'))),
  '{"senses": 1, "terms": 0}'::jsonb, 'a changed level is written');
select ok((select server_seq from public.lexicon_senses where id = ((select r from up) -> 0 ->> 'sense_id')::uuid)
          > (select server_seq from seq0), 'and moves the lexicon cursor, so devices pull it');
select throws_ok(
  $$ select public.lexicon_set_levels(jsonb_build_array(jsonb_build_object(
       'id', (select r from up) -> 0 ->> 'sense_id', 'cefr', 'B1', 'cefr_source', 'ai', 'cefr_list', null,
       'cefr_reason_tr', 'only list levels have a reason'))) $$,
  '23514', null, 'a reason without a list level is refused');

-- System budget.
select is(public.ai_system_consume(2) ->> 'allowed', 'true', 'system call 1 of 2');
select is(public.ai_system_consume(2) ->> 'allowed', 'true', 'system call 2 of 2');
select is(public.ai_system_consume(2), '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'then the budget is used up');

reset role;

-- ---------------------------------------------------------------- clients

insert into auth.users (id, email, aud, role)
values ('77777777-7777-4777-8777-777777777777', 'g@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

select is((select cefr || '/' || cefr_source || '/' || cefr_list || '/' || cefr_reason_tr || '/' || zipf
             from public.lexicon_entries where lemma_norm = 'pgtapcope'),
  'B1/cefrj/A2/Türkçede yaygın değil/4.1', 'lexicon_entries carries the level columns');
select ok((select count(*) from public.ref_word_levels) > 0, 'signed-in users can read the reference data');
select throws_ok($$ insert into public.ref_word_freq values ('pgtapword', 3.5) $$, '42501', null,
  'clients cannot write reference data');
select throws_ok($$ select public.ai_system_consume(100) $$, '42501', null,
  'clients cannot use the system budget');
select throws_ok($$ select public.lexicon_set_levels('[]'::jsonb) $$, '42501', null,
  'clients cannot set levels');

create function pg_temp.note(p_level text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', '77777777-0000-7000-8000-0000000000b1', 'term', 'cope', 'term_norm', 'cope', 'term_type', 'word',
    'lexicon_term_id', null, 'ipa', null, 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'level_override', p_level, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert',
  'payload', pg_temp.note('B2', '001761000000000:00001:devg')))) -> 'acked'),
  '["77777777-0000-7000-8000-0000000000b1"]'::jsonb, 'a note with a level override is pushed');
select is(
  (select r -> 'row' ->> 'level_override' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'notes'),
  'B2', 'the override comes back on pull');

-- An app version without the column edits the note (tags): the override stays.
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert',
  'payload', (pg_temp.note(null, '001761000000000:00002:devg') - 'level_override')
             || '{"tags": ["work"]}'::jsonb))) -> 'stale'),
  '[]'::jsonb, 'a push without the column is applied');
select is((select level_override || ' ' || tags::text from public.notes where id = '77777777-0000-7000-8000-0000000000b1'),
  'B2 {work}', 'the tags change and the override is kept');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert',
  'payload', pg_temp.note(null, '001761000000000:00003:devg')))) -> 'stale'),
  '[]'::jsonb, 'an explicit null clears the override');
select is((select level_override from public.notes where id = '77777777-0000-7000-8000-0000000000b1'), null,
  'the override is cleared');

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'notes', 'op', 'upsert',
  'payload', pg_temp.note('Z9', '001761000000000:00004:devg')))) -> 'rejected')),
  1, 'an invalid level is rejected');

select * from finish();
rollback;
