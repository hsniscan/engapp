-- İP6 (20261022000200_word_family.sql): reference tables and lexicon_pair_notes are
-- readable by signed-in users and writable only by the service role; pair notes are
-- deduplicated per (pair, kind, term, sense, content key) and stamped with lexicon_seq;
-- notes accept term_type 'affix' through sync_push.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select has_table('public', 'ref_morphemes', 'ref_morphemes exists');
select has_table('public', 'ref_word_morphemes', 'ref_word_morphemes exists');
select has_table('public', 'ref_families', 'ref_families exists');
select has_table('public', 'ref_sources', 'ref_sources exists');
select has_table('public', 'lexicon_pair_notes', 'lexicon_pair_notes exists');

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and c.relname in ('ref_morphemes', 'ref_word_morphemes', 'ref_families', 'ref_sources', 'lexicon_pair_notes') $$,
  'RLS is enabled on every new shared table');

select is_empty(
  $$ select tablename || ':' || cmd from pg_policies
      where schemaname = 'public'
        and tablename in ('ref_morphemes', 'ref_word_morphemes', 'ref_families', 'ref_sources', 'lexicon_pair_notes')
        and cmd <> 'SELECT' $$,
  'the new shared tables have only SELECT policies');

-- ---------------------------------------------------------------- service role loads
set local role service_role;

insert into public.ref_morphemes (id, form, kind, origin, gloss_en, meanings, word_count, source_version)
values ('pgtapspect', '-spect-', 'root', 'latin', 'look, see', '{"tr":{"meaning":"bakmak","source":"curated"}}', 3, 'test'),
       ('pgtapre-', 're-', 'prefix', 'latin', 'again', '{}', 3, 'test');
insert into public.ref_word_morphemes (lemma_norm, morpheme_id, position)
values ('pgtapinspect', 'pgtapspect', 0), ('pgtaprespect', 'pgtapre-', 0), ('pgtaprespect', 'pgtapspect', 1);
insert into public.ref_families (lemma_norm, family_id, pos, rank)
values ('pgtapinspect', 'pgtapinspect', null, 0), ('pgtapinspection', 'pgtapinspect', 'noun', 1);

-- ref_sources is shared with İP2's word-level sources (cefrj, octanove, wordfreq): the
-- morphology loader adds its own morph-* keys, without checksum or row count.
insert into public.ref_sources (key, name, version, url, sha256, license, attribution)
values ('morph-morphynet', 'MorphyNet English derivational morphology', 'v1, commit 378144f', 'https://example.org/m',
        null, 'CC BY-SA 3.0', 'Batsuren et al. (2021)');
select is((select count(*)::int from public.ref_sources where key in ('cefrj', 'octanove', 'wordfreq')), 3,
  'the word-level sources are still there');
select is((select attribution from public.ref_sources where key = 'morph-morphynet'), 'Batsuren et al. (2021)',
  'a morphology source is stored next to them');
select is((select conname::text from pg_constraint where conname = 'notes_term_type_check'
            and pg_get_constraintdef(oid) like '%word%phrase%pattern%affix%'), 'notes_term_type_check',
  'notes_term_type_check allows word, phrase, pattern and affix');

insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated)
values ('pgtapactually', 'en-tr', 'false_friend', 'aktüel',
        '{"tr_word":"aktüel","en_meaning_tr":"aslında","tr_meaning_tr":"güncel","tr_meaning_en":"current","strength":"full","note_tr":null}', true);
select ok((select server_seq > 0 from public.lexicon_pair_notes where term_norm = 'pgtapactually'),
  'pair notes are stamped from lexicon_seq');

select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated)
     values ('pgtapactually', 'en-tr', 'false_friend', 'aktüel', '{}', true) $$,
  '23505', null, 'the same (pair, kind, term, sense, key) cannot be stored twice');
select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content)
     values ('pgtapx', 'en-tr', 'mnemonic_suggestion', 'x', '{}') $$,
  '23514', null, 'an AI note must name its model and prompt version');
select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated)
     values ('pgtapx', 'en-de', 'false_friend', 'x', '{}', true) $$,
  '23514', null, 'only known language pairs');
select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated)
     values ('PgTap', 'en-tr', 'false_friend', 'x', '{}', true) $$,
  '23514', null, 'term_norm must be normalised');
select throws_ok(
  $$ insert into public.ref_morphemes (id, form, kind, origin, gloss_en, source_version)
     values ('bad', 'bad', 'infix', 'latin', 'x', 'test') $$,
  '23514', null, 'morpheme kind is checked');

-- ---------------------------------------------------------------- signed-in user reads only
reset role;
insert into auth.users (id, email, aud, role)
values ('66666666-6666-4666-8666-666666666666', 'f@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';
set local request.jwt.claim.sub to '66666666-6666-4666-8666-666666666666';
set local role authenticated;

select is((select count(*)::int from public.ref_word_morphemes where lemma_norm = 'pgtaprespect'), 2,
  'a signed-in user reads ref_word_morphemes');
select is((select meanings -> 'tr' ->> 'meaning' from public.ref_morphemes where id = 'pgtapspect'), 'bakmak',
  'a signed-in user reads morpheme meanings');
select is((select content ->> 'tr_word' from public.lexicon_pair_notes where term_norm = 'pgtapactually'), 'aktüel',
  'a signed-in user reads pair notes');

select throws_ok(
  $$ insert into public.lexicon_pair_notes (term_norm, lang_pair, kind, content_key, content, curated)
     values ('pgtapuser', 'en-tr', 'false_friend', 'x', '{"tr_word":"my text"}', true) $$,
  '42501', null, 'a client cannot write pair notes');
select throws_ok(
  $$ update public.lexicon_pair_notes set content = '{}' where term_norm = 'pgtapactually' $$,
  '42501', null, 'a client cannot change pair notes');
select throws_ok(
  $$ delete from public.ref_families $$,
  '42501', null, 'a client cannot delete reference rows');
select throws_ok(
  $$ insert into public.ref_morphemes (id, form, kind, origin, gloss_en, source_version)
     values ('x', 'x-', 'prefix', 'latin', 'x', 'test') $$,
  '42501', null, 'a client cannot write ref_morphemes');

-- ---------------------------------------------------------------- affix notes sync
create temporary table r as
select public.sync_push(jsonb_build_array(
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'aaaaaaaa-0000-7000-8000-0000000006a1', 'term', '-spect-', 'term_norm', '-spect-', 'term_type', 'affix',
    'lexicon_term_id', null, 'ipa', null, 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00001:deva')),
  jsonb_build_object('table', 'notes', 'op', 'upsert', 'payload', jsonb_build_object(
    'id', 'aaaaaaaa-0000-7000-8000-0000000006a2', 'term', 'x', 'term_norm', 'x', 'term_type', 'bogus',
    'lexicon_term_id', null, 'ipa', null, 'tags', '[]'::jsonb, 'possible_duplicate', false,
    'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', '001761000000000:00001:deva'))
)) as res;
select is((select res -> 'acked' from r), '["aaaaaaaa-0000-7000-8000-0000000006a1"]'::jsonb,
  'an affix note is accepted');
select is((select jsonb_array_length(res -> 'rejected') from r), 1, 'an unknown term_type is still rejected');
select is((select term_type from public.notes where id = 'aaaaaaaa-0000-7000-8000-0000000006a1'), 'affix',
  'the affix note is stored');

-- ---------------------------------------------------------------- anon sees nothing
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.lexicon_pair_notes $$, '42501', null, 'anon cannot read pair notes');
select throws_ok($$ select count(*) from public.ref_families $$, '42501', null, 'anon cannot read reference tables');

select * from finish();
rollback;
