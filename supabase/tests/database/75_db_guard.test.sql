-- Free-plan limits and the database guard (20261106000510_db_guard.sql) and the cheap cleanup
-- (20261106000520_db_cleanup.sql), decision 0075.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ---------------------------------------------------------------- limits
select is((select value from public.sync_limits where name = 'push_bytes_per_day'), 20971520::bigint, 'push bytes: 20 MB a day');
select is((select value from public.sync_limits where name = 'push_rows_per_day'), 50000::bigint, 'push rows: 50,000 a day');
select is((select value from public.sync_limits where name = 'text_bytes_per_user'), 5242880::bigint, 'texts: 5 MB per user');
select is((select value from public.sync_limits where name = 'texts_per_user'), 300::bigint, 'texts: 300 per user');
select is((select value from public.sync_limits where name = 'db_guard_bytes'), 440401920::bigint, 'the guard starts at 420 MB');

insert into auth.users (id, email, aud, role)
values ('75757575-7575-4575-8575-757575757502', 'g@test.local', 'authenticated', 'authenticated');

set local request.jwt.claims to '{"sub":"75757575-7575-4575-8575-757575757502","role":"authenticated"}';
set local request.jwt.claim.sub to '75757575-7575-4575-8575-757575757502';

create function pg_temp.text_row(p_id text, p_hlc text, p_kind text default 'paste', p_graded text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'kind', p_kind, 'title', 'T', 'body', 'A short text body.',
    'source_url', null, 'graded_id', p_graded, 'progress_offset', 0, 'read_ms', 0, 'finished_at', null,
    'feedback', null, 'created_at', 1761000000000, 'updated_at', 1761000000000, 'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.push(p_table text, p_payload jsonb) returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', p_table, 'op', 'upsert', 'payload', p_payload)))
$$;
create function pg_temp.log(p_id text, p_origin text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'card_id', '75750000-0000-7000-8000-0000000000c1', 'rating', 3,
    'reviewed_at', 1761000000000, 'duration_ms', 1000, 'device_id', 'devg', 'undo_of', null,
    'shown_sense_id', null, 'created_at', 1761000000000, 'origin', p_origin, 'hlc', '001761000000000:00001:devg')
$$;

-- ---------------------------------------------------------------- the guard
set local role service_role;
select is((public.db_guard_refresh() ->> 'active')::boolean, false, 'a small database: the guard is off');
reset role;
-- Pretend the database is past the limit (the size is cached; a lower limit does the same).
update public.sync_limits set value = 1 where name = 'db_guard_bytes';
select public.db_guard_refresh();
set local role authenticated;

select ok(public.db_guard_active(), 'past the limit the guard is on');
select is(pg_temp.push('user_texts', pg_temp.text_row('75750000-0000-7000-8000-0000000000a1', '001761000000000:00001:devg'))
    -> 'rejected' -> 0 ->> 'code', '53400', 'a new text is refused with 53400');
select ok(pg_temp.push('user_texts', pg_temp.text_row('75750000-0000-7000-8000-0000000000a1', '001761000000000:00001:devg'))
    -> 'rejected' -> 0 ->> 'message' like 'storage_full%', 'and a storage_full message');
select is(jsonb_array_length(pg_temp.push('review_logs', pg_temp.log('75750000-0000-7000-8000-0000000000b1', 'app')) -> 'acked'), 1,
  'an answer given in the app still syncs');
select is(pg_temp.push('review_logs', pg_temp.log('75750000-0000-7000-8000-0000000000b2', 'anki')) -> 'rejected' -> 0 ->> 'code',
  '53400', 'an imported Anki answer waits');
select is(jsonb_array_length(pg_temp.push('user_texts',
    pg_temp.text_row('75750000-0000-7000-8000-0000000000a2', '001761000000000:00001:devg', 'graded', 'g-1')) -> 'acked'), 1,
  'opening a library text still syncs (no body is stored)');

reset role;
set local role service_role;
select is((select status from public.ops_storage_health() where check_name = 'db_guard'), 'fail',
  'while the guard is on, the nightly check fails (and so e-mails the owner)');
reset role;
update public.sync_limits set value = 440401920 where name = 'db_guard_bytes';
select public.db_guard_refresh();
set local role authenticated;
select is(jsonb_array_length(pg_temp.push('user_texts', pg_temp.text_row('75750000-0000-7000-8000-0000000000a1', '001761000000000:00002:devg')) -> 'acked'), 1,
  'below the limit the text goes through');
select is(jsonb_array_length(pg_temp.push('user_texts',
    pg_temp.text_row('75750000-0000-7000-8000-0000000000a1', '001761000000000:00003:devg') - 'body' || '{"progress_offset": 5, "updated_at": 1761000001000}') -> 'acked'), 1,
  'a progress change never touches the guard');

-- ---------------------------------------------------------------- library texts by reference
select is((select body from public.user_texts where id = '75750000-0000-7000-8000-0000000000a2'), '',
  'the server keeps no copy of a library text');
select is((select graded_id from public.user_texts where id = '75750000-0000-7000-8000-0000000000a2'), 'g-1',
  'only the reference');

-- ---------------------------------------------------------------- health and cleanup
reset role;
set local role service_role;
select is((select status from public.ops_storage_health() where check_name = 'db_guard'), 'ok', 'db_guard is ok below the limit');
select ok((select detail from public.ops_storage_health() where check_name = 'top_tables') is not null, 'the largest tables are named');
reset role;

create temporary table lex as select public.lexicon_upsert('[
  {"lemma":"Pgguardlamp","lemma_norm":"pgguardlamp","term_type":"word","pos":"noun","gloss_en":"a light","gloss_key":"light","meaning_tr":"lamba","ipa":null,"model":"test"}
]'::jsonb) -> 0 ->> 'sense_id' as sense;
insert into public.lexicon_images (sense_id, variant, svg, alt_tr, status, checks, prompt_version, updated_at) values
  ((select sense::uuid from lex), 0, '<svg/>', 'lamba', 'approved',
   jsonb_build_object('vision', 'ok', 'attempt', 1, 'coverage', jsonb_build_object('light', 0.4, 'dark', 0.4),
     'contrast', jsonb_build_object('ok', true, 'detail', repeat('x', 500))), 'image-v2', now() - interval '40 days'),
  ((select sense::uuid from lex), 1, '<svg/>', 'lamba', 'rejected', '{}'::jsonb, 'image-v2', now() - interval '100 days');
select is((public.purge_image_checks(30, 90) ->> 'checks_trimmed')::int, 1, 'old picture diagnostics are trimmed');
select is((select checks from public.lexicon_images where sense_id = (select sense::uuid from lex) and variant = 0),
  '{"vision": "ok", "attempt": 1}'::jsonb, 'the scalar facts are kept');
select is((select svg from public.lexicon_images where sense_id = (select sense::uuid from lex) and variant = 1), '',
  'a picture rejected long ago drops its drawing');

select * from finish();
rollback;
