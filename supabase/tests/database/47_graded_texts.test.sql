-- Graded reading library (20261101000510_graded_texts.sql, decision 0047): everyone (guests
-- too) reads approved texts and only those; a withdrawn text stays visible with its new
-- status so devices drop it; nobody but the service role writes texts or sees the job's
-- bookkeeping; cursor stamping.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------------------------------------------------------------- service role: the job
set local role service_role;

insert into public.graded_texts (id, plan_key, level, topic, title, body, sentences, lemma_profile,
  coverage_by_level, words, tokens, cov_level, cov_next, status, prompt_version, model, checks, cost_usd)
values
  ('47000000-0000-4000-8000-000000000001', 'B1|travel|0', 'B1', 'travel', 'A Late Train',
   'The train was late.', '[{"en":"The train was late.","tr":"Tren geç kaldı.","audio_key":"en-US/x.mp3","p":0}]',
   '{"the":1,"train":1,"be":1,"late":1}', '{"A1":0.75,"A2":1,"B1":1,"B2":1,"C1":1,"C2":1}', 4, 4, 1, 0,
   'checking', 'graded-v1', 'claude-sonnet-5-5', '{"coverage":{"ok":true}}', 0.01),
  ('47000000-0000-4000-8000-000000000002', 'B1|travel|1', 'B1', 'travel', 'Lost Luggage',
   'My bag did not arrive.', '[{"en":"My bag did not arrive.","tr":"Çantam gelmedi.","audio_key":"en-US/y.mp3","p":0}]',
   '{"my":1,"bag":1,"do":1,"not":1,"arrive":1}', '{"A1":0.8,"A2":1,"B1":1,"B2":1,"C1":1,"C2":1}', 5, 5, 1, 0,
   'rejected', 'graded-v1', 'claude-sonnet-5-5', '{}', 0.01);

create temporary table seq0 as select server_seq from public.graded_texts where id = '47000000-0000-4000-8000-000000000001';
grant select on seq0 to public;
select ok((select server_seq from seq0) > 0, 'a new text is stamped');
select is((select approved_at from public.graded_texts where id = '47000000-0000-4000-8000-000000000001'), null,
  'a text being checked is not approved');

update public.graded_texts set status = 'approved', check_version = 'gradedcheck-v1'
  where id = '47000000-0000-4000-8000-000000000001';
select ok((select approved_at from public.graded_texts where id = '47000000-0000-4000-8000-000000000001') is not null,
  'approval is stamped');
select ok((select server_seq from public.graded_texts where id = '47000000-0000-4000-8000-000000000001') > (select server_seq from seq0),
  'approval moves the row past the cursors');
select throws_ok($$ insert into public.graded_texts (plan_key, level, topic, title, body, sentences, lemma_profile,
  coverage_by_level, words, tokens, cov_level, cov_next, prompt_version)
  values ('B1|travel|9', 'B9', 'travel', 't', 'b', '[]', '{}', '{}', 1, 1, 1, 0, 'graded-v1') $$,
  '23514', null, 'the level must be a CEFR level');
select throws_ok($$ insert into public.graded_texts (plan_key, level, topic, title, body, sentences, lemma_profile,
  coverage_by_level, words, tokens, cov_level, cov_next, prompt_version)
  values ('B1|travel|9', 'B1', 'travel', 't', 'b', '[]', '{}', '{}', 1, 1, 1, 0, 'graded-v1') $$,
  '23514', null, 'a text needs at least one sentence');
select throws_ok($$ insert into public.graded_texts (plan_key, level, topic, title, body, sentences, lemma_profile,
  coverage_by_level, words, tokens, cov_level, cov_next, prompt_version)
  values ('bad key', 'B1', 'travel', 't', 'b', '[{}]', '{}', '{}', 1, 1, 1, 0, 'graded-v1') $$,
  '23514', null, 'the plan key has its shape');

-- jobs
insert into public.graded_jobs (plan_key, level, topic, slot, state, input)
  values ('B1|travel|2', 'B1', 'travel', 2, 'queued', '{"level":"B1"}');
select throws_ok($$ insert into public.graded_jobs (plan_key, level, topic, slot, state, input)
  values ('B1|travel|3', 'B1', 'travel', 3, 'submitted', '{}') $$, '23514', null, 'a submitted job needs its batch');
select throws_ok($$ insert into public.graded_jobs (plan_key, level, topic, slot, stage, state, input)
  values ('B1|travel|4', 'B1', 'travel', 4, 'check', 'queued', '{}') $$, '23514', null, 'a check job needs its text');
insert into public.graded_batches (id, stage, reserved_usd, requests, model, prompt_version)
  values ('msgbatch_graded_test', 'write', 1.5, 1, 'claude-sonnet-5-5', 'graded-v1');
select is((public.graded_cells() -> 'jobs' -> 0 ->> 'n')::int, 1, 'graded_cells counts the jobs');
select ok(jsonb_array_length(public.graded_cells() -> 'texts') >= 2, 'and the texts per status');

-- ---------------------------------------------------------------- anon (guest) reads
reset role;
set local role anon;
select is((select count(*)::int from public.graded_texts where id::text like '47000000-%'), 1,
  'a guest sees the approved text only');
select is((select title from public.graded_texts where id = '47000000-0000-4000-8000-000000000001'), 'A Late Train',
  'with its title');
select is((select sentences -> 0 ->> 'tr' from public.graded_texts where id = '47000000-0000-4000-8000-000000000001'),
  'Tren geç kaldı.', 'and its sentences');
select is((select (lemma_profile ->> 'train')::int from public.graded_texts where id = '47000000-0000-4000-8000-000000000001'),
  1, 'and its lemma profile');
select throws_ok($$ select cost_usd from public.graded_texts $$, '42501', null, 'not the cost');
select throws_ok($$ select checks from public.graded_texts $$, '42501', null, 'nor the checks');
select throws_ok($$ select plan_key, model from public.graded_texts $$, '42501', null, 'nor the plan key and model');
select throws_ok($$ insert into public.graded_texts (plan_key, level, topic, title, body, sentences, lemma_profile,
  coverage_by_level, words, tokens, cov_level, cov_next, prompt_version)
  values ('B1|travel|8', 'B1', 'travel', 't', 'b', '[{}]', '{}', '{}', 1, 1, 1, 0, 'graded-v1') $$,
  '42501', null, 'a guest cannot write the library');
select throws_ok($$ select count(*) from public.graded_jobs $$, '42501', null, 'nor read the jobs');
select throws_ok($$ select count(*) from public.graded_batches $$, '42501', null, 'nor the batches');
select throws_ok($$ select public.graded_cells() $$, '42501', null, 'nor run the job functions');

-- ---------------------------------------------------------------- signed-in users read
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "47474747-4747-4474-8474-474747474747", "role": "authenticated"}';
select is((select count(*)::int from public.graded_texts where id::text like '47000000-%'), 1,
  'a signed-in user sees the approved text only');
select throws_ok($$ update public.graded_texts set title = 'x' $$, '42501', null, 'but cannot change it');
select throws_ok($$ delete from public.graded_texts $$, '42501', null, 'or delete it');

-- ---------------------------------------------------------------- withdrawal
reset role;
set local role service_role;
update public.graded_texts set status = 'rejected' where id = '47000000-0000-4000-8000-000000000001';
select ok((select approved_at from public.graded_texts where id = '47000000-0000-4000-8000-000000000001') is not null,
  'a withdrawn text keeps its first approval');
reset role;
set local role anon;
select is((select status from public.graded_texts where id = '47000000-0000-4000-8000-000000000001'), 'rejected',
  'a guest sees the withdrawal, so the device drops the text');

select * from finish();
rollback;
