-- Every table in the public schema has row level security enabled.
-- Run: supabase test db   (pgTAP)
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is_empty(
  $$ select table_name from public.tables_without_rls() $$,
  'no public table has RLS disabled'
);

select ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r') >= 12,
  'all Engapp tables exist'
);

-- anon (not signed in) can read nothing at all.
select is_empty(
  $$ select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' $$,
  'anon has no table privileges in public'
);

select * from finish();
rollback;
