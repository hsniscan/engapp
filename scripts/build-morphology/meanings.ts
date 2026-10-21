/**
 * One-off system job `morpheme-tr-v1`: Turkish explanations for the morphemes of the built
 * morphology file, 20 per model request (~7 requests for ~130 morphemes).
 *
 *   GEMINI_API_KEY=… GEMINI_MODEL=… [GEMINI_FALLBACK_MODEL=…] \
 *     node scripts/build-morphology/meanings.ts [--force]
 *   node scripts/build-morphology/index.ts …     # merges the result into the app file
 *
 * Server side only: the key comes from the environment (a GitHub secret in the workflow, a
 * local secrets file otherwise) and never reaches the client. Model names come only from
 * the environment. Already explained morphemes (same prompt version) are skipped, so a
 * rerun costs 0 calls; `--force` redoes all. Writes data/reference/morpheme-meanings.tr.json,
 * which the owner can review and edit like any other data file. Until it exists, the app
 * shows the hand-written short meaning of scripts/build-morphology/inventory.ts.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGeminiProvider } from '../../supabase/functions/_shared/ai-provider.ts';
import {
  MORPHEME_BATCH,
  MORPHEME_PROMPT_VERSION,
  MORPHEME_RESPONSE_SCHEMA,
  MORPHEME_SYSTEM_PROMPT,
  morphemeUserMessage,
  validateMorphemeAnswer,
  type MorphemeJobItem,
  type MorphemeMeaning,
} from '../../supabase/functions/_shared/morphemes.ts';
import { vocabFromWordfreq } from './build.ts';
import { decodeMsgpack } from './msgpack.ts';
import { readZipEntry } from './zip.ts';

const OUT = 'data/reference/morpheme-meanings.tr.json';
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model) {
  console.error('GEMINI_API_KEY and GEMINI_MODEL must be set');
  process.exit(2);
}
const force = process.argv.includes('--force');

const fileName = readdirSync('public/data').find((f) => /^morphology-[0-9a-f]{10}\.json$/.test(f));
if (!fileName) throw new Error('run scripts/build-morphology/index.ts first');
const data = JSON.parse(readFileSync(`public/data/${fileName}`, 'utf8')) as {
  morphemes: { id: string; form: string; kind: MorphemeJobItem['kind']; origin: string; gloss_en: string }[];
  words: [string, string, number, number[]][];
};

// Example words: the most frequent words that carry the morpheme.
const vocab = vocabFromWordfreq(decodeMsgpack(gunzipSync(readZipEntry(readFileSync('.cache/morphology/wordfreq-3.1.1.whl'), 'wordfreq/data/large_en.msgpack.gz'))));
const examples = new Map<number, string[]>();
for (const [w, , , ms] of data.words) for (const m of ms) (examples.get(m) ?? examples.set(m, []).get(m)!).push(w);
for (const list of examples.values()) list.sort((a, b) => (vocab.rank.get(a) ?? 1e9) - (vocab.rank.get(b) ?? 1e9));

/** One explanation; `reviewed` is set by hand when the owner has checked or corrected it. */
interface Item extends MorphemeMeaning {
  model: string;
  reviewed?: boolean;
}
interface OutFile {
  prompt_version: string;
  generated_at: string;
  items: Record<string, Item>;
}
const prev: OutFile | null = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as OutFile) : null;
const items: Record<string, Item> = !force && prev?.prompt_version === MORPHEME_PROMPT_VERSION ? { ...prev.items } : {};

const todo: MorphemeJobItem[] = data.morphemes
  .map((m, i) => ({ id: m.id, form: m.form, kind: m.kind, origin: m.origin, gloss_en: m.gloss_en, examples: (examples.get(i) ?? []).slice(0, 5) }))
  .filter((m) => !items[m.id]);
console.log(`${todo.length} morphemes to explain, ${Math.ceil(todo.length / MORPHEME_BATCH)} requests`);

const provider = createGeminiProvider({ apiKey, model, fallbackModel: process.env.GEMINI_FALLBACK_MODEL ?? null, timeoutMs: 90_000 });
let failed = 0;
for (let i = 0; i < todo.length; i += MORPHEME_BATCH) {
  const batch = todo.slice(i, i + MORPHEME_BATCH);
  try {
    const res = await provider.generateJson({
      system: MORPHEME_SYSTEM_PROMPT,
      user: morphemeUserMessage(batch),
      schema: MORPHEME_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: 8192,
    });
    const { accepted, rejected } = validateMorphemeAnswer(batch, res.data);
    for (const [id, m] of accepted) items[id] = { ...m, model: res.model };
    failed += rejected.length;
    for (const r of rejected) console.warn(`rejected ${r.id}: ${r.reason}`);
    console.log(`batch ${i / MORPHEME_BATCH + 1}: ${accepted.size} accepted (${res.model})`);
  } catch (e) {
    // Quota or provider error: stop; a rerun continues where this one ended.
    console.error(`stopped: ${e instanceof Error ? e.message : String(e)}`);
    break;
  }
}

const sorted = Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  OUT,
  `${JSON.stringify({ prompt_version: MORPHEME_PROMPT_VERSION, generated_at: new Date().toISOString().slice(0, 10), items: sorted } satisfies OutFile, null, 2)}\n`,
);
console.log(`${Object.keys(sorted).length} meanings in ${OUT}; ${failed} rejected`);
