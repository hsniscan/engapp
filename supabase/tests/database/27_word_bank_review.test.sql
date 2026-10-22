-- Word bank review pass (20261026001300_word_bank_review.sql, decision 0040): rows to review,
-- applying corrections only to rows that still have the reviewed senses, cursor moves for
-- changed and retired rows only, and the bookkeeping is service-role only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

set local role service_role;

select is(public.word_bank_put('[
  {"lemma_norm":"pgwrscythe","pos":"noun","lemma":"pgwrscythe","cefr":"C1","list_source":"octanove","zipf":2.1,
   "senses":[{"meaning_tr":"ölüm meleği","example_en":"He used a pgwrscythe.","example_tr":"Tırpan kullandı.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001},
  {"lemma_norm":"pgwrmutable","pos":"adjective","lemma":"pgwrmutable","cefr":"A1","list_source":"cefrj","zipf":3,
   "senses":[{"meaning_tr":"değişebilir","example_en":"Plans are pgwrmutable.","example_tr":"Planlar değişebilir.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001},
  {"lemma_norm":"pgwrgone","pos":"noun","lemma":"pgwrgone","cefr":"B1","list_source":"cefrj","zipf":3,
   "senses":[{"meaning_tr":"yok","example_en":"A pgwrgone.","example_tr":"Bir yok.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001},
  {"lemma_norm":"pgwrold","pos":"noun","lemma":"pgwrold","cefr":"B1","list_source":"cefrj","zipf":3,
   "senses":[{"meaning_tr":"eski","example_en":"A pgwrold.","example_tr":"Bir eski.","sense_id":null}],
   "model":"claude-haiku-5-5","prompt_version":"wordbank-v1","cost_usd":0.0001}
]'::jsonb), 4, 'four bank rows to review');
update public.word_bank set retired = true where lemma_norm = 'pgwrold';

create temporary table pend as select public.word_bank_review_pending(20000) as p;
grant select on pend to public;
select is(
  (select count(*)::int from pend, jsonb_array_elements(p) e where e ->> 'lemma_norm' like 'pgwr%'),
  3, 'every non-retired row is pending');
select ok(
  (select (select array_agg(e ->> 'lemma_norm') from jsonb_array_elements(p) e where e ->> 'lemma_norm' like 'pgwr%')
   from pend)[1] = 'pgwrmutable', 'easiest level first');
select is(
  (select e -> 'senses' -> 0 ->> 'meaning_tr' from pend, jsonb_array_elements(p) e where e ->> 'lemma_norm' = 'pgwrscythe'),
  'ölüm meleği', 'with the senses to check');

-- In flight: not pending.
insert into public.word_bank_review (lemma_norm, pos, state, attempt, batch_id, custom_id, input) values
  ('pgwrscythe', 'noun', 'submitted', 0, 'msgbatch_r', 'wr_test', '{"n":0}');
select is(
  (select count(*)::int from jsonb_array_elements(public.word_bank_review_pending(20000)) e where e ->> 'lemma_norm' = 'pgwrscythe'),
  0, 'a row in flight is not pending');
select throws_ok($$ insert into public.word_bank_review (lemma_norm, pos, state) values ('pgwrgone', 'noun', 'submitted') $$,
  '23514', null, 'a submitted review needs its batch');
select throws_ok($$ insert into public.word_bank_review (lemma_norm, pos, state) values ('nosuchrow', 'noun', 'queued') $$,
  '23503', null, 'a review belongs to a bank row');

create temporary table seq0 as select lemma_norm, server_seq from public.word_bank where lemma_norm like 'pgwr%';
grant select on seq0 to public;

select is(public.word_bank_review_apply('[
  {"lemma_norm":"pgwrscythe","pos":"noun",
   "expected":[{"meaning_tr":"ölüm meleği","example_en":"He used a pgwrscythe.","example_tr":"Tırpan kullandı.","sense_id":null}],
   "senses":[{"meaning_tr":"tırpan","example_en":"He used a pgwrscythe.","example_tr":"Tırpan kullandı.","sense_id":null}],
   "retire":false,"lexicon_term_id":null,"attempt":1,"outcome":{"kept":0,"fixed":[{"sense":0}],"dropped":[],"rejected":[],"retired":false},
   "model":"claude-sonnet-5-5","prompt_version":"wordbank-review-v1","cost_usd":0.00005},
  {"lemma_norm":"pgwrmutable","pos":"adjective",
   "expected":[{"meaning_tr":"değişebilir","example_en":"Plans are pgwrmutable.","example_tr":"Planlar değişebilir.","sense_id":null}],
   "senses":null,"retire":false,"lexicon_term_id":null,"attempt":1,"outcome":{"kept":1,"fixed":[],"dropped":[],"rejected":[],"retired":false},
   "model":"claude-sonnet-5-5","prompt_version":"wordbank-review-v1","cost_usd":0.00005},
  {"lemma_norm":"pgwrgone","pos":"noun",
   "expected":[{"meaning_tr":"başka","example_en":"x","example_tr":"y","sense_id":null}],
   "senses":null,"retire":true,"lexicon_term_id":null,"attempt":1,"outcome":{"kept":0,"fixed":[],"dropped":[{"sense":0}],"rejected":[],"retired":true},
   "model":"claude-sonnet-5-5","prompt_version":"wordbank-review-v1","cost_usd":0.00005}
]'::jsonb), '{"changed": 1, "retired": 0, "stale": 1}'::jsonb, 'one row changed, one kept, one stale');

select is((select senses -> 0 ->> 'meaning_tr' from public.word_bank where lemma_norm = 'pgwrscythe'), 'tırpan',
  'the corrected meaning is stored');
select ok((select server_seq from public.word_bank where lemma_norm = 'pgwrscythe')
  > (select server_seq from seq0 where lemma_norm = 'pgwrscythe'), 'a changed row moves past the cursors');
select is((select server_seq from public.word_bank where lemma_norm = 'pgwrmutable'),
  (select server_seq from seq0 where lemma_norm = 'pgwrmutable'), 'a kept row keeps its cursor position');
select is((select retired from public.word_bank where lemma_norm = 'pgwrgone'), false,
  'a row that changed since it was sent is not touched');
select results_eq(
  $$ select state, prompt_version, (reviewed_at is not null), previous_senses -> 0 ->> 'meaning_tr'
     from public.word_bank_review where lemma_norm = 'pgwrscythe' $$,
  $$ values ('done'::text, 'wordbank-review-v1'::text, true, 'ölüm meleği'::text) $$,
  'the review is recorded with the senses before the change');
select is((select state from public.word_bank_review where lemma_norm = 'pgwrmutable'), 'done',
  'a kept row is recorded as reviewed');
select is((select state || '/' || last_error from public.word_bank_review where lemma_norm = 'pgwrgone'), 'queued/stale',
  'the stale row is queued for a new review');
select is(
  (select array_agg(e ->> 'lemma_norm' order by e ->> 'lemma_norm') from jsonb_array_elements(public.word_bank_review_pending(20000)) e
    where e ->> 'lemma_norm' like 'pgwr%'),
  array['pgwrgone'], 'only the stale row is pending now');

-- Retire: every meaning dropped.
select is(public.word_bank_review_apply('[
  {"lemma_norm":"pgwrgone","pos":"noun",
   "expected":[{"meaning_tr":"yok","example_en":"A pgwrgone.","example_tr":"Bir yok.","sense_id":null}],
   "senses":null,"retire":true,"lexicon_term_id":null,"attempt":1,"outcome":{"retired":true},
   "model":"claude-sonnet-5-5","prompt_version":"wordbank-review-v1","cost_usd":0}
]'::jsonb) ->> 'retired', '1', 'a row with nothing left is retired');
select ok((select retired and server_seq > (select server_seq from seq0 where lemma_norm = 'pgwrgone')
  from public.word_bank where lemma_norm = 'pgwrgone'), 'and moves past the cursors so devices delete it');

-- Nobody else sees or runs any of it.
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.word_bank_review $$, '42501', null, 'a guest cannot read the reviews');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "27272727-2727-4272-8272-272727272727", "role": "authenticated"}';
select throws_ok($$ select public.word_bank_review_apply('[]'::jsonb) $$, '42501', null,
  'a user cannot apply reviews');

select * from finish();
rollback;
