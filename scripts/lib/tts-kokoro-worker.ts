// Drives the Kokoro-82M Python worker (scripts/tts-kokoro.py) for scripts/tts-pregen.ts:
// one request at a time over JSON lines (onnxruntime already uses every core for one clip).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Log, PregenJob } from './tts-pregen.ts';

export interface KokoroOptions {
  python: string;
  model: string;
  voices: string;
  /** Folder for the worker's MP3 files (each is read and deleted right after). */
  out: string;
}

export class KokoroWorker {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly lines: AsyncIterator<string>;
  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    this.lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  }

  static async start(o: KokoroOptions, log: Log): Promise<KokoroWorker> {
    const script = fileURLToPath(new URL('../tts-kokoro.py', import.meta.url));
    const args = [script, '--model', o.model, '--voices', o.voices, '--out', o.out];
    const proc = spawn(o.python, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s && !/warn/i.test(s)) console.error(s.slice(0, 2000));
    });
    const w = new KokoroWorker(proc);
    const first = await w.next();
    if (!first.ready) throw new Error('Kokoro worker did not start');
    log('kokoro ready', { voices: first.voices });
    return w;
  }

  private async next(): Promise<Record<string, unknown>> {
    const r = await this.lines.next();
    if (r.done) throw new Error('Kokoro worker exited');
    return JSON.parse(r.value) as Record<string, unknown>;
  }

  async synth(job: PregenJob): Promise<Uint8Array> {
    this.proc.stdin.write(JSON.stringify({ id: job.id, text: job.text, voice: job.voice }) + '\n');
    const r = await this.next();
    if (r.id !== job.id) throw new Error('Kokoro worker answered out of order');
    if (!r.ok) throw new Error(String(r.error));
    const path = String(r.path);
    const bytes = new Uint8Array(await readFile(path));
    await rm(path, { force: true });
    return bytes;
  }

  stop() {
    this.proc.stdin.end();
  }
}
