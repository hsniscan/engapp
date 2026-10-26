-- fetch-article's daily budget (20261101000200_article_usage.sql): atomic, per user, service
-- role only, purged after 90 days. The table has no column that could hold article text.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('44444444-4444-4444-8444-444444444441', 'a1@test.local', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444442', 'a2@test.local', 'authenticated', 'authenticated');

set local role service_role;
select is((public.article_consume('44444444-4444-4444-8444-444444444441', 2) ->> 'allowed')::boolean, true, 'fetch 1 allowed');
select is((public.article_consume('44444444-4444-4444-8444-444444444441', 2) ->> 'allowed')::boolean, true, 'fetch 2 allowed');
select is(public.article_consume('44444444-4444-4444-8444-444444444441', 2),
  '{"allowed": false, "used": 2, "limit": 2}'::jsonb, 'fetch 3 refused at the limit');
select is((public.article_consume('44444444-4444-4444-8444-444444444442', 2) ->> 'used')::int, 1,
  'budgets are per user');
select throws_ok($$ select public.article_consume(null, 2) $$, '22023', null, 'a user is required');

reset role;
insert into public.article_usage (user_id, day, calls) values
  ('44444444-4444-4444-8444-444444444442', current_date - 120, 3);
set local role service_role;
select is(public.purge_article_usage(90), 1, 'counters older than 90 days are purged');
select is((select count(*)::int from public.article_usage where user_id = '44444444-4444-4444-8444-444444444442'), 1,
  'today''s counter stays');

select is((select count(*)::int from information_schema.columns
  where table_schema = 'public' and table_name = 'article_usage'
    and column_name not in ('user_id', 'day', 'calls')), 0,
  'the counter table has no column that could hold an address or a text');

reset role;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444441","role":"authenticated"}';
set local request.jwt.claim.sub to '44444444-4444-4444-8444-444444444441';
set local role authenticated;
select throws_ok($$ select public.article_consume('44444444-4444-4444-8444-444444444441', 1000) $$,
  '42501', null, 'clients cannot use the article budget function');
select throws_ok($$ select * from public.article_usage $$,
  '42501', null, 'clients cannot read article_usage');

select * from finish();
rollback;
