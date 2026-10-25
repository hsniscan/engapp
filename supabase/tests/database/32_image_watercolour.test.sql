-- Watercolour pictures (20261026001400_image_watercolour.sql): an image-v2 picture in review or
-- approved replaces the sense's flat (image-v1) pictures; senses with only flat pictures are
-- queued again (nightly auto queue, the one-off requeue, a user's repeated request).
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('32323232-3232-4232-8232-323232323231', 'wc-user@test.local', 'authenticated', 'authenticated');

create temporary table lex as
select public.lexicon_upsert('[
  {"lemma":"pgwcapple","lemma_norm":"pgwcapple","term_type":"word","pos":"noun","gloss_en":"a round fruit","gloss_key":"round fruit","meaning_tr":"elma","ipa":null,"model":"test"},
  {"lemma":"pgwcflat","lemma_norm":"pgwcflat","term_type":"word","pos":"noun","gloss_en":"a thing with a flat picture","gloss_key":"flat thing","meaning_tr":"b","ipa":null,"model":"test"},
  {"lemma":"pgwcdone","lemma_norm":"pgwcdone","term_type":"word","pos":"noun","gloss_en":"a thing already in watercolour","gloss_key":"done thing","meaning_tr":"c","ipa":null,"model":"test"},
  {"lemma":"pgwcdeclined","lemma_norm":"pgwcdeclined","term_type":"word","pos":"noun","gloss_en":"a thing the model declined","gloss_key":"declined thing","meaning_tr":"d","ipa":null,"model":"test"},
  {"lemma":"pgwcgone","lemma_norm":"pgwcgone","term_type":"word","pos":"noun","gloss_en":"a thing that was not found","gloss_key":"gone thing","meaning_tr":"e","ipa":null,"model":"test"},
  {"lemma":"pgwcbusy","lemma_norm":"pgwcbusy","term_type":"word","pos":"noun","gloss_en":"a thing in a batch","gloss_key":"busy thing","meaning_tr":"f","ipa":null,"model":"test"}
]'::jsonb) as res;
create temporary table ids as
select (res -> 0 ->> 'sense_id')::uuid as apple, (res -> 1 ->> 'sense_id')::uuid as flat,
       (res -> 2 ->> 'sense_id')::uuid as done, (res -> 3 ->> 'sense_id')::uuid as declined,
       (res -> 4 ->> 'sense_id')::uuid as gone, (res -> 5 ->> 'sense_id')::uuid as busy
from lex;
grant select on ids to public;

update public.lexicon_senses set visualizability = 3, visual_scored_at = now()
where id in (select unnest(array[apple, flat, done, declined, gone, busy]) from ids);

-- Every sense is in the user's cards, so each has an auto priority.
insert into public.notes (id, user_id, term, term_norm, term_type, created_at, updated_at, hlc)
select ('32000000-0000-4000-8000-00000000000' || n)::uuid, '32323232-3232-4232-8232-323232323231', t, t, 'word', 1, 1,
  '001761000000000:00000:devw'
from (values (1, 'pgwcapple'), (2, 'pgwcflat'), (3, 'pgwcdone'), (4, 'pgwcdeclined'), (5, 'pgwcgone'), (6, 'pgwcbusy')) v (n, t);
insert into public.senses (id, user_id, note_id, sense_no, lexicon_sense_id, meaning_tr, created_at, updated_at, hlc)
select ('32000000-0000-4000-8000-00000000001' || n)::uuid, '32323232-3232-4232-8232-323232323231',
  ('32000000-0000-4000-8000-00000000000' || n)::uuid, 1, s, 'x', 1, 1, '001761000000000:00000:devw'
from ids, lateral (values (1, apple), (2, flat), (3, done), (4, declined), (5, gone), (6, busy)) v (n, s);

set local role service_role;

-- ---------------------------------------------------------------- image_insert
select public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>', 'alt_tr', 'a',
  'status', s, 'model', 'm', 'prompt_version', 'image-v1'))
from (values ('approved'), ('review'), ('checking'), ('rejected')) v (s);

select public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>', 'alt_tr', 'a',
  'status', 'rejected', 'model', 'm', 'prompt_version', 'image-v2'));
select is((select count(*)::int from public.lexicon_images where sense_id = (select apple from ids) and status <> 'rejected'), 3,
  'a rejected image-v2 attempt replaces nothing');
select public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>', 'alt_tr', 'a',
  'status', 'checking', 'model', 'm', 'prompt_version', 'image-v2'));
select is((select count(*)::int from public.lexicon_images where sense_id = (select apple from ids)
  and prompt_version = 'image-v1' and status <> 'rejected'), 3, 'nor does one still being checked');

select is(public.image_insert(jsonb_build_object('sense_id', (select apple from ids), 'svg', '<svg/>', 'alt_tr', 'a',
  'status', 'review', 'model', 'm', 'prompt_version', 'image-v2')) ->> 'status', 'review', 'an image-v2 picture in review');
select is((select count(*)::int from public.lexicon_images where sense_id = (select apple from ids)
  and prompt_version = 'image-v1' and status <> 'rejected'), 0, 'rejects every live flat picture of the sense');
select is((select count(*)::int from public.lexicon_images where sense_id = (select apple from ids)
  and checks @> '{"replaced_by": "image-v2"}'), 3, 'marked replaced_by image-v2');
select is((select checks from public.lexicon_images where sense_id = (select apple from ids)
  and prompt_version = 'image-v1' and variant = 3), '{}'::jsonb, 'an already rejected flat picture is left alone');
select is((select array_agg(status order by variant) from public.lexicon_images where sense_id = (select apple from ids)
  and prompt_version = 'image-v2'), array['rejected', 'checking', 'review'], 'image-v2 pictures are never replaced');

-- Pictures of the other senses: flat approved, image-v2 approved (which replaces nothing there).
select public.image_insert(jsonb_build_object('sense_id', (select flat from ids), 'svg', '<svg/>', 'alt_tr', 'b',
  'status', 'approved', 'model', 'm', 'prompt_version', 'image-v1'));
select public.image_insert(jsonb_build_object('sense_id', (select done from ids), 'svg', '<svg/>', 'alt_tr', 'c',
  'status', 'approved', 'model', 'm', 'prompt_version', 'image-v1'));
select public.image_insert(jsonb_build_object('sense_id', (select done from ids), 'svg', '<svg/>', 'alt_tr', 'c',
  'status', 'approved', 'model', 'm', 'prompt_version', 'image-v2'));
select is((select status from public.lexicon_images where sense_id = (select done from ids) and variant = 0), 'rejected',
  'an approved image-v2 picture replaces too');
select is((select status from public.lexicon_images where sense_id = (select flat from ids)), 'approved',
  'other senses are not touched');

-- ---------------------------------------------------------------- image_queue_auto
select public.image_queue_auto(1, 100);
select is((select state from public.image_requests where sense_id = (select flat from ids)), 'queued',
  'a sense with only a flat picture is queued again');
select is((select count(*)::int from public.image_requests where sense_id in (select unnest(array[apple, done]) from ids)), 0,
  'senses with a live image-v2 picture are not');

-- ---------------------------------------------------------------- one-off requeue
delete from public.image_requests where sense_id in (select unnest(array[flat, done, declined, gone, busy]) from ids);
insert into public.image_requests (sense_id, source, priority, state, attempt, problem, batch_id, hold_id, last_error)
select flat, 'auto', 1001, 'done', 2, 'clutter', 'b1', gen_random_uuid(), 'rejected: clutter' from ids
union all select done, 'auto', 1001, 'done', 1, null, null, null, null from ids
union all select declined, 'auto', 1001, 'skipped', 1, null, null, null, 'declined' from ids
union all select gone, 'auto', 1001, 'skipped', 1, null, null, null, 'sense not found' from ids
union all select busy, 'auto', 1001, 'submitted', 1, null, 'b2', null, null from ids;

select ok(public.image_requeue_watercolour() >= 2, 'the one-off requeue runs');
select is((select state || ':' || attempt || ':' || coalesce(problem, '-') || ':' || coalesce(batch_id, '-') || ':'
  || coalesce(hold_id::text, '-') || ':' || coalesce(last_error, '-')
  from public.image_requests where sense_id = (select flat from ids)), 'queued:1:-:-:-:-',
  'a finished flat-only sense is queued afresh');
select is((select state from public.image_requests where sense_id = (select declined from ids)), 'queued',
  'a declined sense is drawn again');
select is((select state from public.image_requests where sense_id = (select done from ids)), 'done',
  'a sense with a live image-v2 picture stays done');
select is((select state from public.image_requests where sense_id = (select gone from ids)), 'skipped',
  'a sense that was not found stays skipped');
select is((select state || ':' || batch_id from public.image_requests where sense_id = (select busy from ids)), 'submitted:b2',
  'a submitted request is not touched');

-- ---------------------------------------------------------------- image_request (user)
update public.image_requests set state = 'done' where sense_id = (select flat from ids);
update public.image_requests set state = 'skipped', last_error = 'declined' where sense_id = (select declined from ids);
insert into public.image_request_users (sense_id, user_id)
select s, '32323232-3232-4232-8232-323232323231' from ids, unnest(array[flat, declined]) s;

reset role;
set local request.jwt.claims to '{"sub":"32323232-3232-4232-8232-323232323231","role":"authenticated"}';
set local request.jwt.claim.sub to '32323232-3232-4232-8232-323232323231';
set local role authenticated;
select is(public.image_request((select flat from ids)) ->> 'state', 'queued',
  'asking again for a flat-only sense queues a watercolour drawing');
select is(public.image_request((select done from ids)) ->> 'state', 'queued',
  'a first request still queues a finished sense');
select is(public.image_request((select declined from ids)) ->> 'state', 'skipped',
  'asking again for a declined sense still needs a new requester');

select * from finish();
rollback;
