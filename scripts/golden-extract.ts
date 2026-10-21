/**
 * Golden set of smart extraction (v0.2 İP4, plan acceptance criterion 5).
 *
 *   node --env-file=<file with GEMINI_API_KEY> scripts/golden-extract.ts record [--text 1-city-heat] [--level B1]
 *
 * Runs the real ai-extract pipeline (`runExtract`, the deployed prompt, validation and lexicon
 * write on an in-memory store) on the five texts in data/golden/extract/, for a B1 and a B2
 * learner, and records the model's raw answers in data/golden/extract/recorded/. Nothing is
 * written to Supabase; the API key is read from the environment and never printed.
 *
 * The check itself runs offline on the recordings: `src/domain/candidates.golden.test.ts`
 * replays them through the same pipeline, applies the device's level rule
 * (domain/candidates.ts) and asserts the criterion; `pnpm vitest run golden -u` rewrites the
 * report docs/quality/golden-extract.md (a file snapshot of that test).
 *
 * Environment: GEMINI_API_KEY; optional GEMINI_MODEL, GEMINI_FALLBACK_MODEL.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAiProvider, type AiProvider } from '../supabase/functions/_shared/ai-provider.ts';
import { EXTRACT_PROMPT_VERSION } from '../supabase/functions/_shared/contracts.ts';
import { runExtract, sha256Hex } from '../supabase/functions/_shared/extract.ts';
import { MemoryAiStore } from '../supabase/functions/_shared/testing/memory-store.ts';
import { chunkText } from '../src/domain/chunking.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GOLDEN_DIR = join(ROOT, 'data/golden/extract');
const LEVELS = ['B1', 'B2'] as const;

export interface Recording {
  text: string;
  level: string;
  prompt_version: string;
  model: string | null;
  recorded_at: string;
  /** The model's parsed answer per chunk, in chunk order. */
  outputs: unknown[];
}

function texts(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -4))
    .sort();
}

async function record(onlyText: string | undefined, onlyLevel: string | undefined) {
  const real = createAiProvider((k) => process.env[k]);
  mkdirSync(join(GOLDEN_DIR, 'recorded'), { recursive: true });
  for (const id of texts()) {
    if (onlyText && id !== onlyText) continue;
    const full = readFileSync(join(GOLDEN_DIR, `${id}.txt`), 'utf8').normalize('NFC');
    for (const level of LEVELS) {
      if (onlyLevel && level !== onlyLevel) continue;
      const outputs: unknown[] = [];
      let model: string | null = null;
      const recorder: AiProvider = {
        name: real.name,
        async generateJson(req) {
          const res = await real.generateJson(req);
          outputs.push(res.data);
          model = res.model;
          return res;
        },
      };
      const store = new MemoryAiStore();
      let candidates = 0;
      for (const chunk of chunkText(full)) {
        const text = chunk.normalize('NFC');
        const res = await runExtract(
          { text, chunk_hash: await sha256Hex(text), level },
          { userId: 'golden', store, provider: () => recorder, dailyLimit: 1000 },
        );
        candidates += res.candidates.length;
      }
      const rec: Recording = {
        text: id,
        level,
        prompt_version: EXTRACT_PROMPT_VERSION,
        model,
        recorded_at: new Date().toISOString(),
        outputs,
      };
      writeFileSync(
        join(GOLDEN_DIR, 'recorded', `${id}.${level}.json`),
        JSON.stringify(rec, null, 1) + '\n',
      );
      console.log(
        `${id} ${level}: ${outputs.length} call(s), ${candidates} candidates, model ${model}`,
      );
    }
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { text: { type: 'string' }, level: { type: 'string' } },
});
if (positionals[0] === 'record') {
  await record(values.text, values.level);
} else {
  console.log(
    'usage: node --env-file=<env> scripts/golden-extract.ts record [--text <id>] [--level B1|B2]',
  );
}
