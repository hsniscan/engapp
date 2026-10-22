/**
 * Builds the word-family / root reference data (İP6) from wordfreq, MorphyNet and Wiktionary.
 *
 *   node scripts/build-morphology/index.ts [--etymology kaikki|mirror] [--limit 30000]
 *
 * Downloads go to .cache/morphology/ (git-ignored) and are verified against the pinned
 * SHA-256 in sources.ts. Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
 * kaikki.org is the preferred Wiktionary source (etymology templates + text, ~2.7 GB); when it
 * cannot be reached, `--etymology mirror` reads a pinned SQLite mirror (etymology text only).
 * The GitHub workflow "Build morphology data" runs the kaikki variant.
 *
 * Outputs (all CC BY-SA 4.0, see docs/licenses/morphology.md):
 *   public/data/morphology-<sha10>.json        the file the app fetches lazily
 *   src/features/family/morphologyAsset.ts      its URL, checksum and counts (generated)
 *   data/reference/morphology.sources.json      source versions, checksums, licences, stats
 * The Supabase ref_* tables are loaded from the JSON file by load-sql.ts.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, gunzipSync } from 'node:zlib';
import { buildMorphology, cleanEdges, parseMorphyNet, vocabFromWordfreq, type EtymologyEntry, type EtymologyTemplate } from './build.ts';
import { decodeMsgpack } from './msgpack.ts';
import { SOURCES, type Source } from './sources.ts';
import { readZipEntry } from './zip.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const etymologySource = (args.get('etymology') ?? 'kaikki') as 'kaikki' | 'mirror';
const limit = Number(args.get('limit') ?? 30_000);
const CACHE = '.cache/morphology';
mkdirSync(CACHE, { recursive: true });

const sha256File = async (path: string): Promise<string> => {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
};

async function download(src: Source, file: string): Promise<{ path: string; sha256: string; downloadedAt: string }> {
  const path = `${CACHE}/${file}`;
  if (!existsSync(path)) {
    console.log(`download ${src.url}`);
    const res = await fetch(src.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${src.key}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${path}.part`));
    renameSync(`${path}.part`, path);
    writeFileSync(`${path}.date`, new Date().toISOString().slice(0, 10));
  }
  const sha256 = await sha256File(path);
  if (src.sha256 && sha256 !== src.sha256) throw new Error(`${src.key}: checksum mismatch (${sha256})`);
  const downloadedAt = existsSync(`${path}.date`) ? readFileSync(`${path}.date`, 'utf8').trim() : 'unknown';
  return { path, sha256, downloadedAt };
}

const used: { source: Source; sha256: string; downloadedAt: string }[] = [];

// 1. Vocabulary: the `limit` most frequent words.
const wf = await download(SOURCES.wordfreq, 'wordfreq-3.1.1.whl');
used.push({ source: SOURCES.wordfreq, ...wf });
const vocab = vocabFromWordfreq(decodeMsgpack(gunzipSync(readZipEntry(readFileSync(wf.path), 'wordfreq/data/large_en.msgpack.gz'))), limit);
console.log(`vocabulary: ${vocab.rank.size} words`);

// 2. MorphyNet derivations between vocabulary words.
const mn = await download(SOURCES.morphynet, 'eng.derivational.v1.tsv');
used.push({ source: SOURCES.morphynet, ...mn });
const edges = cleanEdges(parseMorphyNet(readFileSync(mn.path, 'utf8')), new Set(vocab.rank.keys()));
console.log(`MorphyNet: ${edges.length} edges kept`);

// 3. Wiktionary etymologies of vocabulary words.
const etymology = new Map<string, EtymologyEntry>();
if (etymologySource === 'kaikki') {
  const kk = await download(SOURCES.kaikki, 'kaikki.org-dictionary-English.jsonl');
  used.push({ source: SOURCES.kaikki, ...kk });
  const lines = createInterface({ input: createReadStream(kk.path).pipe(kk.path.endsWith('.gz') ? createGunzip() : new (await import('node:stream')).PassThrough()) });
  for await (const line of lines) {
    // Cheap pre-filter before JSON.parse: the word must be in the vocabulary.
    const m = /"word": ?"([a-z]+)"/.exec(line);
    if (!m || !vocab.rank.has(m[1]!)) continue;
    const e = JSON.parse(line) as { word: string; lang_code?: string; etymology_text?: string; etymology_templates?: EtymologyTemplate[] };
    if (e.lang_code !== 'en' || e.word !== m[1]) continue;
    const prev = etymology.get(e.word);
    const text = e.etymology_text ?? '';
    etymology.set(e.word, {
      text: prev && !prev.text.includes(text) ? `${prev.text}\n${text}` : (prev?.text ?? text),
      templates: [...(prev?.templates ?? []), ...(e.etymology_templates ?? []).map((t) => ({ name: t.name, args: t.args }))],
    });
  }
} else {
  const mr = await download(SOURCES['kaikki-mirror'], 'kaikki_en.sqlite');
  used.push({ source: SOURCES['kaikki-mirror'], ...mr });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(mr.path, { readOnly: true });
  for (const row of db.prepare('select headword, data from entry').iterate() as Iterable<{ headword: string; data: string }>) {
    if (!vocab.rank.has(row.headword)) continue;
    const d = JSON.parse(row.data) as { ety?: string };
    etymology.set(row.headword, { text: d.ety ?? '' });
  }
  db.close();
}
console.log(`Wiktionary: ${etymology.size} vocabulary lemmas`);

// 4. Build, merge the Turkish explanations of the one-off AI job, write.
const out = buildMorphology({ vocab, edges, etymology });
const meaningsPath = 'data/reference/morpheme-meanings.tr.json';
const meanings = existsSync(meaningsPath)
  ? (JSON.parse(readFileSync(meaningsPath, 'utf8')) as { prompt_version: string; items: Record<string, { meaning_tr: string; note_tr: string | null; model: string; reviewed?: boolean }> })
  : null;

const file = {
  format: 1,
  license: 'CC BY-SA 4.0',
  notice:
    'Derived from MorphyNet (CC BY-SA 3.0), Wiktionary via kaikki.org (CC BY-SA 4.0 / GFDL) and wordfreq (CC BY-SA 4.0). ' +
    'This file is licensed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/. See /data/morphology-LICENSE.txt.',
  morphemes: out.morphemes.map((m) => {
    const ai = meanings?.items[m.id];
    return {
      ...m,
      ai: ai ? { meaning_tr: ai.meaning_tr, note_tr: ai.note_tr, model: ai.model, prompt_version: meanings!.prompt_version, reviewed: ai.reviewed === true } : null,
    };
  }),
  families: out.families,
  words: out.words,
};
const json = JSON.stringify(file);
const sha = createHash('sha256').update(json).digest('hex');
for (const f of readdirSync('public/data')) if (/^morphology-[0-9a-f]{10}\.json$/.test(f)) rmSync(`public/data/${f}`);
const name = `morphology-${sha.slice(0, 10)}.json`;
writeFileSync(`public/data/${name}`, json);

writeFileSync(
  'src/features/family/morphologyAsset.ts',
  `// Generated by scripts/build-morphology/index.ts. Do not edit.\n` +
    `export const MORPHOLOGY_ASSET = {\n` +
    `  url: '/data/${name}',\n` +
    `  sha256: '${sha}',\n` +
    `  words: ${out.words.length},\n` +
    `  families: ${out.families.length},\n` +
    `  morphemes: ${out.morphemes.length},\n` +
    `} as const;\n`,
);

mkdirSync('data/reference', { recursive: true });
writeFileSync(
  'data/reference/morphology.sources.json',
  `${JSON.stringify(
    {
      built_at: new Date().toISOString().slice(0, 10),
      output: { file: `public/data/${name}`, sha256: sha, bytes: json.length },
      etymology: etymologySource,
      vocabulary_limit: limit,
      stats: out.stats,
      ai_meanings: meanings ? { prompt_version: meanings.prompt_version, count: Object.keys(meanings.items).length } : null,
      sources: used.map((u) => ({
        name: u.source.name,
        version: u.source.version,
        url: u.source.url,
        sha256: u.sha256,
        downloaded_at: u.downloadedAt,
        license: u.source.license,
        license_url: u.source.licenseUrl,
        attribution: u.source.attribution,
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(out.stats), `→ public/data/${name} (${(json.length / 1024).toFixed(0)} KiB)`);
