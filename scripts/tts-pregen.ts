/**
 * Pre-generated pronunciation audio (decision 0042), run by .github/workflows/tts-pregen.yml.
 * Logic and tests: scripts/lib/tts-pregen.ts; Supabase side: scripts/lib/tts-pregen-store.ts;
 * the Kokoro-82M engine: scripts/tts-kokoro.py (a Python worker this script drives).
 *
 *   node scripts/tts-pregen.ts plan [--voice both] [--shards 1]
 *       How many dictionary texts there are, what the `tts` bucket already holds (files and
 *       MB), what is missing, and the estimated size and runtime. Reads only.
 *   node scripts/tts-pregen.ts run [--voice both] [--shard 0 --shards 1] [--max 100000]
 *                                  [--minutes 330] [--dry-run]
 *       Makes the missing MP3 files of this shard and uploads each one as soon as it is made.
 *       Resumable: a later run skips every file already there. Needs --model / --voices (or
 *       KOKORO_MODEL / KOKORO_VOICES) and --python (or KOKORO_PYTHON, default python3).
 *   node scripts/tts-pregen.ts plan|run --source graded [...]
 *       The graded library instead (decision 0047): every sentence of an approved text, en-US
 *       only, named like every other clip (the text stores each sentence's audio_key).
 *   node scripts/tts-pregen.ts prune-ondemand [--dry-run]
 *       Deletes the on-demand Gemini WAV files (decision 0028) whose text now has an MP3.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. With R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY and R2_BUCKET also set (decision 0053) new files go to Cloudflare R2
 * instead of Supabase Storage; a file in either bucket counts as present, and prune-ondemand
 * deletes from both. Secrets are read from the environment only and never printed; logs are
 * JSON lines on stdout.
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import {
  estimate,
  gradedTexts,
  parseSource,
  parseVoices,
  voicesFor,
  planJobs,
  publicTexts,
  replacedOnDemandFiles,
  runJobs,
  type Log,
} from './lib/tts-pregen.ts';
import { R2Client, r2ConfigFromEnv } from '../supabase/functions/_shared/r2.ts';
import { listR2Audio, MB, unionPaths, uploadAudioToR2 } from './lib/audio-r2.ts';
import { KokoroWorker } from './lib/tts-kokoro-worker.ts';
import { SupabasePregenStore } from './lib/tts-pregen-store.ts';

const log: Log = (msg, data = {}) => {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...data }));
};

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

function store(): SupabasePregenStore {
  return new SupabasePregenStore(
    createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
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
      voice: { type: 'string', default: 'both' },
      source: { type: 'string', default: 'dictionary' },
      shard: { type: 'string', default: '0' },
      shards: { type: 'string', default: '1' },
      max: { type: 'string', default: '100000' },
      minutes: { type: 'string', default: '330' },
      'dry-run': { type: 'boolean', default: false },
      model: { type: 'string', default: process.env.KOKORO_MODEL ?? 'kokoro-v1.0.onnx' },
      voices: { type: 'string', default: process.env.KOKORO_VOICES ?? 'voices-v1.0.bin' },
      python: { type: 'string', default: process.env.KOKORO_PYTHON ?? 'python3' },
      out: { type: 'string', default: process.env.RUNNER_TEMP ?? '/tmp' },
    },
  });
  const job = positionals[0];
  if (job !== 'plan' && job !== 'run' && job !== 'prune-ondemand') {
    console.error('usage: node scripts/tts-pregen.ts <plan|run|prune-ondemand> [options]');
    process.exitCode = 2;
    return;
  }
  const source = parseSource(values.source);
  const voices = voicesFor(source, parseVoices(values.voice));
  const shards = int(values.shards, 'shards', 1, 64);
  const shard = int(values.shard, 'shard', 0, shards - 1);
  const max = int(values.max, 'max', 1, 1_000_000);
  const s = store();

  if (source === 'graded' && job === 'prune-ondemand')
    throw new Error('prune-ondemand is for the dictionary');
  const set =
    source === 'graded'
      ? gradedTexts(await s.gradedSentences())
      : publicTexts(await s.publicRows());
  log('tts texts', { source, words: set.words, sentences: set.sentences, skipped: set.skipped });
  const bucket = await s.listBucket(voices);
  log('tts bucket', {
    mp3: bucket.counts.mp3,
    mp3MB: MB(bucket.bytes.mp3),
    wav: bucket.counts.wav,
    wavMB: MB(bucket.bytes.wav),
  });
  // Cloudflare R2 (decision 0053): new files go there; a file in either bucket is present.
  const r2Config = r2ConfigFromEnv((k) => process.env[k]);
  const r2 = r2Config ? new R2Client(r2Config) : null;
  const r2Bucket = r2 ? await listR2Audio(r2, voices) : null;
  if (r2Bucket) {
    log('tts r2 bucket', {
      mp3: r2Bucket.counts.mp3,
      mp3MB: MB(r2Bucket.bytes.mp3),
      wav: r2Bucket.counts.wav,
      wavMB: MB(r2Bucket.bytes.wav),
    });
  }
  log('tts upload target', { target: r2 ? 'r2' : 'supabase' });
  const present = r2Bucket ? unionPaths(bucket, r2Bucket) : bucket.paths;

  if (job === 'prune-ondemand') {
    const paths = await replacedOnDemandFiles(set.texts, voices, present);
    log('tts on-demand files replaced by an MP3', { files: paths.length });
    if (!values['dry-run'] && paths.length) {
      const inSupabase = paths.filter((p) => bucket.paths.has(p));
      if (inSupabase.length) log('tts removed', { files: await s.remove(inSupabase) });
      if (r2 && r2Bucket) {
        let removed = 0;
        for (const p of paths.filter((x) => r2Bucket.paths.has(x))) {
          await r2.delete(p);
          removed++;
        }
        log('tts r2 removed', { files: removed });
      }
    }
    return;
  }

  const plan = await planJobs(set.texts, present, { voices, shard, shards, max });
  const est = estimate(plan.jobs);
  log('tts plan', {
    shard,
    shards,
    clips: plan.total,
    present: plan.present,
    missing: plan.missing,
    thisRun: plan.jobs.length,
    estimatedMB: est.mb,
    estimatedCpuHours: est.cpuHours,
  });
  if (job === 'plan' || values['dry-run'] || plan.jobs.length === 0) return;

  if (!r2) await s.ensureBucket();
  const worker = await KokoroWorker.start(
    { python: values.python, model: values.model, voices: values.voices, out: values.out },
    log,
  );
  try {
    const minutes = int(values.minutes, 'minutes', 1, 24 * 60);
    const result = await runJobs(
      plan.jobs,
      {
        synth: (j) => worker.synth(j),
        upload: r2 ? (p, b) => uploadAudioToR2(r2, p, b) : (p, b) => s.upload(p, b),
        log,
      },
      { deadline: Date.now() + minutes * 60_000 },
    );
    log('tts run finished', { ...result, MB: Math.round(result.bytes / 1e5) / 10 });
    if (result.stopped === 'failures') {
      console.log('::error::Stopped after repeated failures (see the log above)');
      process.exitCode = 1;
    } else if (result.left > 0) {
      console.log(`::notice::${result.left} clips left for the next run (time limit)`);
    }
  } finally {
    worker.stop();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
