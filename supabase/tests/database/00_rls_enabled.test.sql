-- Every table in the public schema has row level security enabled.
-- Run: supabase test db   (pgTAP)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is_empty(
  $$ select table_name from public.tables_without_rls() $$,
  'no public table has RLS disabled'
);

select ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r') >= 12,
  'all Engapp tables exist'
);

-- anon (not signed in) has no table privileges at all.
select is_empty(
  $$ select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' $$,
  'anon has no table privileges in public'
);

-- The only things a guest reads: some columns of the word bank (decision 0038) and of the
-- approved graded library texts (decision 0047). Both are system content, never user data.
select is_empty(
  $$ select table_name, column_name, privilege_type from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and not (table_name in ('word_bank', 'graded_texts') and privilege_type = 'SELECT') $$,
  'anon column privileges: SELECT on word_bank and graded_texts only'
);

select * from finish();
rollback;
