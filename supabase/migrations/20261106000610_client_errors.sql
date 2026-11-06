-- Engapp v0.5.3 (decision 0076, D4): errors that users hit reach us. Until now they stayed
-- in the device's own error log (Ayarlar → Gelişmiş), and nobody saw them.
--
-- client_errors: insert-only for signed-in users (the same consent as sync; guests send
-- nothing). The app sends its local error-log entries in small batches when it is online
-- (src/sync/errorReport.ts) after the text is scrubbed: no URLs, e-mail addresses, quoted
-- text or long numbers, only the message, a short context, the top stack frames as
-- file:line, the app version and the platform. The user id comes from the token, never from
-- the client. Caps: 20 rows per user per day, 5,000 rows a day in all; rows over a cap are
-- dropped silently, so a broken device cannot fill the free 500 MB database. Rows are
-- deleted after 30 days (pg_cron) and with the account (ON DELETE CASCADE).
--
-- Only the owner reads them, through the nightly health check (counts and the top messages,
-- 20261106000620) or the SQL editor.

create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  fingerprint text not null check (fingerprint ~ '^[0-9a-z]{1,16}$'),
  message text not null check (char_length(message) between 1 and 300),
  context text check (context is null or char_length(context) <= 120),
  stack text check (stack is null or char_length(stack) <= 600),
  app_version text check (app_version is null or app_version ~ '^[0-9A-Za-z.+_-]{1,32}$'),
  platform text check (platform is null or platform in ('web', 'pwa', 'android'))
);

create index client_errors_user_received on public.client_errors (user_id, received_at);
create index client_errors_received on public.client_errors (received_at);

alter table public.client_errors enable row level security;
revoke all on table public.client_errors from anon, authenticated;
-- Only these columns: the id, the user and the time are set by the server.
grant insert (occurred_at, fingerprint, message, context, stack, app_version, platform)
  on table public.client_errors to authenticated;
grant select, delete on table public.client_errors to service_role;

create policy client_errors_insert_own on public.client_errors
  for insert to authenticated
  with check (user_id = (select auth.uid()));
-- No select, update or delete policy: a client can never read a row back.

-- Caps and clean-up before every insert (SECURITY DEFINER: it counts rows the caller cannot
-- read). A row over a cap is dropped (no error), so the client's batch still succeeds.
create or replace function public.client_errors_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in to report errors' using errcode = '42501';
  end if;
  new.user_id := v_uid;
  new.received_at := now();
  if new.occurred_at is null or new.occurred_at > now() or new.occurred_at < now() - interval '30 days' then
    new.occurred_at := now();
  end if;
  new.message := left(regexp_replace(coalesce(new.message, ''), '\s+', ' ', 'g'), 300);
  if new.message = '' or new.message = ' ' then
    return null;
  end if;
  new.context := left(regexp_replace(new.context, '\s+', ' ', 'g'), 120);
  new.stack := left(new.stack, 600);
  if (select count(*) from public.client_errors
      where user_id = v_uid and received_at > now() - interval '1 day') >= 20 then
    return null;
  end if;
  if (select count(*) from public.client_errors where received_at > now() - interval '1 day') >= 5000 then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.client_errors_guard() from public, anon, authenticated;

create trigger client_errors_guard
  before insert on public.client_errors
  for each row execute function public.client_errors_guard();

-- Daily: rows older than 30 days (the privacy policy's promise).
create or replace function public.purge_client_errors(p_days integer default 30)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.client_errors where received_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_client_errors(integer) from public, anon, authenticated;
grant execute on function public.purge_client_errors(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('engapp-purge-client-errors', '35 3 * * *', 'select public.purge_client_errors(30)');
  else
    raise notice 'pg_cron is not available: run select public.purge_client_errors(30) daily';
  end if;
exception when others then
  raise notice 'could not schedule the client error purge (%)', sqlerrm;
end;
$$;
