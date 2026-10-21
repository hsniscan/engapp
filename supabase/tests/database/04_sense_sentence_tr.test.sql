-- senses.source_sentence_tr (20261021000700_sense_sentence_tr.sql) round-trips through
-- sync_push / sync_pull_v2, is limited like source_sentence, and is optional.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role)
values ('44444444-4444-4444-8444-444444444444', 'd@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
set local request.jwt.claim.sub to '44444444-4444-4444-8444-444444444444';
set local role authenticated;

create function pg_temp.sense(p_id uuid, p_tr text, p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'note_id', 'dddddddd-0000-7000-8000-0000000000aa', 'sense_no', 1,
    'lexicon_sense_id', null, 'pos', 'noun', 'gloss_en', 'the land beside a river', 'meaning_tr', 'kıyı',
    'meaning_tr_override', null, 'source_sentence', 'We sat on the bank.', 'source_sentence_tr', p_tr,
    'span', '[14, 18]'::jsonb, 'source_id', null,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc)
$$;

select has_column('public', 'senses', 'source_sentence_tr', 'senses has source_sentence_tr');

select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'senses', 'op', 'upsert', 'payload',
  pg_temp.sense('dddddddd-0000-7000-8000-000000000001', 'Kıyıda oturduk.', '001761000000000:00001:devd')))) -> 'acked'),
  '["dddddddd-0000-7000-8000-000000000001"]'::jsonb, 'a sense with a translation is pushed');

select is(
  (select r -> 'row' ->> 'source_sentence_tr'
     from jsonb_array_elements(public.sync_pull_v2(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'senses'),
  'Kıyıda oturduk.', 'the translation comes back on pull');

-- A payload without the field (a client from before the column) stores null.
select is((public.sync_push(jsonb_build_array(jsonb_build_object('table', 'senses', 'op', 'upsert', 'payload',
  pg_temp.sense('dddddddd-0000-7000-8000-000000000002', null, '001761000000000:00002:devd') - 'source_sentence_tr'))) -> 'acked'),
  '["dddddddd-0000-7000-8000-000000000002"]'::jsonb, 'a sense without the field is accepted');
select is((select source_sentence_tr from public.senses where id = 'dddddddd-0000-7000-8000-000000000002'), null,
  'and has no translation');

select is((select jsonb_array_length(public.sync_push(jsonb_build_array(jsonb_build_object('table', 'senses', 'op', 'upsert', 'payload',
  pg_temp.sense('dddddddd-0000-7000-8000-000000000003', repeat('ç', 2001), '001761000000000:00003:devd')))) -> 'rejected')),
  1, 'a translation over 2000 characters is rejected');

select * from finish();
rollback;
