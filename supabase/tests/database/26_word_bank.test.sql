-- Word bank (20261026001100_word_bank.sql, decision 0038): everyone (guests too) reads the bank
-- rows, nobody but the service role writes them or sees the job's bookkeeping; pending words,
-- idempotent stores, cursor stamping and the shared Claude budget.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ---------------------------------------------------------------- service role: the job
set local role service_role;

-- Two list words of our own (the real lists are loaded by 20261021001200).
insert into public.ref_word_levels (lemma_norm, pos, cefr, source, source_version) values
  ('pgwbapple', 'noun', 'A1', 'cefrj', 'test'),
  ('pgwbapple', 'verb', 'C2', 'octanove', 'test'),
  ('pgwbcalm', 'adjective', 'B1', 'cefrj', 'test'),
  ('pgwbcalm', 'adjective', 'C1', 'octanove', 'test');

create temporary table pend as select public.word_bank_pending(20000) as p;
grant select on pend to public;
select ok(jsonb_array_length((select p from pend)) >= 4, 'pending lists the list words without a bank row');
select is((select p -> 0 ->> 'cefr' from pend), 'A1', 'easiest words first');
select is(
  (select e ->> 'cefr' from pend, jsonb_array_elements(p) e where e ->> 'lemma_norm' = 'pgwbcalm'),
  'B1', 'a word in both lists takes CEFR-J');
select is(
  (select count(*)::int from pend, jsonb_array_elements(p) e where e ->> 'lemma_norm' = 'pgwbcalm'),
  1, 'one entry per lemma and part of speech');
select is(jsonb_array_length(public.word_bank_pending(3)), 3, 'the limit holds');

-- The Turkish-learner correction applies while it was made for the current list level.
update public.ref_word_levels set tr_checked_at = now(), tr_base_cefr = 'A1', tr_cefr = 'A2', tr_reason = 'test'
  where lemma_norm = 'pgwbapple' and pos = 'noun';
select is(
  (select e ->> 'cefr' from jsonb_array_elements(public.word_bank_pending(20000)) e
    where e ->> 'lemma_norm' = 'pgwbapple' and e ->> 'pos' = 'noun'),
  'A2', 'the Turkish-learner correction is used');

select is(public.word_bank_put('[
  {"lemma_norm":"pgwbapple","pos":"noun","lemma":"pgwbapple","cefr":"A2","list_source":"cefrj","zipf":5.1,
   "senses":[{"meaning_tr":"elma","example_en":"I eat a pgwbapple.","example_tr":"Bir elma yerim.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001}
]'::jsonb), 1, 'a bank row is stored');
select ok((select server_seq from public.word_bank where lemma_norm = 'pgwbapple') > 0, 'the row is stamped');
select is((select state from public.word_bank_jobs where lemma_norm = 'pgwbapple' and pos = 'noun'), 'done', 'its job is done');
select is(
  (select count(*)::int from jsonb_array_elements(public.word_bank_pending(20000)) e
    where e ->> 'lemma_norm' = 'pgwbapple' and e ->> 'pos' = 'noun'),
  0, 'a stored word is no longer pending');

create temporary table seq0 as select server_seq from public.word_bank where lemma_norm = 'pgwbapple';
grant select on seq0 to public;
select is(public.word_bank_put('[
  {"lemma_norm":"pgwbapple","pos":"noun","lemma":"pgwbapple","cefr":"A2","list_source":"cefrj","zipf":5.1,
   "senses":[{"meaning_tr":"elma","example_en":"I eat a pgwbapple.","example_tr":"Bir elma yerim.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001}
]'::jsonb), 0, 'storing the same row again changes nothing');
select is((select server_seq from public.word_bank where lemma_norm = 'pgwbapple'), (select server_seq from seq0),
  'an unchanged row keeps its cursor position');
update public.word_bank set retired = true where lemma_norm = 'pgwbapple';
select ok((select server_seq from public.word_bank where lemma_norm = 'pgwbapple') > (select server_seq from seq0),
  'retiring a row moves it past the cursors');

-- Submitted and finally failed words are not pending; queued ones are.
insert into public.word_bank_jobs (lemma_norm, pos, state, attempt, batch_id, custom_id) values
  ('pgwbcalm', 'adjective', 'submitted', 1, 'msgbatch_test', 'wb_test');
insert into public.word_bank_jobs (lemma_norm, pos, state, attempt) values ('pgwbapple', 'verb', 'failed', 3);
select is(
  (select count(*)::int from jsonb_array_elements(public.word_bank_pending(20000)) e
    where e ->> 'lemma_norm' in ('pgwbcalm', 'pgwbapple')),
  0, 'submitted and failed words are not pending');
update public.word_bank_jobs set state = 'queued', batch_id = null, attempt = 1 where lemma_norm = 'pgwbcalm';
select is(
  (select (e ->> 'attempt')::int from jsonb_array_elements(public.word_bank_pending(20000)) e
    where e ->> 'lemma_norm' = 'pgwbcalm'),
  1, 'a queued word is pending again with its attempts');
select throws_ok($$ insert into public.word_bank_jobs (lemma_norm, pos, state) values ('x', 'noun', 'submitted') $$,
  '23514', null, 'a submitted job needs its batch');
select throws_ok($$ select public.word_bank_put(jsonb_build_array(jsonb_build_object(
  'lemma_norm','pgwbcalm','pos','adjective','lemma','Other','cefr','B1','list_source','cefrj',
  'senses','[{"meaning_tr":"sakin"}]'::jsonb,'prompt_version','wordbank-v1'))) $$,
  '23514', null, 'the display lemma must be the same word');
select throws_ok($$ select public.word_bank_put(jsonb_build_array(jsonb_build_object(
  'lemma_norm','pgwbcalm','pos','adjective','lemma','pgwbcalm','cefr','B1','list_source','cefrj',
  'senses','[]'::jsonb,'prompt_version','wordbank-v1'))) $$,
  '23514', null, 'a row needs at least one meaning');

-- Budget: word-bank holds use the shared monthly cap and survive the stale release.
create temporary table hold as select public.image_budget_reserve(0.5, 1000, 'wordbank') as id;
grant select on hold to public;
select ok((select id from hold) is not null, 'a word-bank hold is reserved on the shared budget');
update public.image_budget_holds set created_at = now() - interval '2 days' where id = (select id from hold);
select is(public.image_budget_release_stale('1 hour'), 0, 'a word-bank hold is not released as stale');
select lives_ok($$ select public.image_budget_settle((select id from hold), 0.1) $$, 'and settles at collect');

-- ---------------------------------------------------------------- anon (guest) and users read
reset role;
set local role anon;
select is((select cefr from public.word_bank where lemma_norm = 'pgwbapple' and pos = 'noun'), 'A2',
  'a guest reads the bank');
select ok((select senses -> 0 ->> 'meaning_tr' from public.word_bank where lemma_norm = 'pgwbapple') = 'elma',
  'with its meanings');
select throws_ok($$ select model from public.word_bank $$, '42501', null, 'not the job''s bookkeeping columns');
select throws_ok($$ insert into public.word_bank (lemma_norm, pos, lemma, cefr, list_source, senses, prompt_version)
  values ('x', 'noun', 'x', 'A1', 'cefrj', '[{}]', 'v') $$, '42501', null, 'a guest cannot write the bank');
select throws_ok($$ select count(*) from public.word_bank_jobs $$, '42501', null, 'nor read the jobs');
select throws_ok($$ select public.word_bank_pending(1) $$, '42501', null, 'nor run the job functions');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "26262626-2626-4262-8262-262626262626", "role": "authenticated"}';
select is((select lemma from public.word_bank where lemma_norm = 'pgwbapple' and pos = 'noun'), 'pgwbapple',
  'a signed-in user reads the bank');
select throws_ok($$ update public.word_bank set cefr = 'C2' $$, '42501', null, 'but cannot change it');
select throws_ok($$ delete from public.word_bank $$, '42501', null, 'or delete it');
select throws_ok($$ select public.word_bank_put('[]'::jsonb) $$, '42501', null, 'or store rows');

select * from finish();
rollback;
