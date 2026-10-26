-- The reminder's count follows the daily capacity (20261102000200_push_capped.sql, ADR 0055):
-- reviews above the capacity are capped as the app's catch-up caps them, learning steps never.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, aud, role) values
  ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'cap-a@test.local', 'authenticated', 'authenticated'),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', 'cap-b@test.local', 'authenticated', 'authenticated');

-- A: 300 reviews and 4 learning steps due; 25 recent answers of 12 s; no capacity set (20 min)
-- → capacity 20 · 60 / 12 = 100 reviews.
insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state, suspended, unlocked,
  created_at, updated_at, hlc)
select gen_random_uuid(), 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', gen_random_uuid(), 'recognition', 1000, 1, 5,
  case when g <= 4 then 1 else 2 end, false, true, 1, 1, '001761000000000:00001:deva'
from generate_series(1, 304) g;
insert into public.review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, created_at, hlc)
select gen_random_uuid(), 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', gen_random_uuid(), 3,
  (extract(epoch from now()) * 1000)::bigint - 3600000, 12000, 'deva', 1, '001761000000000:00002:deva'
from generate_series(1, 25);

-- B: the same 300 reviews, but few answers (10 s pace) and catch-up turned off: no cap.
insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state, suspended, unlocked,
  created_at, updated_at, hlc)
select gen_random_uuid(), 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', gen_random_uuid(), 'recognition', 1000, 1, 5,
  2, false, true, 1, 1, '001761000000000:00003:devb'
from generate_series(1, 300);
insert into public.settings (id, user_id, daily_new_limit, request_retention, timezone, day_start_hour, theme, voice,
  level, created_at, updated_at, hlc, catchup_auto)
values ('settings', 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', 10, 0.9, 'Europe/Istanbul', 4, 'system', 'en-US', 'B1',
  1, 1, '001761000000000:00004:devb', false);

set local role service_role;
select is(
  (select due from public.push_due_counts('[{"user_id":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","until":5000}]')),
  104, 'reviews above the capacity are capped (100), learning steps are added (4)');
select is(
  (select sec_per_card from public.push_due_counts('[{"user_id":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","until":5000}]')),
  12::double precision, 'the pace is still returned for the minutes');
select is(
  (select due from public.push_due_counts('[{"user_id":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","until":5000}]')),
  300, 'with catch-up turned off nothing is capped');
select is(
  (select due from public.push_due_counts('[{"user_id":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","until":500}]')),
  0, 'nothing due before the end of the day: 0');
reset role;

select * from finish();
rollback;
