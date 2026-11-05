-- Bulk example sentences and phrases (20261106000400_example_bulk.sql,
-- 20261106000410_phrases.sql, decision 0074): lexicon_examples carry their source and
-- attribution, the job's targets and counts, its spending total, nobody but the service role
-- sees the bookkeeping, and the phrase list feeds word_bank_pending.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

set local role service_role;

create temporary table lex as select public.lexicon_upsert('[
  {"lemma":"pgebrun","lemma_norm":"pgebrun","term_type":"word","pos":"verb","gloss_en":"to move fast on foot pg74","gloss_key":"fast foot move pg74","meaning_tr":"koşmak","ipa":null,"model":"test"},
  {"lemma":"pgebrun","lemma_norm":"pgebrun","term_type":"word","pos":"verb","gloss_en":"to manage a business pg74","gloss_key":"business manage pg74","meaning_tr":"yönetmek","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as select
  (res -> 0 ->> 'sense_id')::uuid as s1, (res -> 1 ->> 'sense_id')::uuid as s2 from lex;
grant select on ids to public;

select is(public.word_bank_put(jsonb_build_array(jsonb_build_object(
  'lemma_norm', 'pgebrun', 'pos', 'verb', 'lemma', 'pgebrun', 'cefr', 'A1', 'list_source', 'cefrj', 'zipf', 5,
  'senses', jsonb_build_array(
    jsonb_build_object('meaning_tr', 'koşmak', 'example_en', 'I pgebrun every day.', 'example_tr', 'Her gün koşarım.', 'sense_id', (select s1 from ids)),
    jsonb_build_object('meaning_tr', 'yönetmek', 'example_en', 'She pgebruns a shop.', 'example_tr', 'Bir dükkân yönetir.', 'sense_id', (select s2 from ids))),
  'model', 'test', 'prompt_version', 'wordbank-v1', 'cost_usd', 0))), 1, 'a bank row to work on');

create temporary table ins as select public.lexicon_examples_insert(jsonb_build_array(
  jsonb_build_object('sense_id', (select s1 from ids), 'context', 'daily', 'level_band', 'A2',
    'text_en', 'Tom pgebruns to school.', 'span', jsonb_build_array(4, 12),
    'translations', jsonb_build_object('tr', 'Tom okula koşar.'), 'model', null,
    'prompt_version', 'examples-tag-v1', 'source', 'tatoeba',
    'attribution', jsonb_build_object('license', 'CC BY 2.0 FR', 'en_id', 1, 'en_by', 'CK', 'tr_id', 2, 'tr_by', 'x')),
  jsonb_build_object('sense_id', (select s1 from ids), 'context', 'work', 'level_band', 'A2',
    'text_en', 'We pgebrun after work.', 'span', jsonb_build_array(3, 10),
    'translations', jsonb_build_object('tr', 'İşten sonra koşarız.'), 'model', 'm',
    'prompt_version', 'examples-gen-v1'))) as r;
grant select on ins to public;
select is((select jsonb_array_length(r) from ins), 2, 'both sentences are inserted');
select is((select r -> 0 ->> 'source' from ins), 'tatoeba', 'the source comes back to devices');
select is((select r -> 0 -> 'attribution' ->> 'en_by' from ins), 'CK', 'so does the attribution');
select ok((select (r -> 1 -> 'source') = 'null'::jsonb and (r -> 1 -> 'attribution') = 'null'::jsonb from ins),
  'a model-written sentence has neither');
select throws_ok(
  $$update public.lexicon_examples set source = 'somewhere' where text_en = 'We pgebrun after work.'$$,
  '23514', null, 'only known sources are stored');

create temporary table tg as select public.example_bulk_targets('pgebrum', '', 5) as t;
grant select on tg to public;
select is((select t -> 0 ->> 'lemma_norm' from tg), 'pgebrun', 'targets page by key');
select is((select jsonb_array_length(t -> 0 -> 'senses') from tg), 2, 'with the senses of the row');
select is((select jsonb_array_length(t -> 0 -> 'active' -> ((select s1 from ids)::text)) from tg), 2,
  'and the active sentences each sense already has');
select ok((select (t -> 0 -> 'active' -> ((select s2 from ids)::text)) is null from tg), 'a sense without sentences has none');

insert into public.example_bulk_items (lemma_norm, pos, sense_id, state, source, text_en, text_tr)
values ('pgebrun', 'verb', (select s2 from ids), 'kept', 'model', 'They pgebrun a cafe.', 'Bir kafe işletiyorlar.'),
       ('pgebrun', 'verb', (select s2 from ids), 'rejected', 'model', 'He pgebruns the show.', 'Gösteriyi yönetir.');
select is((public.example_bulk_sense_counts() -> ((select s2 from ids)::text) ->> 'kept')::int, 1, 'counts by sense and state');
select throws_ok(
  $$insert into public.example_bulk_items (lemma_norm, pos, state, source, text_en)
    values ('pgebrun', 'verb', 'candidate', 'tatoeba', 'They  PGEBRUN a cafe!')$$,
  '23505', null, 'one candidate per sentence and bank row');

insert into public.example_bulk_batches (id, step, reserved_usd, requests, model, prompt_version)
  values ('pg74_a', 'tag', 0.5, 3, 'm', 'v');
insert into public.example_bulk_batches (id, step, reserved_usd, requests, model, prompt_version, state, cost_usd)
  values ('pg74_b', 'review', 2, 3, 'm', 'v', 'collected', 0.25);
select is(public.example_bulk_spent(), 0.75::numeric, 'spent = settled costs + open reservations');

-- Phrases feed the bank job.
select is((public.ref_phrases_put('[
  {"lemma_norm":"pgeb give up","pos":"phrasal verb","cefr":"A2","zipf":4.4,"source":"wiktionary","corpus_count":900,"source_version":"t"},
  {"lemma_norm":"pgeb make a decision","pos":"phrase","cefr":"B1","zipf":3.6,"source":"corpus","corpus_count":200,"source_version":"t"}
]'::jsonb) ->> 'stored')::int, 2, 'phrases are stored');
select is(
  (select e ->> 'source' from jsonb_array_elements(public.word_bank_pending(20000)) e
    where e ->> 'lemma_norm' = 'pgeb give up'),
  'wiktionary', 'a phrase without a bank row is pending');
select is(public.word_bank_put('[
  {"lemma_norm":"pgeb give up","pos":"phrasal verb","lemma":"pgeb give up","cefr":"A2","list_source":"wiktionary","zipf":4.4,
   "senses":[{"meaning_tr":"vazgeçmek","example_en":"Never pgeb give up.","example_tr":"Asla vazgeçme.","sense_id":null}],
   "model":"test","prompt_version":"wordbank-v1","cost_usd":0}
]'::jsonb), 1, 'the bank takes phrasal verbs');
reset role;

set local role anon;
select throws_ok($$select * from public.example_bulk_items$$, '42501', null, 'guests cannot read the job tables');
reset role;

select * from finish();
rollback;
