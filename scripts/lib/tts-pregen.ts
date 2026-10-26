// Pre-generated pronunciation audio (docs/decisions/0042-pregenerated-tts.md): which texts,
// which files are missing, and the resumable synthesize-and-upload loop. Pure logic; the
// Supabase side is in tts-pregen-store.ts and the Kokoro worker in scripts/tts-kokoro.py.
//
// Idempotent and resumable: a file's name is the hash of version + voice + text
// (tts-contract.ts, the same key the app computes), every clip is uploaded as soon as it is
// made, and each run first lists what the bucket already has and skips it. A cancelled or
// timed-out run loses at most the clips in flight; the next run continues from there.

import {
  normalizeTtsText,
  TTS_SAMPLE_TEXT,
  TTS_VOICES,
  ttsObjectPath,
  ttsOnDemandObjectPath,
  ttsRequest,
  type TtsVoice,
} from '../../supabase/functions/_shared/tts-contract.ts';

export type Log = (msg: string, data?: Record<string, unknown>) => void;

/** Rows of the shared dictionary, as `tts_text_source` reads them ('public' texts). */
export interface PublicRows {
  /** lexicon_terms: a headword is public in any casing (lemma_norm = lower(text)). */
  terms: readonly { lemma: string; lemma_norm: string }[];
  /** lexicon_examples (active): an example sentence is public by its exact text. */
  examples: readonly { text_en: string }[];
}

export interface TextSet {
  /** Every text to pre-generate, normalised, unique, sorted. */
  texts: string[];
  words: number;
  sentences: number;
  /** Rows dropped because the server would refuse to read them (no Latin letter, too long). */
  skipped: number;
}

/** True when the tts function would accept this text (same schema). */
export function isSpeakable(text: string): boolean {
  return ttsRequest.safeParse({ text, voice: 'en-US' }).success;
}

/**
 * The public texts, mirroring `tts_text_source(…) = 'public'` (migration 20261024000100):
 * each headword in its lower-case form (lemma_norm) and, when it differs, its display
 * spelling ("Monday"); every active example sentence; and the settings sample. The app tries
 * the text as shown, then its lower-case form (ttsTextCandidates), so every casing finds one.
 */
export function publicTexts(rows: PublicRows): TextSet {
  const words = new Set<string>();
  const sentences = new Set<string>();
  let skipped = 0;
  const add = (set: Set<string>, raw: string) => {
    const t = normalizeTtsText(raw);
    if (!isSpeakable(t)) {
      skipped++;
      return;
    }
    set.add(t);
  };
  for (const r of rows.terms) {
    add(words, r.lemma_norm);
    if (normalizeTtsText(r.lemma) !== normalizeTtsText(r.lemma_norm)) add(words, r.lemma);
  }
  for (const r of rows.examples) add(sentences, r.text_en);
  add(sentences, TTS_SAMPLE_TEXT);
  for (const w of words) sentences.delete(w); // a one-word "sentence" is already a word
  const texts = [...new Set([...words, ...sentences])].sort();
  return { texts, words: words.size, sentences: sentences.size, skipped };
}

/**
 * The graded library's sentences (decision 0047): every English sentence of an approved text,
 * normalised, unique, sorted. Read aloud in en-US only; each file is named like any other
 * clip (content-addressed), so a sentence that is also a dictionary example is made once and
 * the reader plays it by the sentence's audio_key.
 */
export function gradedTexts(sentences: readonly string[]): TextSet {
  const set = new Set<string>();
  let skipped = 0;
  for (const raw of sentences) {
    const t = normalizeTtsText(raw);
    if (!isSpeakable(t)) {
      skipped++;
      continue;
    }
    set.add(t);
  }
  const texts = [...set].sort();
  return { texts, words: 0, sentences: texts.length, skipped };
}

/** Where the texts come from: the shared dictionary (both accents) or the graded library. */
export type PregenSource = 'dictionary' | 'graded';

export function parseSource(v: string): PregenSource {
  if (v === 'dictionary' || v === '') return 'dictionary';
  if (v === 'graded') return 'graded';
  throw new Error('source must be dictionary or graded');
}

/** The graded library is read in en-US only (plan A.5). */
export function voicesFor(source: PregenSource, asked: readonly TtsVoice[]): TtsVoice[] {
  return source === 'graded' ? ['en-US'] : [...asked];
}

export interface PregenJob {
  /** File stem for the worker: `<voice>-<hash>`. */
  id: string;
  text: string;
  voice: TtsVoice;
  /** Object path in the bucket: `<voice>/<hash>.mp3`. */
  path: string;
}

export interface PlanOptions {
  voices: readonly TtsVoice[];
  /** This runner's part of the work: 0 ≤ shard < shards (stable: by the file's hash). */
  shard: number;
  shards: number;
  /** At most this many clips in this run. */
  max: number;
}

export interface Plan {
  jobs: PregenJob[];
  /** Clips in this shard (all voices asked for). */
  total: number;
  /** Of those, already in the bucket. */
  present: number;
  /** Of those, still missing (jobs is the first `max` of them). */
  missing: number;
}

export function parseVoices(v: string): TtsVoice[] {
  if (v === 'both' || v === '') return [...TTS_VOICES];
  if ((TTS_VOICES as readonly string[]).includes(v)) return [v as TtsVoice];
  throw new Error(`voice must be one of ${TTS_VOICES.join(', ')} or both`);
}

/** Shard of an object path: the first 32 bits of its hash, mod the shard count. */
export function shardOf(path: string, shards: number): number {
  const hash = path.slice(path.indexOf('/') + 1, path.indexOf('/') + 9);
  return Number.parseInt(hash, 16) % shards;
}

/**
 * The clips this run makes: every text × voice of this shard whose file is not in `existing`
 * (object paths, `<voice>/<name>`), in a stable order, at most `max`.
 */
export async function planJobs(
  texts: readonly string[],
  existing: ReadonlySet<string>,
  opts: PlanOptions,
): Promise<Plan> {
  if (!Number.isInteger(opts.shards) || opts.shards < 1) throw new Error('shards must be ≥ 1');
  if (!Number.isInteger(opts.shard) || opts.shard < 0 || opts.shard >= opts.shards) {
    throw new Error('shard must be 0..shards-1');
  }
  const jobs: PregenJob[] = [];
  let total = 0;
  let present = 0;
  for (const voice of opts.voices) {
    for (const text of texts) {
      const path = await ttsObjectPath(voice, text);
      if (shardOf(path, opts.shards) !== opts.shard) continue;
      total++;
      if (existing.has(path)) {
        present++;
        continue;
      }
      if (jobs.length < opts.max) {
        const hash = path.slice(voice.length + 1, -'.mp3'.length);
        jobs.push({ id: `${voice}-${hash}`, text, voice, path });
      }
    }
  }
  return { jobs, total, present, missing: total - present };
}

// ------------------------------------------------------------------ estimates

// Measured with Kokoro-82M (kokoro-onnx, fp32) on a 4-core x86 machine, Oct 2026: a word is
// ~1.2 s of audio (~7 KB) and takes ~0.4 s; a 72-character sentence is ~4 s (~24 KB) and
// takes ~1.6 s. Only for the plan's estimate.

/** Seconds of audio for a text (speed 0.92, with the 0.2 s padding). */
export function estimateSeconds(text: string): number {
  return Math.max(1.2, 0.55 + 0.048 * text.length);
}

/** Bytes of a 48 kbps MP3 of that text. */
export function estimateBytes(text: string): number {
  return Math.round(6000 * estimateSeconds(text));
}

/** CPU seconds to make it on a 4-vCPU GitHub runner. */
export function estimateCpuSeconds(text: string): number {
  return 0.25 + 0.02 * text.length;
}

export function estimate(jobs: readonly Pick<PregenJob, 'text'>[]) {
  let bytes = 0;
  let cpu = 0;
  for (const j of jobs) {
    bytes += estimateBytes(j.text);
    cpu += estimateCpuSeconds(j.text);
  }
  return { bytes, mb: Math.round(bytes / 1e5) / 10, cpuHours: Math.round(cpu / 360) / 10 };
}

// ------------------------------------------------------------------ the run

export interface RunDeps {
  /** Makes the MP3 of one clip (the Kokoro worker). */
  synth: (job: PregenJob) => Promise<Uint8Array>;
  /** Stores it at job.path (overwrites: the name is content-addressed). Throws on failure. */
  upload: (path: string, mp3: Uint8Array) => Promise<void>;
  log: Log;
  now?: () => number;
}

export interface RunOptions {
  /** Stop starting new clips after this time (ms since epoch), so the job ends cleanly. */
  deadline?: number;
  /** Uploads in flight while the next clips are made. */
  uploadConcurrency?: number;
  /** Give up after this many failures in a row (the engine or Storage is broken). */
  maxConsecutiveFailures?: number;
  /** Progress line every this many clips. */
  logEvery?: number;
}

export interface RunResult {
  done: number;
  failed: number;
  bytes: number;
  /** Clips not attempted (deadline, or stopped after repeated failures). */
  left: number;
  stopped: 'complete' | 'deadline' | 'failures';
}

/** Smallest plausible MP3 (a frame header and a little audio). */
const MIN_MP3_BYTES = 400;

export async function runJobs(
  jobs: readonly PregenJob[],
  deps: RunDeps,
  opts: RunOptions = {},
): Promise<RunResult> {
  const now = deps.now ?? Date.now;
  const concurrency = opts.uploadConcurrency ?? 4;
  const maxFails = opts.maxConsecutiveFailures ?? 20;
  const logEvery = opts.logEvery ?? 200;
  const pending = new Set<Promise<void>>();
  let done = 0;
  let failed = 0;
  let bytes = 0;
  let streak = 0;
  let i = 0;
  let stopped: RunResult['stopped'] = 'complete';

  const fail = (job: PregenJob, stage: string, e: unknown) => {
    failed++;
    streak++;
    deps.log('tts clip failed', {
      stage,
      voice: job.voice,
      chars: job.text.length,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    });
  };

  for (; i < jobs.length; i++) {
    if (opts.deadline !== undefined && now() >= opts.deadline) {
      stopped = 'deadline';
      break;
    }
    if (streak >= maxFails) {
      stopped = 'failures';
      break;
    }
    const job = jobs[i]!;
    let mp3: Uint8Array;
    try {
      mp3 = await deps.synth(job);
      if (mp3.length < MIN_MP3_BYTES) throw new Error(`audio too small (${mp3.length} bytes)`);
    } catch (e) {
      fail(job, 'synth', e);
      continue;
    }
    while (pending.size >= concurrency) await Promise.race(pending);
    const p: Promise<void> = deps
      .upload(job.path, mp3)
      .then(
        () => {
          done++;
          streak = 0;
          bytes += mp3.length;
          if (done % logEvery === 0) deps.log('tts progress', { done, failed, of: jobs.length });
        },
        (e: unknown) => fail(job, 'upload', e),
      )
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
  return { done, failed, bytes, left: jobs.length - i, stopped };
}

// ------------------------------------------------------------------ old files

/**
 * On-demand WAV files (Gemini, decision 0028) that a pre-generated MP3 now replaces: for each
 * public text and voice whose MP3 exists, its WAV path when that exists too. Deleting them
 * frees space; the app never asks for them once the MP3 is there.
 */
export async function replacedOnDemandFiles(
  texts: readonly string[],
  voices: readonly TtsVoice[],
  existing: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const voice of voices) {
    for (const text of texts) {
      const wav = await ttsOnDemandObjectPath(voice, text);
      if (existing.has(wav) && existing.has(await ttsObjectPath(voice, text))) out.push(wav);
    }
  }
  return out;
}
