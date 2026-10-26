// Cloudflare R2 side of the pronunciation audio jobs (decision 0053): listing what the R2
// bucket holds, uploading with retries, and the one-time copy from Supabase Storage
// (scripts/audio-migrate.ts). Pure logic over injected I/O; the R2 client is
// supabase/functions/_shared/r2.ts.
//
// The copy is idempotent and resumable: it lists both buckets, copies only what R2 lacks (or
// holds with a different size), and every object is written under its own content-addressed
// name, so a cancelled run is simply run again. It never deletes anything from Supabase.

import type { R2Client } from '../../supabase/functions/_shared/r2.ts';
import type { TtsVoice } from '../../supabase/functions/_shared/tts-contract.ts';
import { AUDIO_CACHE_CONTROL } from '../../supabase/functions/_shared/tts-r2.ts';
import { ttsContentType } from '../../supabase/functions/_shared/tts-store.ts';
import type { Log } from './tts-pregen.ts';

export interface AudioListing {
  /** Object paths `<voice>/<name>`. */
  paths: Set<string>;
  /** Size in bytes of each object. */
  sizes: Map<string, number>;
  bytes: { mp3: number; wav: number };
  counts: { mp3: number; wav: number };
}

export function emptyListing(): AudioListing {
  return {
    paths: new Set(),
    sizes: new Map(),
    bytes: { mp3: 0, wav: 0 },
    counts: { mp3: 0, wav: 0 },
  };
}

/** Adds one object to a listing (only `<voice>/<name>.mp3|.wav`; anything else is ignored). */
export function addToListing(l: AudioListing, path: string, size: number): void {
  const kind = path.endsWith('.mp3') ? 'mp3' : path.endsWith('.wav') ? 'wav' : null;
  if (!kind || l.paths.has(path)) return;
  l.paths.add(path);
  l.sizes.set(path, size);
  l.bytes[kind] += size;
  l.counts[kind]++;
}

/** What the R2 bucket holds for these voices. */
export async function listR2Audio(
  r2: Pick<R2Client, 'list'>,
  voices: readonly TtsVoice[],
): Promise<AudioListing> {
  const out = emptyListing();
  for (const voice of voices) {
    for (const o of await r2.list(`${voice}/`)) addToListing(out, o.key, o.size);
  }
  return out;
}

/** The paths of either listing (a file in Supabase or R2 counts as present). */
export function unionPaths(a: AudioListing, b: AudioListing): Set<string> {
  return new Set([...a.paths, ...b.paths]);
}

export const MB = (bytes: number) => Math.round(bytes / 1e5) / 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Uploads one audio file to R2 (three attempts, backing off). Throws the last error. */
export async function uploadAudioToR2(
  r2: Pick<R2Client, 'put'>,
  path: string,
  bytes: Uint8Array,
  opts: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 3;
  const wait = opts.wait ?? sleep;
  let last: unknown;
  for (let a = 0; a < attempts; a++) {
    if (a) await wait(1000 * 2 ** a);
    try {
      await r2.put(path, bytes, {
        contentType: ttsContentType(path),
        cacheControl: AUDIO_CACHE_CONTROL,
      });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// ------------------------------------------------------------------ copy plan

export interface CopyJob {
  path: string;
  size: number;
}

export interface CopyPlan {
  jobs: CopyJob[];
  /** Objects in Supabase Storage. */
  source: number;
  /** Of those, already in R2 with the same size. */
  present: number;
  /** In R2 but with a different size (copied again). */
  mismatched: number;
  /** Bytes to copy. */
  bytes: number;
}

/** What to copy: every Supabase object that R2 lacks or holds with another size, sorted. */
export function planCopy(source: AudioListing, target: AudioListing, max = Infinity): CopyPlan {
  const jobs: CopyJob[] = [];
  let present = 0;
  let mismatched = 0;
  for (const path of [...source.paths].sort()) {
    const size = source.sizes.get(path) ?? 0;
    const there = target.sizes.get(path);
    if (there !== undefined && (there === size || size === 0)) {
      present++;
      continue;
    }
    if (there !== undefined) mismatched++;
    jobs.push({ path, size });
  }
  const limited = jobs.slice(0, max);
  return {
    jobs: limited,
    source: source.paths.size,
    present,
    mismatched,
    bytes: limited.reduce((s, j) => s + j.size, 0),
  };
}

// ------------------------------------------------------------------ copy run

export interface CopyDeps {
  download: (path: string) => Promise<Uint8Array>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  log: Log;
  now?: () => number;
}

export interface CopyOptions {
  concurrency?: number;
  /** Start no new copies after this time (ms since epoch). */
  deadline?: number;
  maxConsecutiveFailures?: number;
  logEvery?: number;
}

export interface CopyResult {
  copied: number;
  failed: number;
  bytes: number;
  /** Not attempted (deadline, or stopped after repeated failures). */
  left: number;
  stopped: 'complete' | 'deadline' | 'failures';
  /** The first few failed paths, for the log. */
  failures: string[];
}

export async function runCopy(
  jobs: readonly CopyJob[],
  deps: CopyDeps,
  opts: CopyOptions = {},
): Promise<CopyResult> {
  const now = deps.now ?? Date.now;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const maxFails = opts.maxConsecutiveFailures ?? 20;
  const logEvery = opts.logEvery ?? 500;
  let next = 0;
  let copied = 0;
  let failed = 0;
  let bytes = 0;
  let streak = 0;
  let started = 0;
  let stopped: CopyResult['stopped'] = 'complete';
  const failures: string[] = [];

  const worker = async () => {
    for (;;) {
      if (stopped !== 'complete') return;
      if (opts.deadline !== undefined && now() >= opts.deadline) {
        stopped = 'deadline';
        return;
      }
      if (streak >= maxFails) {
        stopped = 'failures';
        return;
      }
      const job = jobs[next++];
      if (!job) return;
      started++;
      try {
        const data = await deps.download(job.path);
        if (data.length === 0) throw new Error('empty file');
        await deps.upload(job.path, data);
        copied++;
        streak = 0;
        bytes += data.length;
        if (copied % logEvery === 0)
          deps.log('audio copy progress', { copied, failed, of: jobs.length });
      } catch (e) {
        failed++;
        streak++;
        if (failures.length < 10) failures.push(job.path);
        deps.log('audio copy failed', {
          path: job.path,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, worker),
  );
  return { copied, failed, bytes, left: jobs.length - started, stopped, failures };
}

// ------------------------------------------------------------------ verify

export interface VerifyResult {
  checked: number;
  ok: number;
  /** Paths the public URL did not serve (status other than 200, or wrong size). */
  bad: { path: string; reason: string }[];
  /** The public URL answered with CORS headers that let the app read the file. */
  cors: boolean | null;
}

/** Evenly spread sample of up to n paths (deterministic). */
export function samplePaths(paths: readonly string[], n: number): string[] {
  const sorted = [...paths].sort();
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]!);
}

/**
 * Fetches a sample through the public base URL, as the app does (with the app's Origin), and
 * checks status, size and type, and that the CORS header allows the app to read the file.
 */
export async function verifyPublic(
  sample: readonly { path: string; size: number }[],
  opts: { baseUrl: string; origin: string; fetch?: typeof fetch },
): Promise<VerifyResult> {
  const doFetch = opts.fetch ?? fetch;
  const bad: VerifyResult['bad'] = [];
  let ok = 0;
  let cors: boolean | null = null;
  for (const { path, size } of sample) {
    const url = `${opts.baseUrl.replace(/\/+$/, '')}/${path}`;
    try {
      const r = await doFetch(url, { headers: { Origin: opts.origin } });
      const body = new Uint8Array(await r.arrayBuffer());
      const acao = r.headers.get('access-control-allow-origin');
      const allowed = acao === '*' || acao === opts.origin;
      cors = cors === null ? allowed : cors && allowed;
      const type = r.headers.get('content-type') ?? '';
      if (r.status !== 200) bad.push({ path, reason: `HTTP ${r.status}` });
      else if (size > 0 && body.length !== size)
        bad.push({ path, reason: `size ${body.length} ≠ ${size}` });
      else if (!type.startsWith('audio/')) bad.push({ path, reason: `type ${type || 'none'}` });
      else ok++;
    } catch (e) {
      bad.push({ path, reason: e instanceof Error ? e.message.slice(0, 120) : 'error' });
    }
  }
  return { checked: sample.length, ok, bad, cors };
}
