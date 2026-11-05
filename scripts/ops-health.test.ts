// scripts/ops-health.sh (decision 0075): a 350 MB database warning fails the nightly run (so
// GitHub e-mails the owner) like a 'fail' row; other warnings stay warnings.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Runs the script against a fake psql that answers the two health functions. */
function run(health: string, storage: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'ops-health-'));
  writeFileSync(join(dir, 'url'), 'postgresql://fake');
  writeFileSync(join(dir, 'health.tsv'), health);
  writeFileSync(join(dir, 'storage.tsv'), storage ?? '');
  const psql = join(dir, 'psql');
  writeFileSync(
    psql,
    `#!/usr/bin/env bash
case "$*" in
  *ops_storage_health*) ${storage === null ? 'echo "function does not exist" >&2; exit 1' : `cat "${dir}/storage.tsv"`} ;;
  *) cat "${dir}/health.tsv" ;;
esac
`,
  );
  chmodSync(psql, 0o755);
  const res = spawnSync('bash', [join(__dirname, 'ops-health.sh')], {
    env: { PATH: `${dir}:${process.env.PATH ?? ''}`, DB_URL_FILE: join(dir, 'url') },
    encoding: 'utf8',
  });
  return { code: res.status, out: res.stdout };
}

const row = (name: string, status: string, detail: string) => `${name}\t${status}\t${detail}\n`;

describe('ops-health.sh', () => {
  it('passes when every check is ok, and prints the storage checks too', () => {
    const r = run(row('db_size', 'ok', '132 MB'), row('db_guard', 'ok', '132 MB of 420 MB') + row('top_tables', 'info', 'review_logs 40 MB'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('db_guard');
    expect(r.out).toContain('top_tables');
  });

  it('a database size warning (350 MB) fails the run so the owner gets an e-mail', () => {
    const r = run(row('db_size', 'warn', '360 MB'), '');
    expect(r.code).toBe(1);
    expect(r.out).toContain('::error title=Health: db_size::360 MB');
  });

  it('other warnings stay warnings', () => {
    const r = run(row('db_size', 'ok', '132 MB') + row('stale_text_holds', 'warn', '2 holds'), '');
    expect(r.code).toBe(0);
    expect(r.out).toContain('::warning title=Health: stale_text_holds::2 holds');
  });

  it('the write guard fails the run', () => {
    expect(run(row('db_size', 'warn', '425 MB'), row('db_guard', 'fail', '425 MB of 420 MB')).code).toBe(1);
  });

  it('works against a backend without the storage check', () => {
    const r = run(row('db_size', 'ok', '132 MB'), null);
    expect(r.code).toBe(0);
    expect(r.out).toContain('db_size');
  });
});
