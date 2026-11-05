-- Engapp v0.5.3 (decision 0075, review "sağlamlık" item 1): a restore from a backup must not
-- silently break sync.
--
-- A dump restores every sequence at its value from the night of the backup, while devices
-- keep cursors at the (higher) production values of the day of the failure. Without help:
--   - new writes get server_seq values devices have already passed, so they are never pulled;
--   - rows a device pushed after the backup were acked and left its outbox, so nothing would
--     ever push them again.
--
-- 1. sync_epoch: one row that names the database's "life". sync_after_restore() (run by the
--    restore runbook, docs/runbook-backup-restore.md §3) gives it a new value and moves every
--    sequence far ahead. Clients compare the epoch on every pull (sync_pull_v5) and, when it
--    changed, run a full resync that re-pushes every local row the server lacks or holds in an
--    older version (src/sync/engine.ts), so rows acked after the backup come back from every
--    device that still has them.
-- 2. sync_pull_v5 = sync_pull_v4 plus `epoch` and `seq_head` (the last value of sync_seq). A
--    device whose cursor is above seq_head knows the sequence went backwards (a restore whose
--    after-restore step was forgotten) and runs the same recovery.

create table public.sync_epoch (
  id boolean primary key default true check (id),
  -- 1 until the first restore; then the restore time in epoch ms (always a new value, even
  -- when an older backup is restored again).
  epoch bigint not null check (epoch > 0),
  restored_at timestamptz
);
insert into public.sync_epoch (id, epoch) values (true, 1);

alter table public.sync_epoch enable row level security;
revoke all on table public.sync_epoch from anon, authenticated;

comment on table public.sync_epoch is
  'Decision 0075: bumped by sync_after_restore() after a database restore; clients resync when it changes.';

-- The epoch and the head of sync_seq, for sync_pull_v5. SECURITY DEFINER: clients have no
-- grant on the table or the sequence.
create or replace function public._sync_epoch_info()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'epoch', coalesce((select e.epoch from public.sync_epoch e where e.id), 1),
    'seq_head', (select s.last_value from public.sync_seq s))
$$;

revoke all on function public._sync_epoch_info() from public, anon;
grant execute on function public._sync_epoch_info() to authenticated, service_role;

-- sync_pull_v4's page plus {epoch, seq_head}. Same arguments; the client tries v5 → v4 → v3 → v2.
create or replace function public.sync_pull_v5(
  p_since bigint, p_limit integer, p_from bigint, p_max_bytes integer default 1048576)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public.sync_pull_v4(p_since, p_limit, p_from, p_max_bytes) || public._sync_epoch_info()
$$;

revoke all on function public.sync_pull_v5(bigint, integer, bigint, integer) from public, anon;
grant execute on function public.sync_pull_v5(bigint, integer, bigint, integer) to authenticated;

-- Run once after restoring a backup (runbook §3), as the database owner:
--   select public.sync_after_restore();
-- Moves sync_seq and the shared-content sequences (lexicon, word bank, graded library) a
-- billion past their restored values, so every new write sorts after every cursor a device
-- may hold, and gives sync_epoch a new value, so every device re-pushes what the backup
-- missed. Safe to run twice (each run only moves things further ahead).
create or replace function public.sync_after_restore(p_gap bigint default 1000000000)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_gap bigint := greatest(coalesce(p_gap, 1000000000), 1000000);
  v_epoch bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_out jsonb := '{}'::jsonb;
  v_seq text;
  v_last bigint;
begin
  foreach v_seq in array array['sync_seq', 'lexicon_seq', 'word_bank_seq', 'graded_texts_seq'] loop
    if pg_catalog.to_regclass('public.' || v_seq) is null then
      continue;
    end if;
    execute format('select last_value from public.%I', v_seq) into v_last;
    perform pg_catalog.setval(('public.' || v_seq)::regclass, v_last + v_gap, true);
    v_out := v_out || jsonb_build_object(v_seq, v_last + v_gap);
  end loop;

  insert into public.sync_epoch as e (id, epoch, restored_at) values (true, v_epoch, now())
  on conflict (id) do update set epoch = greatest(excluded.epoch, e.epoch + 1), restored_at = now()
  returning e.epoch into v_epoch;

  return v_out || jsonb_build_object('epoch', v_epoch);
end;
$$;

revoke all on function public.sync_after_restore(bigint) from public, anon, authenticated;
grant execute on function public.sync_after_restore(bigint) to service_role;

comment on function public.sync_after_restore(bigint) is
  'Decision 0075: run once after a restore (runbook §3). Moves the sequences ahead and bumps sync_epoch.';
