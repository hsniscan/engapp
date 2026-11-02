// @vitest-environment node
// Guards on the GitHub workflows (decision 0060, review S1/S8/S14): third-party actions are
// pinned by commit, the account-wide Supabase token and the R2 write keys reach only the
// steps that need them, the deploy backs up before it migrates, and no model id is written
// into a workflow.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = '.github/workflows';
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const read = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

/** The `- name:` of the step a line belongs to (or null outside steps). */
function stepNameAt(lines: string[], i: number): string | null {
  const indent = lines[i]!.search(/\S/);
  for (let j = i; j >= 0; j--) {
    const m = /^(\s*)- (?:name: (.+)|uses: |run: |if: )/.exec(lines[j]!);
    if (m && m[1]!.length < indent) return m[2]?.trim() ?? '(unnamed)';
    if (/^\S/.test(lines[j]!)) return null;
    if (/^ {2}[a-z-]+:\s*$/.test(lines[j]!) && j < i) return null; // job level
  }
  return null;
}

describe('workflows', () => {
  it('pin every third-party action to a commit SHA', () => {
    const loose: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = m[1]!;
        if (ref.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) loose.push(`${f}: ${ref}`);
      }
    }
    expect(loose).toEqual([]);
  });

  it('give SUPABASE_ACCESS_TOKEN only to the deploy job and the key / database lookup steps', () => {
    const allowedSteps = new Set([
      'Service key (the only step that may use the access token)',
      'Find the database',
    ]);
    const leaks: string[] = [];
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (!l.includes('secrets.SUPABASE_ACCESS_TOKEN')) return;
        if (f === 'deploy-supabase.yml') return;
        const step = stepNameAt(lines, i);
        if (!step || !allowedSteps.has(step)) leaks.push(`${f}:${i + 1} (${step ?? 'job/workflow env'})`);
      });
    }
    expect(leaks).toEqual([]);
  });

  it('never put R2 write keys in workflow- or job-level env', () => {
    const wide: string[] = [];
    for (const f of files) {
      read(f)
        .split('\n')
        .forEach((l, i) => {
          if (/secrets\.R2_(SECRET_ACCESS_KEY|ACCESS_KEY_ID|BACKUP_SECRET)/.test(l) && /^ {2,6}\S/.test(l))
            wide.push(`${f}:${i + 1}`);
        });
    }
    expect(wide).toEqual([]);
  });

  it('back up the database before applying migrations, and every night', () => {
    const deploy = read('deploy-supabase.yml');
    const backup = deploy.indexOf('name: Back up before migrating');
    const push = deploy.indexOf('supabase db push');
    expect(backup).toBeGreaterThan(0);
    expect(push).toBeGreaterThan(backup);
    expect(deploy).toContain('scripts/db-backup.sh pre-migration');
    const nightly = read('db-backup.yml');
    expect(nightly).toMatch(/cron: '\d+ \d+ \* \* \*'/);
    expect(nightly).toContain('scripts/db-backup.sh daily');
    expect(nightly).toContain('scripts/ops-health.sh');
  });

  it('name no AI model (the defaults live in model-defaults.ts)', () => {
    const named = files.filter((f) => /['"](gemini|claude)-[a-z0-9.-]+['"]/.test(read(f)));
    expect(named).toEqual([]);
  });
});
