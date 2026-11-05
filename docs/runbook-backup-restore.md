# Runbook: backups, restore, limits, lexicon review

Decision 0060. Who: the owner (Hasan) or whoever helps him. Every command here runs on a
computer with `psql`, `gpg`, the AWS CLI and (for a full restore) the Supabase CLI and Docker.
Never paste the database URL, the passphrase or keys into an issue, a chat or a commit.

## 1. What is backed up, where, how long

| Copy | When | Kept | Key in R2 |
| --- | --- | --- | --- |
| daily | every night 02:45 UTC (`.github/workflows/db-backup.yml`) | last 14 | `backups/daily/<stamp>.tar.gz.gpg` |
| weekly | the Sunday daily copy, again | last 8 | `backups/weekly/…` |
| pre-migration | every deploy, right before `supabase db push` | last 10 | `backups/pre-migration/…` |

No copy older than 56 days is kept (the privacy policy says so; `MAX_AGE_DAYS` in
`scripts/db-backup.sh`). The bucket is `R2_BACKUP_BUCKET`, or the audio bucket when that secret
is missing. Every file is `tar.gz` encrypted with `gpg --symmetric --cipher-algo AES256` and the
passphrase in the secret `BACKUP_PASSPHRASE`. Inside:

- `roles.sql`, `schema.sql`, `data.sql`: `supabase db dump` (the officially supported restore);
- `public-auth.dump`: `pg_dump -Fc` of the `public` and `auth` schemas, to restore one table;
- `MANIFEST`: kind, time, git commit, number of accounts, sha256 of each file.

Cost: R2 is free up to 10 GB stored and 1 million writes a month. At most 32 copies are kept
(14 + 8 + 10); before each upload `scripts/db-backup.sh` adds up everything in the bucket and
refuses to upload past `R2_MAX_BYTES` (default 8 GB), so the owner never pays. A refused upload
fails the run and GitHub e-mails the owner.

Storage (`tts`, `images` buckets) is not in the dump: the audio and pictures are shared content
that the jobs can produce again.

## 2. Get and open a backup

```sh
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
R2="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
aws --endpoint-url "$R2" s3 ls s3://<bucket>/backups/daily/
aws --endpoint-url "$R2" s3 cp s3://<bucket>/backups/daily/<stamp>.tar.gz.gpg .

mkdir restore && gpg --decrypt <stamp>.tar.gz.gpg | tar -C restore -xzf -   # asks for the passphrase
cd restore && cat MANIFEST && sha256sum -c <(tail -n 4 MANIFEST)
```

## 3. Restore everything (lost or broken project)

Do it into a **new** Supabase project first; switch the app only when it looks right.

1. Create the project (same region, eu-west-1). Take its database URL
   (**Connect → Session pooler**), password included.
2. Restore in this order, in one transaction for the data:

   ```sh
   psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql  -d "$NEW_DB_URL"
   psql --single-transaction -v ON_ERROR_STOP=1 -f schema.sql -d "$NEW_DB_URL"
   psql -v ON_ERROR_STOP=1 -c 'SET session_replication_role = replica' -f data.sql -d "$NEW_DB_URL"
   ```

   (`session_replication_role = replica` keeps triggers such as the sync sequence and the
   quota checks from firing while the rows go back.)
3. **Always, right after the data** (decision 0075):

   ```sh
   psql -v ON_ERROR_STOP=1 -c 'select public.sync_after_restore();' -d "$NEW_DB_URL"
   ```

   It moves the sync sequence (and the dictionary, word bank and library sequences) a billion
   ahead and gives the database a new "restore epoch". Without it, devices would skip new rows
   for a while. If the function is missing (a backup from before v0.5.3), run
   `supabase db push` against the new project first, then this step.
4. Check: `select count(*) from auth.users;` equals `auth_users` in `MANIFEST`;
   `select epoch, restored_at from public.sync_epoch;` shows today's time.
5. Point the app at the new project: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Cloudflare
   Pages, Android build), the GitHub variables and secrets of `docs/setup-backend.md` step 4,
   Google sign-in redirect URLs (step 2/3), then run the Supabase workflow once (functions,
   secrets, push job).

What happens on the devices: on their next sync they see the new epoch, pull everything again
and **send back every row the backup is missing** — what they changed after the backup, and what
they had pulled from other devices since then. Nothing on a device is deleted. So nothing is
lost as long as one device that synced before the failure opens the app again (with v0.5.3 or
newer). What can be lost: changes made only on a device that was itself lost or wiped since the
backup. Restoring an older backup (weekly, pre-migration) works the same way; the devices send
back more.

Moving `supabase db push` back to an older migration is not possible: restoring the
pre-migration copy **is** the rollback of a bad migration.

## 4. Restore one table or one user's rows

Use the custom-format copy in a scratch database (local Docker is fine):

```sh
docker run -d --name pg -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:17
pg_restore -d "postgresql://postgres:x@localhost:5433/postgres" --no-owner --schema=public \
  -t notes -t senses -t cards public-auth.dump
```

Then copy the rows needed into production with `\copy (select …) to 'rows.csv'` and
`\copy public.<table> from 'rows.csv'` — for a single user always with a `where user_id = '…'`.
Pushed rows need a new `hlc` (newer than the device's) or devices will overwrite them; the
simplest way back for a user is often their own JSON backup (Profil → Ayarlar → Yedek ve veri).
Never update or delete `review_logs` rows (AGENTS.md); only insert missing ones.

## 5. When the nightly check fails

The **DB backup** run shows a table of `ops_health()`; a `fail` row turns it red:

| Check | Meaning | What to do |
| --- | --- | --- |
| `text_budget` 100 % / `text_budget_refusals` | the monthly Claude text budget is used up; AI falls back or refuses | raise `CLAUDE_TEXT_MONTHLY_USD` or wait for the month; look at `text_budget_user_caps` |
| `job_db-backup` | no good backup for 3 days | open the failed run; usually an expired key or a missing secret |
| `pg_cron` | a scheduled database job failed | `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` |
| `db_size` | above 350 MB (warning, e-mails too) or 450 MB (fail) of the Free plan's 500 MB | see "Database space" below |
| `db_guard` | above 420 MB: new texts and Anki imports wait on the devices; reviews keep syncing | see "Database space" below |
| `stale_text_holds` (warn) | budget holds the 15-minute job did not release | `select public.text_budget_maintain();` |

### Database space (stay on the Free plan)

1. Look at `top_tables` in the run's table (or `select * from public.ops_storage_health();`):
   which tables are large.
2. Free space that holds nothing a user needs:
   `select public.purge_image_checks(7, 30);` (old picture diagnostics and rejected drawings),
   `select public.purge_tombstones(7);` (deleted rows older than 7 days; devices offline longer
   than that do a full resync, which is safe),
   `delete from cron.job_run_details where end_time < now() - interval '1 day';`.
3. If one account grows fast, look it up:
   `select user_id, sum(bytes) from public.sync_usage where day > current_date - 7 group by 1 order by 2 desc limit 5;`
   and lower its limits for everyone (§6) if needed.
4. Postgres reuses freed space; the reported size goes down only after a `vacuum full` of the
   table, which locks it: run it at night on the large table only, e.g.
   `vacuum full public.lexicon_images;`.

## 6. Limits and quotas

Per-user sync and picture quotas (no deploy needed):

```sql
select * from public.sync_limits;
update public.sync_limits set value = 4000 where name = 'texts_per_user';
```

Names and Free-plan defaults (decision 0075): `push_calls_per_day` 5,000,
`push_rows_per_day` 50,000, `push_bytes_per_day` 20 MB, `texts_per_user` 300 (library texts
do not count), `text_bytes_per_user` 5 MB, `image_requests_per_day`, and `db_guard_bytes`
420 MB (above it new texts and Anki imports wait). A refused push answers SQLSTATE `53400`;
the row stays in the device's outbox, the app says in plain words that it waits, and it goes out
when the limit allows.

AI limits are GitHub variables (`AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_<FEATURE>`,
`AI_USER_MONTHLY_USD`, `AI_USER_MAX_SHARE`); re-run the Supabase workflow after a change.
Who hit them:

```sql
select feature, count(*) filter (where calls > 0) as users, max(calls) from public.ai_feature_usage
where day = current_date group by feature;
select user_id, spent_usd, reserved_usd from public.text_budget_users
where month = date_trunc('month', now())::date order by spent_usd desc limit 10;
```

## 7. Sözlük denetimi (lexicon review)

New single words that are in none of the reference lists are flagged (`needs_review`). Once a
week or so:

```sql
select t.id, t.lemma, t.created_at, s.meaning_tr, s.gloss_en
from public.lexicon_terms t join public.lexicon_senses s on s.term_id = t.id
where t.needs_review order by t.created_at desc limit 100;
```

- A real word: `update public.lexicon_terms set needs_review = false where id = '…';`
- A name, a private word or garbage: `delete from public.lexicon_terms where id = '…';`. The
  term's senses, examples and pictures go with it (foreign keys `on delete cascade`). Users'
  cards keep their own meaning text; their `lexicon_sense_id` then points at nothing, so the
  shared dictionary data simply no longer shows on those cards.
