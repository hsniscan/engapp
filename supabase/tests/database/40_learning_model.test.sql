-- Learning model (20261028000100_learning_model.sql): cards.ramp_step / learned_at sync; an
-- older client's card (no keys) gets the defaults, a push without the keys keeps the stored
-- values, and malformed values are rejected.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_column('public', 'cards', 'ramp_step', 'cards.ramp_step exists');
select col_type_is('public', 'cards', 'ramp_step', 'smallint', 'cards.ramp_step is smallint');
select col_not_null('public', 'cards', 'ramp_step', 'cards.ramp_step is not null');
select has_column('public', 'cards', 'learned_at', 'cards.learned_at exists');
select col_is_null('public', 'cards', 'learned_at', 'cards.learned_at is nullable');

insert into auth.users (id, email, aud, role)
values ('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4', 'lm@test.local', 'authenticated', 'authenticated');
set local request.jwt.claims to '{"sub":"b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4","role":"authenticated"}';
set local request.jwt.claim.sub to 'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4';
set local role authenticated;

create function pg_temp.card(p_hlc text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'b4b4b4b4-0000-7000-8000-0000000000c1', 'note_id', 'b4b4b4b4-0000-7000-8000-0000000000a1',
    'sense_id', null, 'card_type', 'recognition', 'due', 1, 'stability', 20.5, 'difficulty', 5,
    'elapsed_days', 0, 'scheduled_days', 14, 'learning_steps', 0, 'reps', 5, 'lapses', 0, 'state', 2,
    'last_review', 1, 'suspended', false, 'unlocked', true, 'created_at', 1, 'updated_at', 1,
    'deleted_at', null, 'hlc', p_hlc)
$$;
create function pg_temp.push(p jsonb)
returns jsonb language sql as $$
  select public.sync_push(jsonb_build_array(jsonb_build_object('table', 'cards', 'op', 'upsert', 'payload', p)))
$$;

-- An older app version creates the card without the keys: 0 / null.
select is(pg_temp.push(pg_temp.card('001761000000000:00001:devl')) -> 'stale', '[]'::jsonb,
  'a card without the columns is pushed');
select ok((select ramp_step = 0 and learned_at is null from public.cards), 'missing means ramp_step 0, learned_at null');

-- A new client pushes the derived values; they come back on pull.
select pg_temp.push(pg_temp.card('001761000000000:00002:devl') || '{"ramp_step": 3, "learned_at": 1793000000000}'::jsonb);
select is(
  (select (r -> 'row' ->> 'ramp_step') || ' ' || (r -> 'row' ->> 'learned_at')
     from jsonb_array_elements(public.sync_pull_v3(0, 500, 0) -> 'rows') r where r ->> 'table' = 'cards'),
  '3 1793000000000', 'the values come back on pull');

-- Another device on an older version answers the card: the values are kept.
select pg_temp.push(pg_temp.card('001761000000000:00003:devl') || '{"reps": 6}'::jsonb);
select is((select ramp_step || ' ' || learned_at || ' ' || reps from public.cards), '3 1793000000000 6',
  'a push without the columns keeps them');

-- Malformed values are rejected.
select throws_ok($$update public.cards set ramp_step = -1$$, '23514', null, 'a negative ramp_step is rejected');
select throws_ok($$update public.cards set learned_at = -5$$, '23514', null, 'a negative learned_at is rejected');

select * from finish();
rollback;
