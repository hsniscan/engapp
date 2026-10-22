-- Picture recall cards (20261026000800_image_cards.sql): cards take card_type 'image' and
-- nothing else new; settings.image_cards syncs, null (an older client) means on, and a push
-- without the key keeps the user's choice.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public', 'settings', 'image_cards', 'settings.image_cards exists');
select col_is_null('public', 'settings', 'image_cards', 'settings.image_cards is nullable');

insert into auth.users (id, email, aud, role)
values ('a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', 'pc@test.local', 'authenticated', 'authenticated');

select lives_ok(
  $$ insert into public.cards (id, user_id, note_id, sense_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values (gen_random_uuid(), 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', gen_random_uuid(), gen_random_uuid(),
       'image', 0, 0, 0, 0, false, false, 1, 1, '001761000000000:00001:devp') $$,
  'a picture card is accepted');
select throws_ok(
  $$ insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state,
       suspended, unlocked, created_at, updated_at, hlc)
     values (gen_random_uuid(), 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', gen_random_uuid(),
       'picture', 0, 0, 0, 0, false, false, 1, 1, '001761000000000:00001:devp') $$,
  '23514', null, 'an unknown card type is still rejected');

set local request.jwt.claims to '{"sub":"a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8","role":"authenticated"}';
set local request.jwt.claim.sub to 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8';
set local role authenticated;

create function pg_temp.settings(p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'settings', 'daily_new_limit', 10, 'request_retention', 0.9, 'timezone', 'Europe/Istanbul',
    'day_start_hour', 4, 'theme', 'system', 'voice', 'en-US', 'level', 'B1', 'fsrs_params', null,
    'last_backup_at', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.push(p jsonb)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'settings', 'op', 'upsert', 'payload', p)))
$$;

select is(pg_temp.push(pg_temp.settings('001761000000000:00001:devp')) -> 'acked', '["settings"]'::jsonb,
  'an older client pushes settings without the key');
select ok((select image_cards is null from public.settings), 'missing means on (null)');

select pg_temp.push(pg_temp.settings('001761000000000:00002:devp') || '{"image_cards": false}'::jsonb);
select pg_temp.push(pg_temp.settings('001761000000000:00003:devp') || '{"daily_new_limit": 15}'::jsonb);
select is((select image_cards from public.settings), false, 'turned off, and kept by a push without the key');
select is(
  (select r -> 'row' -> 'image_cards' from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r
    where r ->> 'table' = 'settings'),
  'false'::jsonb, 'the choice comes back on pull');

select * from finish();
rollback;
