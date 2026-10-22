-- Bulk picture priority (20261026001010_image_priority.sql, decision 0037): cards first (the
-- owner's before others'), then the owner's level ±1 by frequency, then the rest of the top
-- 5,000 lemmas; only visualizability >= 2; never above redraws or user requests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- The formula (same numbers as supabase/functions/_shared/image-priority.test.ts).
select is(public.image_auto_priority(true, 2, false, null, false), 2002, 'admin cards: 2000 + users');
select is(public.image_auto_priority(false, 3, true, 5.0, true), 1003, 'anyone''s cards: 1000 + users');
select is(public.image_auto_priority(false, 0, true, 5.04, true), 550, 'owner band: 500 + zipf × 10');
select is(public.image_auto_priority(false, 0, false, 6.26, true), 163, 'top lemmas: 100 + zipf × 10');
select is(public.image_auto_priority(false, 0, false, null, true), 100, 'top without a zipf (no frequency data)');
select is(public.image_auto_priority(false, 0, false, 2.0, false), null, 'anything else is not auto-queued');

insert into auth.users (id, email, aud, role) values
  ('31313131-3131-4131-8131-313131313131', 'prio-admin@test.local', 'authenticated', 'authenticated'),
  ('31313131-3131-4131-8131-313131313132', 'prio-user@test.local', 'authenticated', 'authenticated');
insert into public.app_admins (user_id) values ('31313131-3131-4131-8131-313131313131');
insert into public.settings (id, user_id, daily_new_limit, request_retention, timezone, day_start_hour, theme, voice,
  level, created_at, updated_at, hlc)
values ('settings', '31313131-3131-4131-8131-313131313131', 10, 0.9, 'Europe/Istanbul', 4, 'system', 'en-US', 'B1',
  1, 1, '001761000000000:00001:devp');

-- Frequencies: two made-up lemmas among the most frequent; the others are not in the data.
insert into public.ref_word_freq (lemma_norm, zipf) values ('pgpriofrequent', 8.0), ('pgprioband', 5.0)
on conflict (lemma_norm) do update set zipf = excluded.zipf;

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"pgprioadmin","lemma_norm":"pgprioadmin","term_type":"word","pos":"noun","gloss_en":"a thing the owner has","gloss_key":"owner thing","meaning_tr":"a","ipa":null,"model":"test"},
  {"lemma":"pgpriouser","lemma_norm":"pgpriouser","term_type":"word","pos":"noun","gloss_en":"a thing a user has","gloss_key":"user thing","meaning_tr":"b","ipa":null,"model":"test"},
  {"lemma":"pgprioband","lemma_norm":"pgprioband","term_type":"word","pos":"noun","gloss_en":"a thing at the owner level","gloss_key":"level thing","meaning_tr":"c","ipa":null,"model":"test"},
  {"lemma":"pgpriofrequent","lemma_norm":"pgpriofrequent","term_type":"word","pos":"noun","gloss_en":"a frequent hard thing","gloss_key":"frequent thing","meaning_tr":"d","ipa":null,"model":"test"},
  {"lemma":"pgpriorare","lemma_norm":"pgpriorare","term_type":"word","pos":"noun","gloss_en":"a rare hard thing","gloss_key":"rare thing","meaning_tr":"e","ipa":null,"model":"test"},
  {"lemma":"pgprioabstract","lemma_norm":"pgprioabstract","term_type":"word","pos":"noun","gloss_en":"an abstract idea","gloss_key":"abstract idea","meaning_tr":"f","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as
select (res -> 0 ->> 'sense_id')::uuid as admin_s, (res -> 1 ->> 'sense_id')::uuid as user_s,
       (res -> 2 ->> 'sense_id')::uuid as band_s, (res -> 3 ->> 'sense_id')::uuid as freq_s,
       (res -> 4 ->> 'sense_id')::uuid as rare_s, (res -> 5 ->> 'sense_id')::uuid as abstract_s
from lex;

update public.lexicon_senses set visualizability = 3, visual_scored_at = now()
where id in (select unnest(array[admin_s, user_s, band_s, freq_s, rare_s]) from ids);
update public.lexicon_senses set visualizability = 1, visual_scored_at = now() where id = (select abstract_s from ids);
update public.lexicon_senses set cefr = 'B2', cefr_source = 'ai' where id = (select band_s from ids);
update public.lexicon_senses set cefr = 'C2', cefr_source = 'ai' where id in (select unnest(array[freq_s, rare_s]) from ids);

insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc) values
  ('31000000-0000-4000-8000-000000000001', '31313131-3131-4131-8131-313131313131', 'pgprioadmin', 'pgprioadmin', 'word', 1, 1, '001761000000000:00000:devp'),
  ('31000000-0000-4000-8000-000000000002', '31313131-3131-4131-8131-313131313132', 'pgpriouser', 'pgpriouser', 'word', 1, 1, '001761000000000:00000:devq'),
  ('31000000-0000-4000-8000-000000000003', '31313131-3131-4131-8131-313131313131', 'pgprioabstract', 'pgprioabstract', 'word', 1, 1, '001761000000000:00000:devp');
insert into public.senses (id, user_id, note_id, sense_no, lexicon_sense_id, meaning_tr, created_at, updated_at, hlc)
select '31000000-0000-4000-8000-000000000011'::uuid, '31313131-3131-4131-8131-313131313131'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 1, admin_s, 'a', 1, 1, '001761000000000:00000:devp' from ids
union all
select '31000000-0000-4000-8000-000000000012'::uuid, '31313131-3131-4131-8131-313131313132'::uuid, '31000000-0000-4000-8000-000000000002'::uuid, 1, user_s, 'b', 1, 1, '001761000000000:00000:devq' from ids
union all
select '31000000-0000-4000-8000-000000000013'::uuid, '31313131-3131-4131-8131-313131313131'::uuid, '31000000-0000-4000-8000-000000000003'::uuid, 1, abstract_s, 'f', 1, 1, '001761000000000:00000:devp' from ids;

grant select on ids to public;
set local role service_role;

select is((select priority from public.image_sense_priorities() where sense_id = (select admin_s from ids)), 2001, 'owner''s card first');
select is((select priority from public.image_sense_priorities() where sense_id = (select user_s from ids)), 1001, 'another user''s card next');
select is((select priority from public.image_sense_priorities() where sense_id = (select band_s from ids)), 550, 'B2 is within B1 ±1');
select is((select priority from public.image_sense_priorities() where sense_id = (select freq_s from ids)), 180,
  'C2 but among the most frequent lemmas');
select is((select priority from public.image_sense_priorities() where sense_id = (select rare_s from ids)), null,
  'C2 and rare: not auto-queued');

-- A redraw (4000) of another sense is not re-ranked.
insert into public.image_requests (sense_id, source, priority, state) select band_s, 'auto', 4000, 'queued' from ids;
select ok(public.image_queue_auto(2, 100) >= 2, 'new senses queued');
select is((select priority from public.image_requests where sense_id = (select admin_s from ids)), 2001, 'queued with its priority');
select is((select count(*)::int from public.image_requests where sense_id in (select unnest(array[rare_s, abstract_s]) from ids)), 0,
  'rare and abstract senses are not queued');
select is((select priority from public.image_requests where sense_id = (select band_s from ids)), 4000, 'a redraw keeps its priority');

-- A queued sense that enters the owner's cards moves up at the next run.
reset role;
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc) values
  ('31000000-0000-4000-8000-000000000004', '31313131-3131-4131-8131-313131313131', 'pgpriofrequent', 'pgpriofrequent', 'word', 1, 1, '001761000000000:00000:devp');
insert into public.senses (id, user_id, note_id, sense_no, lexicon_sense_id, meaning_tr, created_at, updated_at, hlc)
select '31000000-0000-4000-8000-000000000014'::uuid, '31313131-3131-4131-8131-313131313131'::uuid, '31000000-0000-4000-8000-000000000004'::uuid, 1, freq_s, 'd', 1, 1, '001761000000000:00000:devp' from ids;
set local role service_role;
select public.image_queue_auto(2, 100);
select is((select priority from public.image_requests where sense_id = (select freq_s from ids)), 2001, 're-ranked into the owner tier');

select * from finish();
rollback;
