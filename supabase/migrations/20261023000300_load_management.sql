-- v0.3 İP3 load management (docs/decisions/0021-load-management.md).
--
-- Four synced settings; the forecast, catch-up and the new-card ramp are computed on the
-- device and never stored.
--
-- settings.daily_capacity_min  most minutes of study a day (null = 20)
-- settings.catchup_auto        catch-up switches itself on (null = true)
-- settings.vacation            {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, local days in the
--                              user's timezone (day starts at day_start_hour), both included;
--                              null = none. The push package skips users on vacation:
--                              public.on_vacation(vacation, <the user's local day>).
-- settings.vacation_history    earlier vacations (array of the same objects), so their days
--                              stay neutral for the streak on every device.
--
-- All nullable without a default: a device on an older app version inserts its settings row
-- without the keys (jsonb_populate_record gives null), and null means the default. A push that
-- leaves a key out keeps the stored value (_sync_upsert, 20261021001100_word_levels.sql), so an
-- older device changing its theme never clears a vacation. A newer client clears a vacation
-- with an explicit null.

create function public.is_vacation_range(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and coalesce(p ->> 'start', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and coalesce(p ->> 'end', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and (p ->> 'start') <= (p ->> 'end')
$$;

create function public.is_vacation_list(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 50
    and coalesce((select bool_and(public.is_vacation_range(e)) from jsonb_array_elements(p) as e), true)
  )
$$;

alter table public.settings
  add column daily_capacity_min integer check (daily_capacity_min between 1 and 600),
  add column catchup_auto boolean,
  add column vacation jsonb check (vacation is null or public.is_vacation_range(vacation)),
  add column vacation_history jsonb check (public.is_vacation_list(vacation_history));

comment on column public.settings.daily_capacity_min is
  'Most minutes of study a day the user wants (null = 20). Turned into cards on the device.';
comment on column public.settings.catchup_auto is
  'Catch-up mode switches itself on when the backlog exceeds capacity (null = true).';
comment on column public.settings.vacation is
  'Current or next vacation: {"start","end"} local day keys, both included (null = none).';
comment on column public.settings.vacation_history is
  'Earlier vacations (array of {"start","end"}), kept for the streak.';

-- Is `p_day` (the user's local day, from timezone and day_start_hour) inside the vacation?
-- For server jobs such as push-send: on_vacation(s.vacation, <local day of s>).
create function public.on_vacation(p_vacation jsonb, p_day date)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select coalesce(
    public.is_vacation_range(p_vacation)
      -- Day keys compare as text (zero-padded), so an odd key can never raise here.
      and to_char(p_day, 'YYYY-MM-DD') between (p_vacation ->> 'start') and (p_vacation ->> 'end'),
    false)
$$;

-- The user's current local day: the calendar date in their timezone, minus day_start_hour
-- (a review at 03:59 belongs to the day before, as on the device: src/domain/day.ts).
create function public.settings_local_day(p_timezone text, p_day_start_hour integer, p_at timestamptz default now())
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select ((p_at at time zone coalesce(nullif(p_timezone, ''), 'UTC'))
          - make_interval(hours => coalesce(p_day_start_hour, 4)))::date
$$;

grant execute on function public.is_vacation_range(jsonb) to authenticated, service_role;
grant execute on function public.is_vacation_list(jsonb) to authenticated, service_role;
grant execute on function public.on_vacation(jsonb, date) to authenticated, service_role;
grant execute on function public.settings_local_day(text, integer, timestamptz) to authenticated, service_role;
