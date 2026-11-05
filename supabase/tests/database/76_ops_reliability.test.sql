-- Reliability (decision 0076): pg_cron starts the GitHub jobs (ops_dispatch, 20261106000600),
-- users' errors reach client_errors with caps (20261106000610), and the nightly health check
-- adds the backup dead man's switch and the error counts (20261106000620).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------- dispatch
select is(public.ops_dispatch('db-backup.yml'), 'no_token', 'without a token nothing is sent');
select is((select outcome from public.ops_dispatch_log order by id desc limit 1), 'no_token',
  'the missing token is logged');
select throws_ok($$ select public.ops_dispatch('../evil.yml') $$, '22023', null,
  'only plain workflow file names are dispatched');
select throws_ok($$ select public.ops_dispatch_set_token('not-a-token') $$, '22023', null,
  'only GitHub tokens are stored');
select ok(public.ops_dispatch_set_token('github_pat_' || repeat('A', 40)) in ('created', 'no_vault'),
  'the token goes to Vault');
select ok(public.ops_github_token() is null or public.ops_github_token() like 'github_pat_A%',
  'the token is read back from Vault');
select ok(public.ops_dispatch_set_token('github_pat_' || repeat('B', 40)) in ('updated', 'no_vault'),
  'a new token replaces the old one');
select ok(
  (select count(*) from pg_catalog.pg_extension where extname = 'pg_cron') = 0
  or (select count(*) from cron.job where jobname like 'engapp-gh-%') = 6,
  'pg_cron starts six GitHub jobs');

set local role service_role;
select throws_ok($$ select public.ops_dispatch('db-backup.yml') $$, '42501', null,
  'service_role cannot dispatch');
select throws_ok($$ select public.ops_github_token() $$, '42501', null,
  'service_role cannot read the token');
select throws_ok($$ select * from public.ops_dispatch_log $$, '42501', null,
  'service_role cannot read the dispatch log');
reset role;

-- ---------------------------------------------------------------- client_errors
insert into auth.users (id, email, aud, role) values
  ('76767676-7676-4767-8767-767676767601', 'err1@test.local', 'authenticated', 'authenticated'),
  ('76767676-7676-4767-8767-767676767602', 'err2@test.local', 'authenticated', 'authenticated');

set local role anon;
select throws_ok($$ insert into public.client_errors (fingerprint, message) values ('abc', 'x') $$,
  '42501', null, 'guests cannot send errors');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"76767676-7676-4767-8767-767676767601","role":"authenticated"}';
set local request.jwt.claim.sub to '76767676-7676-4767-8767-767676767601';
select throws_ok($$ insert into public.client_errors (user_id, fingerprint, message)
  values ('76767676-7676-4767-8767-767676767602', 'abc', 'x') $$,
  '42501', null, 'the client cannot choose the user id');
select throws_ok($$ insert into public.client_errors (fingerprint, message, platform) values ('abc', 'x', 'ios') $$,
  '23514', null, 'unknown platforms are refused');
select lives_ok($$
  insert into public.client_errors (occurred_at, fingerprint, message, context, stack, app_version, platform)
  select now() + interval '1 day', 'fp' || (g % 3), repeat('m', 400) || E'\n\tend', 'sync.run', 'index-abc.js:1:2',
    '0.5.3', 'pwa'
  from generate_series(1, 25) g
$$, 'a signed-in user sends a batch');
select throws_ok($$ select count(*) from public.client_errors $$, '42501', null,
  'clients cannot read errors back');
reset role;

select is((select count(*)::int from public.client_errors where user_id = '76767676-7676-4767-8767-767676767601'), 20,
  'at most 20 rows per user and day are kept');
select is((select max(char_length(message)) from public.client_errors), 300, 'messages are cut at 300 characters');
select ok((select bool_and(occurred_at <= now() and message !~ '[\n\t]') from public.client_errors),
  'future times are clamped and whitespace is flattened');

set local role service_role;
select is((select status from public.ops_health_reliability() where check_name = 'client_errors_24h'), 'info',
  'the health check counts the errors');
select ok((select detail from public.ops_health_reliability() where check_name = 'client_errors_24h') !~ 'mmmm',
  'the health check prints labels and fingerprints, never the message');

-- ---------------------------------------------------------------- health rows
select public.job_heartbeat('db-backup', 'ok', '{}'::jsonb);
select is((select status from public.ops_health_reliability() where check_name = 'backup_age'), 'ok',
  'a fresh backup is ok');
reset role;
update public.job_runs set last_ok_at = now() - interval '27 hours' where job = 'db-backup';
set local role service_role;
select is((select status from public.ops_health_reliability() where check_name = 'backup_age'), 'fail',
  'no good backup for more than 26 hours fails the run (dead man''s switch)');
select public.ops_event('fn_error', '{"fn": "tts", "code": "ai_failed"}');
select public.ops_event('ai_fallback', '{"fn": "ai-extract"}');
select ok((select detail from public.ops_health_reliability() where check_name = 'fn_errors_24h') like '%tts ai_failed%',
  'edge-function failures are counted by function and code');
reset role;

select * from finish();
rollback;
