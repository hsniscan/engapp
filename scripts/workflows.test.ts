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
    // The health check and the backup's dead man's switch run on their own (decision 0076).
    const health = read('ops-health.yml');
    expect(health).toContain('scripts/ops-health.sh');
    expect(health).toContain('scripts/backup-age.sh');
  });

  it('let pg_cron start every important scheduled workflow, once per slot (decision 0076)', () => {
    const sql = readFileSync('supabase/migrations/20261106000600_ops_dispatch.sql', 'utf8');
    const calls = [...sql.matchAll(/ops_dispatch\('([a-z0-9-]+\.yml)'(?:, '(\{[^']*\})')?\)/g)].map((m) => ({
      file: m[1]!,
      inputs: JSON.parse(m[2] ?? '{}') as Record<string, string>,
    }));
    const dispatched = new Set(calls.map((c) => c.file));
    expect([...dispatched].sort()).toEqual(['db-backup.yml', 'graded.yml', 'images.yml', 'level-jobs.yml', 'ops-health.yml']);
    for (const { file, inputs } of calls) {
      const wf = read(file);
      // The dispatch adds trigger=cron: the workflow must declare it, or GitHub answers 422.
      expect(wf, file).toMatch(/workflow_dispatch:\n {4}inputs:\n(?: {6}.*\n)*? {6}trigger:\n/);
      expect(wf, file).toContain('node scripts/ci-gate.ts');
      expect(wf, file).toMatch(/run-name: .*\[auto:/);
      expect(wf, file).toMatch(/schedule:\n/); // GitHub's schedule stays as the backstop
      for (const [k, v] of Object.entries(inputs)) {
        const options = new RegExp(`\\n {6}${k}:\\n(?: {8}.*\\n)*? {8}options: \\[([^\\]]*)\\]`).exec(wf);
        expect(options?.[1]?.split(/,\s*/), `${file} ${k}`).toContain(v);
      }
    }
    // Every job that pg_cron starts waits for the gate.
    for (const file of dispatched) {
      const first = /\njobs:\n {2}gate:\n[\s\S]*?\n {2}([a-z-]+):\n {4}needs: gate\n {4}if: needs\.gate\.outputs\.run == 'true'\n/.exec(read(file));
      expect(first, file).not.toBeNull();
    }
  });

  it('name no AI model (the defaults live in model-defaults.ts)', () => {
    const named = files.filter((f) => /['"](gemini|claude)-[a-z0-9.-]+['"]/.test(read(f)));
    expect(named).toEqual([]);
  });
});
