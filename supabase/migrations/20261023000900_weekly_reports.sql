-- Engapp v0.3 İP7: weekly report and goals (docs/decisions/0027-weekly-report.md).
--
-- weekly_reports: one row per user and week ("Haftalık rapor"). The numbers are computed on the
-- device by fixed rules; `comment` is the ai-report function's 3–4 Turkish sentences (or null).
-- Insert-only like review_logs: a report is history and never changes. Idempotent per week:
-- the first row of a (user, week) is kept, a second device's row for the same week is skipped
-- without an error (so it never waits in that device's outbox), and the devices take the
-- stored one on their next pull.
--
-- settings.goals: {week_active_days?, month_new_terms?, week_minutes?} (nullable jsonb).
-- _sync_upsert keeps it when an older app version pushes settings without the key.
--
-- Both are study data of one account: the client never copies them to another account
-- (decision 0009), and nothing here is shared.

-- ---------------------------------------------------------------------------
-- weekly_reports
-- ---------------------------------------------------------------------------
-- Checks are loose on purpose (as on level_tests): a rejected row would wait in the outbox
-- forever.

create table public.weekly_reports (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Monday of the reported week, the user's local day (timezone + day_start_hour).
  week text not null check (week ~ '^\d{4}-\d{2}-\d{2}$'),
  -- {v, week, week_end, active_days, reviews, minutes, new_cards, new_learned, retention,
  --  groups_days, strongest, weakest, streak, goals, focus, focus_note_ids, focus_value}
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 16384),
  comment text check (comment is null or char_length(comment) between 1 and 2000),
  comment_model text check (comment_model is null or char_length(comment_model) <= 100),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 40),
  device_id text not null check (char_length(device_id) <= 100),
  created_at bigint not null check (created_at >= 0),
  hlc text not null check (public.is_hlc(hlc)),
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now()
);

create unique index weekly_reports_user_week on public.weekly_reports (user_id, week);
create index weekly_reports_user_seq on public.weekly_reports (user_id, server_seq);

create trigger stamp_sync_row before insert or update on public.weekly_reports
  for each row execute function public.tg_stamp_sync_row();

-- One report per user and week: a second one is skipped (the insert affects no row), the way
-- sync_push's ON CONFLICT (id) DO NOTHING skips a repeated row. Named to fire after
-- stamp_sync_row, whose per-user transaction lock makes this check safe against a
-- concurrent push of the same week.
create or replace function public.tg_weekly_reports_one_per_week()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.weekly_reports r where r.user_id = new.user_id and r.week = new.week
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_weekly_reports_one_per_week() from public, anon, authenticated;

create trigger weekly_reports_one_per_week before insert on public.weekly_reports
  for each row execute function public.tg_weekly_reports_one_per_week();

alter table public.weekly_reports enable row level security;
revoke all on table public.weekly_reports from anon, authenticated;
create policy "own rows: select" on public.weekly_reports for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.weekly_reports for insert to authenticated
  with check (user_id = (select auth.uid()));
-- INSERT + SELECT only: no update/delete policy and no grant.
grant select, insert on table public.weekly_reports to authenticated;

-- ---------------------------------------------------------------------------
-- settings.goals
-- ---------------------------------------------------------------------------

-- Nullable, no default: absent = no goals.
alter table public.settings
  add column goals jsonb check (goals is null or jsonb_typeof(goals) = 'object');

comment on column public.settings.goals is
  'Goals on the continuity panel: {week_active_days 1-7, month_new_terms, week_minutes}; null = none.';

-- ---------------------------------------------------------------------------
-- registry
-- ---------------------------------------------------------------------------

insert into public.sync_tables (name, insert_only, conflict_key) values
  ('weekly_reports', true, '(id)');
