-- v0.3 İP1 Anki import (docs/decisions/0019-anki-import.md).
--
-- 1. review_logs.origin: where an answer was given. 'app' (default) or 'anki' (imported from
--    an Anki revlog row). Logs stay insert-only; the column only labels them, e.g. so the
--    FSRS optimizer (İP4) and the statistics can tell imported history apart.
--    The insert-only push path inserts `select * from jsonb_populate_record(...)`, so a log
--    pushed by an older app version (no `origin` key) arrives as an explicit null: a BEFORE
--    INSERT trigger turns that into 'app' instead of rejecting the row (a rejected log would
--    wait in the outbox forever).
-- 2. sources.kind may be 'anki' (the imported package's metadata: title and file name only).
--
-- No new table, so the sync registry is unchanged.

alter table public.review_logs
  add column origin text not null default 'app' check (origin in ('app', 'anki'));

comment on column public.review_logs.origin is
  'Where the answer was given: app (default) or anki (imported from an Anki revlog).';

create or replace function public.review_logs_origin_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.origin := coalesce(new.origin, 'app');
  return new;
end;
$$;

create trigger review_logs_origin_default
  before insert on public.review_logs
  for each row execute function public.review_logs_origin_default();

alter table public.sources drop constraint if exists sources_kind_check;
alter table public.sources
  add constraint sources_kind_check check (kind in ('text', 'pdf', 'anki'));
