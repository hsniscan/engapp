-- Account deletion (20261025000700_account_delete.sql, ADR 0035): every user-scoped table is
-- covered, delete_user_data() leaves no row of the user and touches nobody else, deleting
-- the auth user cascades everywhere, the shared lexicon has no user column, and clients
-- cannot call either function.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ---------------------------------------------------------------- the catalog guard
select ok((select count(*) from public.user_owned_columns()) >= 20,
  'user_owned_columns() finds the user-scoped tables');
select is_empty($$
  select c.table_name::text from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
    and (c.table_name::text, 'user_id') not in (select table_name, column_name from public.user_owned_columns())
$$, 'every public table with a user_id column has a foreign key to auth.users');
select is_empty($$ select table_name from public.user_owned_columns() where not cascades $$,
  'every foreign key to auth.users is ON DELETE CASCADE');
select is_empty($$
  select table_name::text || '.' || column_name::text from information_schema.columns
  where table_schema = 'public'
    and (table_name like 'lexicon\_%' or table_name like 'ref\_%' or table_name like 'word\_bank%'
         or table_name in ('ai_system_usage', 'sync_tables', 'push_cron_config', 'job_runs'))
    and (column_name in ('user_id', 'owner', 'owner_id', 'created_by', 'requested_by', 'email', 'device_id')
         or column_name like '%user%')
$$, 'shared tables (lexicon, reference data, word bank, job runs, system budget) have no user column');
select is_empty($$
  select table_name from public.user_owned_columns()
  where table_name like 'lexicon\_%' or table_name like 'ref\_%'
$$, 'no shared table references a user');

-- ---------------------------------------------------------------- seed two users everywhere
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('35353535-3535-4535-8535-353535353501', 'del@test.local', 'authenticated', 'authenticated',
   '{"full_name": "Silinecek Kişi"}'),
  ('35353535-3535-4535-8535-353535353502', 'keep@test.local', 'authenticated', 'authenticated',
   '{"full_name": "Kalan Kişi"}');

-- A shared picture (lexicon sense, image, request) for the picture tables of the seed.
set local role service_role;
create temporary table pic_lex as select public.lexicon_upsert('[
  {"lemma":"Delpic","lemma_norm":"delpic","term_type":"word","pos":"noun","gloss_en":"a test picture word","gloss_key":"picture test word","meaning_tr":"resim","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table pic as
  select (res -> 0 ->> 'sense_id')::uuid as sense_id from pic_lex;
alter table pic add column image_id uuid;
update pic set image_id = (public.image_insert(jsonb_build_object('sense_id', sense_id, 'svg', '<svg/>',
  'alt_tr', 'Bir resim', 'status', 'review', 'model', 'm', 'prompt_version', 'image-v1')) ->> 'id')::uuid;
insert into public.image_requests (sense_id, source) select sense_id, 'user' from pic;
reset role;

create function pg_temp.seed(u uuid) returns void language plpgsql as $f$
declare
  h text := '001761000000000:00000:dev1';
  note uuid := gen_random_uuid();
  card uuid := gen_random_uuid();
begin
  insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc)
    values (note, u, 'Delword', 'delword', 'word', 1, 1, h);
  insert into public.senses (id, user_id, note_id, sense_no, meaning_tr, source_sentence, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, note, 1, 'silinen', 'A private sentence about delword.', 1, 1, h);
  insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state, created_at, updated_at, hlc)
    values (card, u, note, 'recognition', 1, 0, 0, 0, 1, 1, h);
  insert into public.review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, created_at, hlc)
    values (gen_random_uuid(), u, card, 3, 2, 1000, 'dev1', 2, h);
  insert into public.practice_logs (id, user_id, card_id, practiced_at, result, mode, session_id, duration_ms, device_id, created_at, hlc)
    values (gen_random_uuid(), u, card, 3, 'known', 'hard', gen_random_uuid(), 1000, 'dev1', 3, h);
  insert into public.sources (id, user_id, kind, title, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'text', 'Private notes', 1, 1, h);
  insert into public.settings (id, user_id, daily_new_limit, request_retention, timezone, day_start_hour, theme, voice, level, created_at, updated_at, hlc)
    values ('settings', u, 10, 0.9, 'Europe/Istanbul', 4, 'system', 'en-US', 'B1', 1, 1, h);
  insert into public.decks (id, user_id, name, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'Deck', 1, 1, h);
  insert into public.known_terms (id, user_id, term_norm, source, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'known', 'manual', 1, 1, h);
  insert into public.level_tests (id, user_id, taken_at, result_level, vocab_estimate, reliable, false_alarm_rate,
      ratios, items, bank_version, applied, duration_ms, device_id, created_at, hlc)
    values (gen_random_uuid(), u, 1, 'B1', 3000, true, 0, '{}', '[]', 'v1', true, 60000, 'dev1', 1, h);
  insert into public.content_feedback (id, user_id, target_kind, target_id, verdict, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'example', gen_random_uuid(), 'like', 1, 1, h);
  insert into public.user_content (id, user_id, kind, text, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'mnemonic', 'My own mnemonic', 1, 1, h);
  insert into public.weekly_reports (id, user_id, week, summary, device_id, created_at, hlc)
    values (gen_random_uuid(), u, '2026-10-19', '{}', 'dev1', 1, h);
  insert into public.user_texts (id, user_id, kind, title, body, created_at, updated_at, hlc)
    values (gen_random_uuid(), u, 'paste', 'My text', 'A private text I read.', 1, 1, h);
  insert into public.user_encounters (id, user_id, note_id, day, source, n, device_id, created_at, updated_at, hlc)
    values (note::text || '|2026-11-01|reader|dev1', u, note, '2026-11-01', 'reader', 1, 'dev1', 1, 1, h);
  insert into public.ai_usage (user_id, day) values (u, current_date);
  insert into public.ai_chunk_cache (user_id, chunk_hash, prompt_version, level, result)
    values (u, repeat('a', 64), 'extract-v5', 'B1', '{"candidates": []}');
  insert into public.sync_horizon (user_id) values (u) on conflict do nothing;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (u, 'https://fcm.googleapis.com/fcm/send/' || u::text, repeat('B', 87), repeat('A', 22));
  insert into public.push_log (user_id, day) values (u, '2026-10-22');
  insert into public.tts_usage (user_id, day) values (u, current_date);
  insert into public.image_usage (user_id, day) values (u, current_date);
  insert into public.image_request_users (sense_id, user_id) select sense_id, u from pic;
  insert into public.image_feedback (image_id, sense_id, user_id, decision)
    select image_id, sense_id, u, 'approve' from pic;
  insert into public.app_admins (user_id) values (u);
end;
$f$;

select pg_temp.seed('35353535-3535-4535-8535-353535353501');
select pg_temp.seed('35353535-3535-4535-8535-353535353502');

-- Rows of a user across every user-scoped table, counted from the catalog.
create function pg_temp.rows_of(u uuid) returns bigint language plpgsql as $f$
declare
  r record;
  n bigint;
  total bigint := 0;
begin
  for r in select * from public.user_owned_columns() loop
    execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name)
      into n using u;
    total := total + n;
  end loop;
  return total;
end;
$f$;
-- Tables in which a user has no row (must be none after seeding).
create function pg_temp.empty_tables(u uuid) returns setof text language plpgsql as $f$
declare
  r record;
  n bigint;
begin
  for r in select * from public.user_owned_columns() loop
    execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name)
      into n using u;
    if n = 0 then return next r.table_name; end if;
  end loop;
end;
$f$;

select is_empty($$ select * from pg_temp.empty_tables('35353535-3535-4535-8535-353535353501') $$,
  'the seed reaches every user-scoped table (a new table must be added to this test)');
-- A shared lexicon entry (the kind ai-extract adds when this user imports a text).
set local role service_role;
create temporary table lex_seed as select public.lexicon_upsert('[
  {"lemma":"Delword","lemma_norm":"delword","term_type":"word","pos":"noun","gloss_en":"a test word","gloss_key":"a test word","meaning_tr":"deneme","ipa":null,"model":"test"}
]'::jsonb) as res;
reset role;
create temporary table lex_before as
  select (select count(*) from public.lexicon_terms) as terms,
         (select count(*) from public.lexicon_senses) as senses,
         (select count(*) from public.lexicon_examples) as examples,
         (select count(*) from public.lexicon_pair_notes) as pair_notes,
         (select count(*) from public.lexicon_images) as images;

-- ---------------------------------------------------------------- clients cannot call it
set local request.jwt.claims to '{"sub":"35353535-3535-4535-8535-353535353501","role":"authenticated"}';
set local request.jwt.claim.sub to '35353535-3535-4535-8535-353535353501';
set local role authenticated;
select throws_ok($$ select public.delete_user_data('35353535-3535-4535-8535-353535353502') $$,
  '42501', null, 'a signed-in client cannot delete anyone''s data with it, not even its own');
select throws_ok($$ select * from public.user_owned_columns() $$,
  '42501', null, 'clients cannot call user_owned_columns()');
reset role;
set local role anon;
select throws_ok($$ select public.delete_user_data('35353535-3535-4535-8535-353535353501') $$,
  '42501', null, 'anon cannot call delete_user_data()');
reset role;

-- ---------------------------------------------------------------- the function itself
set local role service_role;
create temporary table first_run as
  select public.delete_user_data('35353535-3535-4535-8535-353535353501') as res;
select ok((select (res ->> 'review_logs')::int = 1 and (res ->> 'push_subscriptions')::int = 1
                  and (res ->> 'profiles')::int = 1 from first_run),
  'delete_user_data() reports what it deleted per table');
select is(public.delete_user_data('35353535-3535-4535-8535-353535353501'), '{}'::jsonb,
  'a second call finds nothing (idempotent)');
reset role;

select is(pg_temp.rows_of('35353535-3535-4535-8535-353535353501'), 0::bigint,
  'no row of the deleted user survives in any user-scoped table');
select is_empty($$ select * from pg_temp.empty_tables('35353535-3535-4535-8535-353535353502') $$,
  'the other user keeps a row in every table');
select ok((select terms = (select count(*) from public.lexicon_terms)
                  and senses = (select count(*) from public.lexicon_senses)
                  and examples = (select count(*) from public.lexicon_examples)
                  and pair_notes = (select count(*) from public.lexicon_pair_notes)
                  and images = (select count(*) from public.lexicon_images) from lex_before),
  'the shared lexicon and its pictures are untouched');

-- ---------------------------------------------------------------- the auth cascade alone
-- The Admin API deletes the auth.users row; even without delete_user_data() first, the
-- foreign keys take every row with it.
delete from auth.users where id = '35353535-3535-4535-8535-353535353502';
select is(pg_temp.rows_of('35353535-3535-4535-8535-353535353502'), 0::bigint,
  'deleting the auth user cascades to every user-scoped table');
select is((select count(*) from auth.users where id in (
  '35353535-3535-4535-8535-353535353501', '35353535-3535-4535-8535-353535353502')), 1::bigint,
  'delete_user_data() itself never deletes the auth user (the Admin API does)');

select * from finish();
rollback;
