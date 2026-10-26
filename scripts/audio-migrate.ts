/**
 * One-time copy of the pronunciation audio from the Supabase `tts` bucket to Cloudflare R2
 * (decision 0053), run by .github/workflows/audio-migrate.yml. Logic and tests:
 * scripts/lib/audio-r2.ts.
 *
 *   node scripts/audio-migrate.ts plan
 *       Lists both buckets and reports how many files Supabase has, how many R2 already
 *       holds, and what is left to copy (files and MB). Writes nothing.
 *   node scripts/audio-migrate.ts copy [--max 1000000] [--minutes 330] [--concurrency 8]
 *       Copies what R2 lacks. Idempotent and resumable: a later run skips every file that is
 *       already there with the same size. Never deletes anything.
 *   node scripts/audio-migrate.ts verify [--sample 20]
 *       Fetches a sample through the public AUDIO_BASE_URL with the app's Origin and checks
 *       status, size, type and CORS; reports what is still missing.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET; for verify also AUDIO_BASE_URL and APP_ORIGIN. Secrets are
 * read from the environment only and never printed; logs are JSON lines on stdout.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { R2Client, r2ConfigFromEnv } from '../supabase/functions/_shared/r2.ts';
import { parseAudioBaseUrl, TTS_VOICES } from '../supabase/functions/_shared/tts-contract.ts';
import {
  listR2Audio,
  MB,
  planCopy,
  runCopy,
  samplePaths,
  uploadAudioToR2,
  verifyPublic,
} from './lib/audio-r2.ts';
import { SupabasePregenStore } from './lib/tts-pregen-store.ts';
import type { Log } from './lib/tts-pregen.ts';

const log: Log = (msg, data = {}) => {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...data }));
};

/** A line in the GitHub job summary (when there is one). */
function summary(line: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, `${line}\n`);
}

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

function int(s: string, name: string, min: number, max: number): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`--${name} must be ${min}..${max}`);
  return n;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      max: { type: 'string', default: '1000000' },
      minutes: { type: 'string', default: '330' },
      concurrency: { type: 'string', default: '8' },
      sample: { type: 'string', default: '20' },
    },
  });
  const job = positionals[0];
  if (job !== 'plan' && job !== 'copy' && job !== 'verify') {
    console.error('usage: node scripts/audio-migrate.ts <plan|copy|verify> [options]');
    process.exitCode = 2;
    return;
  }
  const r2Config = r2ConfigFromEnv((k) => process.env[k]);
  if (!r2Config) {
    throw new Error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET must all be set',
    );
  }
  const r2 = new R2Client(r2Config, { timeoutMs: 60_000 });
  const supa = new SupabasePregenStore(
    createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );

  const source = await supa.listBucket(TTS_VOICES);
  const target = await listR2Audio(r2, TTS_VOICES);
  const max = int(values.max, 'max', 1, 10_000_000);
  const plan = planCopy(source, target, max);
  const report = {
    supabaseFiles: source.paths.size,
    supabaseMB: MB(source.bytes.mp3 + source.bytes.wav),
    r2Files: target.paths.size,
    r2MB: MB(target.bytes.mp3 + target.bytes.wav),
    alreadyInR2: plan.present,
    differentSize: plan.mismatched,
    toCopy: plan.jobs.length,
    toCopyMB: MB(plan.bytes),
  };
  log('audio plan', report);
  summary(`### Audio copy: ${job}`);
  summary(
    `Supabase: **${report.supabaseFiles}** files (${report.supabaseMB} MB) · R2: **${report.r2Files}** files (${report.r2MB} MB) · already copied: **${report.alreadyInR2}** · left to copy: **${report.toCopy}** (${report.toCopyMB} MB)`,
  );

  if (job === 'plan') return;

  if (job === 'copy') {
    if (plan.jobs.length === 0) {
      log('audio copy', { msg: 'nothing to copy' });
      summary('Nothing to copy: every file is already in R2.');
      return;
    }
    const minutes = int(values.minutes, 'minutes', 1, 24 * 60);
    const result = await runCopy(
      plan.jobs,
      {
        download: (p) => supa.download(p),
        upload: (p, b) => uploadAudioToR2(r2, p, b),
        log,
      },
      {
        concurrency: int(values.concurrency, 'concurrency', 1, 32),
        deadline: Date.now() + minutes * 60_000,
      },
    );
    log('audio copy finished', { ...result, MB: MB(result.bytes) });
    summary(
      `Copied **${result.copied}** files (${MB(result.bytes)} MB), failed **${result.failed}**, not attempted **${result.left}** (${result.stopped}).`,
    );
    if (result.stopped === 'failures') {
      console.log('::error::Stopped after repeated failures (see the log above)');
      process.exitCode = 1;
    } else if (result.failed > 0 || result.left > 0) {
      console.log(
        `::warning::${result.failed} failed and ${result.left} not attempted: run the workflow again to continue`,
      );
    } else {
      console.log(`::notice::Copied ${result.copied} files to R2`);
    }
    return;
  }

  // verify
  const baseUrl = parseAudioBaseUrl(process.env.AUDIO_BASE_URL);
  if (!baseUrl) {
    console.log(
      '::warning::Repository variable AUDIO_BASE_URL is not set: cannot check the public address',
    );
    summary('Public address not checked: set the repository variable `AUDIO_BASE_URL`.');
    return;
  }
  const origin = process.env.APP_ORIGIN || 'https://engapp-65y.pages.dev';
  const both = [...source.paths].filter((p) => target.paths.has(p));
  const sample = samplePaths(both, int(values.sample, 'sample', 1, 500)).map((path) => ({
    path,
    size: target.sizes.get(path) ?? 0,
  }));
  const v = await verifyPublic(sample, { baseUrl, origin });
  log('audio verify', { checked: v.checked, ok: v.ok, bad: v.bad.slice(0, 10), cors: v.cors });
  summary(
    `Public check: **${v.ok}/${v.checked}** files served correctly · CORS for ${origin}: **${v.cors === null ? 'not checked' : v.cors ? 'ok' : 'MISSING'}** · still to copy: **${plan.jobs.length}**`,
  );
  if (v.checked === 0) {
    console.log('::warning::No copied files to check yet: run the copy first');
  } else if (v.ok < v.checked || v.cors === false) {
    console.log(
      v.cors === false
        ? `::error::The bucket does not allow the app (${origin}) to read files: add the CORS policy (docs/setup-backend.md, step 18)`
        : '::error::Some files are not served by the public address (see the log)',
    );
    process.exitCode = 1;
  } else if (plan.jobs.length > 0) {
    console.log(`::warning::${plan.jobs.length} files are not in R2 yet: run the copy again`);
  } else {
    console.log(`::notice::All ${source.paths.size} files are in R2 and the public address works`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
