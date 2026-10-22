-- Web Push (20261023000600_push.sql): subscriptions owned by auth.uid() and isolated per user,
-- only push-service endpoints, at most one reminder per user-day, the job's inputs (candidates
-- and due counts), and nothing callable by clients except subscribe / unsubscribe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

select has_column('public', 'settings', 'notify', 'settings.notify exists');
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select has_table('public', 'push_log', 'push_log exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.push_subscriptions'::regclass, 'public.push_log'::regclass, 'public.push_cron_config'::regclass)),
  'RLS is on for all push tables');
select ok(
  not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE')
  and not has_table_privilege('authenticated', 'public.push_log', 'INSERT')
  and not has_table_privilege('authenticated', 'public.push_cron_config', 'SELECT')
  and not has_table_privilege('anon', 'public.push_subscriptions', 'SELECT'),
  'clients write subscriptions only through the functions and never see the cron config');
select ok(
  not has_function_privilege('authenticated', 'public.push_candidates()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.push_due_counts(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.push_claim(uuid, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.push_check_cron_token(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.push_configure(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.push_cron_tick()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.push_subscribe(text, text, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.push_subscribe(text, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.push_candidates()', 'EXECUTE'),
  'the job functions are service_role only; subscribe is for signed-in users');

insert into auth.users (id, email, aud, role) values
  ('77777777-7777-4777-8777-777777777777', 'g@test.local', 'authenticated', 'authenticated'),
  ('88888888-8888-4888-8888-888888888888', 'h@test.local', 'authenticated', 'authenticated');

create function pg_temp.key65() returns text language sql as $$ select repeat('B', 87) $$;
create function pg_temp.key16() returns text language sql as $$ select repeat('A', 22) $$;

-- User G subscribes a phone.
set local request.jwt.claims to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local role authenticated;

select ok(public.push_subscribe('https://fcm.googleapis.com/fcm/send/phone-g', pg_temp.key65(), pg_temp.key16(), 'Android')
  is not null, 'a signed-in user subscribes a browser');
select is((select user_id from public.push_subscriptions), '77777777-7777-4777-8777-777777777777'::uuid,
  'the owner is the session user');
select throws_ok(
  $$ select public.push_subscribe('https://evil.example/collect', repeat('B', 87), repeat('A', 22)) $$,
  '22023', null, 'endpoints outside the push services are refused');
select throws_ok(
  $$ select public.push_subscribe('https://fcm.googleapis.com.evil.example/x', repeat('B', 87), repeat('A', 22)) $$,
  '22023', null, 'look-alike hosts are refused');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('88888888-8888-4888-8888-888888888888', 'https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('A', 22)) $$,
  '42501', null, 'no direct insert, not even for oneself');
select throws_ok($$ delete from public.push_log $$, '42501', null, 'the push log cannot be changed by clients');

-- User H cannot see G's subscription and cannot remove it.
set local request.jwt.claims to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
select is((select count(*)::integer from public.push_subscriptions), 0, 'another user sees no subscriptions');
select is(public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/phone-g'), false,
  'another user cannot unsubscribe it');
select ok(public.push_subscribe('https://web.push.apple.com/QH-iphone-h', pg_temp.key65(), pg_temp.key16()) is not null,
  'Apple endpoints are accepted');
select ok(public.push_subscribe('https://updates.push.services.mozilla.com/wpush/v2/laptop-h', pg_temp.key65(), pg_temp.key16()) is not null,
  'Mozilla endpoints are accepted');
select is((select count(*)::integer from public.push_subscriptions), 2, 'H sees only their own two');

-- H signs in on G's phone and turns reminders on: the endpoint moves to H.
select public.push_subscribe('https://fcm.googleapis.com/fcm/send/phone-g', pg_temp.key65(), pg_temp.key16());
select is((select count(*)::integer from public.push_subscriptions), 3, 'the browser now belongs to H');
select is(public.push_unsubscribe('https://updates.push.services.mozilla.com/wpush/v2/laptop-h'), true,
  'turning off removes the row');
select is((select count(*)::integer from public.push_subscriptions), 2, 'one row less');

reset role;
select is((select count(*)::integer from public.push_subscriptions where user_id = '77777777-7777-4777-8777-777777777777'),
  0, 'G no longer owns the moved endpoint');

-- Notifications on for H (settings row as the app syncs it).
insert into public.settings (id, user_id, daily_new_limit, request_retention, timezone, day_start_hour, theme, voice,
  level, created_at, updated_at, hlc, notify)
values ('settings', '88888888-8888-4888-8888-888888888888', 10, 0.9, 'Europe/Istanbul', 4, 'system', 'en-US', 'B1',
  1, 1, '001761000000000:00001:devh', '{"enabled": true, "mode": "auto", "hour": 20}');
insert into public.settings (id, user_id, daily_new_limit, request_retention, timezone, day_start_hour, theme, voice,
  level, created_at, updated_at, hlc, notify)
values ('settings', '77777777-7777-4777-8777-777777777777', 10, 0.9, 'Europe/Istanbul', 4, 'system', 'en-US', 'B1',
  1, 1, '001761000000000:00001:devg', '{"enabled": true, "mode": "fixed", "hour": 9}');
select throws_ok(
  $$ update public.settings set notify = '[1]' where user_id = '88888888-8888-4888-8888-888888888888' $$,
  '23514', null, 'notify must be a JSON object');

set local role service_role;
select is((select array_agg(user_id) from public.push_candidates()),
  array['88888888-8888-4888-8888-888888888888'::uuid],
  'candidates: notifications on and at least one subscription (G has none left)');
select is((select jsonb_array_length(subscriptions) from public.push_candidates()), 2, 'with all their subscriptions');
select is((select vacation from public.push_candidates()), null, 'no vacation column or value: null');
reset role;

-- Cards and logs for the due count: two reviews due today, one later, one new, one suspended.
insert into public.cards (id, user_id, note_id, card_type, due, stability, difficulty, state, suspended, unlocked,
  created_at, updated_at, hlc)
select gen_random_uuid(), '88888888-8888-4888-8888-888888888888', gen_random_uuid(), 'recognition', d, 1, 5, st, sus, true,
  1, 1, '001761000000000:00001:devh'
from (values (1000::bigint, 2::smallint, false), (2000, 3, false), (9000, 2, false), (0, 0, false), (1000, 2, true)) v(d, st, sus);
insert into public.review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, created_at, hlc)
values
  (gen_random_uuid(), '88888888-8888-4888-8888-888888888888', gen_random_uuid(), 3,
    (extract(epoch from now()) * 1000)::bigint - 3600000, 12000, 'devh', 1, '001761000000000:00002:devh'),
  (gen_random_uuid(), '88888888-8888-4888-8888-888888888888', gen_random_uuid(), 3,
    (extract(epoch from now()) * 1000)::bigint - 7200000, 18000, 'devh', 1, '001761000000000:00003:devh');

set local role service_role;
select is(
  (select due from public.push_due_counts('[{"user_id":"88888888-8888-4888-8888-888888888888","until":5000}]')),
  2, 'due count: live, unsuspended, studied cards due before the end of the day');
select is(
  (select sec_per_card from public.push_due_counts('[{"user_id":"88888888-8888-4888-8888-888888888888","until":5000}]')),
  15::double precision, 'seconds per card: median of recent answers');
select ok((select last_review_at from public.push_candidates()) > 0, 'the last review time is known');

-- At most one reminder per user-day.
select is(public.push_claim('88888888-8888-4888-8888-888888888888', '2026-10-23', 2), true, 'the first claim wins');
select is(public.push_claim('88888888-8888-4888-8888-888888888888', '2026-10-23', 2), false, 'a second claim the same day loses');
select is((select last_push_day from public.push_candidates()), '2026-10-23', 'the job sees the day as done');

-- Dead subscriptions go.
select is(public.push_remove_subscriptions(array(select id from public.push_subscriptions
  where endpoint like 'https://web.push.apple.com/%')), 1, 'a gone endpoint is removed');
reset role;

-- The job's token check, and the tick does nothing until the deploy sets the URL.
select is(public.push_check_cron_token((select token from public.push_cron_config)), true, 'the stored token is accepted');
select is(public.push_check_cron_token('guess'), false, 'any other token is refused');
select is(public.push_cron_tick(), 'not_configured', 'no function URL: the tick posts nothing');

select * from finish();
rollback;
