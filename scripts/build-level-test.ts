/**
 * Question bank of the level test (v0.2 İP3, docs/decisions/0017-level-test.md). One-off
 * script; its outputs are committed and reviewed by hand:
 *
 *   data/level-test/pseudowords.tsv   300 made-up words (honesty check), with the candidates
 *                                     the checks rejected and why (review trail)
 *   data/level-test/meanings.tsv      Turkish meanings of the candidate words (prompt bank-tr-v1)
 *   data/level-test/band-sizes.json   lemmas per level in the word list (vocabulary counter)
 *   data/level-test/bank.json         the bank the app ships: 200 words per level A1–C2 with
 *                                     their meaning and three wrong options, the pseudowords,
 *                                     and the size of each level in the word list
 *
 * Steps (each reads the previous step's committed file, so a step can be redone alone):
 *
 *   node scripts/build-level-test.ts pseudo
 *       Letter-trigram chain trained on the word lists, length 5–9. A candidate is rejected
 *       when it is in wordfreq English (any frequency) or Turkish, in the word lists, one edit
 *       away from one of the 30 000 most frequent English words, an inflection of a real word,
 *       or contains an offensive string. Then (with --ai) the model flags what still looks like a
 *       real English or Turkish word, a name or a brand (prompt pseudo-check-v1).
 *   node --env-file=<GEMINI_API_KEY file> scripts/build-level-test.ts meanings
 *       Picks ~240 candidate words per level (content words, stratified by part of speech,
 *       no Turkish look-alikes) and asks the model for the Turkish meaning (70 words a call).
 *   node --env-file=<...> scripts/build-level-test.ts bank [--no-ai]
 *       Keeps 200 suitable words per level, picks three wrong options from the same level and
 *       part of speech (no shared word with the right answer), then lets the model check every
 *       question (prompt bank-check-v1) and re-picks the options of the questions it flags.
 *
 * Model names come from GEMINI_MODEL / GEMINI_FALLBACK_MODEL (defaults in ai-provider.ts).
 * The API key is read from the environment and never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiProvider, type AiProvider } from '../supabase/functions/_shared/ai-provider.ts';
import { CEFR, type Cefr } from '../supabase/functions/_shared/cefr.ts';
import { normalizeLemma } from '../supabase/functions/_shared/text.ts';
import { decodeMsgpack, fetchPinned, SOURCES, unzipMember } from './build-levels.ts';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/level-test');
export const BANK_VERSION = 'bank-2026-10-1';
const PER_LEVEL = 200;
const CANDIDATES_PER_LEVEL = 240;
const MEANING_BATCH = 70;
const PSEUDO_COUNT = 300;
const CONTENT_POS = ['noun', 'verb', 'adjective', 'adverb'] as const;
type Pos = (typeof CONTENT_POS)[number];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const readTsv = (file: string): string[][] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'));

interface ListEntry {
  lemma: string;
  pos: string;
  cefr: Cefr;
  source: string;
}

function readList(): ListEntry[] {
  return readTsv(join(ROOT, 'data/levels/ref-word-levels.tsv')).map(([lemma, pos, cefr, source]) => ({
    lemma: lemma!,
    pos: pos!,
    cefr: cefr as Cefr,
    source: source!,
  }));
}

/** Easiest level per lemma (any part of speech): the level a lemma counts in. */
function listLevels(list: ListEntry[]): Map<string, Cefr> {
  const m = new Map<string, Cefr>();
  for (const e of list) {
    const prev = m.get(e.lemma);
    if (!prev || CEFR.indexOf(e.cefr) < CEFR.indexOf(prev)) m.set(e.lemma, e.cefr);
  }
  return m;
}

function cbList(gz: Buffer): Map<string, number> {
  const data = decodeMsgpack(gunzipSync(gz)) as unknown[];
  const out = new Map<string, number>();
  for (let bin = 1; bin < data.length; bin++) {
    const zipf = Math.round((9 - (bin - 1) / 100) * 100) / 100;
    for (const w of data[bin] as string[]) {
      const n = normalizeLemma(w);
      if (!out.has(n)) out.set(n, zipf);
    }
  }
  return out;
}

async function wordfreq(): Promise<{ en: Map<string, number>; tr: Map<string, number> }> {
  const wheel = await fetchPinned(SOURCES.wordfreq.url, SOURCES.wordfreq.sha256);
  return {
    en: cbList(unzipMember(wheel, 'wordfreq/data/large_en.msgpack.gz')),
    tr: cbList(unzipMember(wheel, 'wordfreq/data/small_tr.msgpack.gz')),
  };
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

/** Every string one edit (delete, replace, insert, swap) away. */
function edits1(w: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= w.length; i++) {
    const [a, b] = [w.slice(0, i), w.slice(i)];
    if (b) out.add(a + b.slice(1));
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
    for (const c of ALPHA) {
      if (b) out.add(a + c + b.slice(1));
      out.add(a + c + b);
    }
  }
  out.delete(w);
  return out;
}

const OFFENSIVE = [
  'fuck', 'shit', 'cunt', 'nigg', 'nigr', 'fag', 'dick', 'cock', 'porn', 'rape', 'piss', 'slut',
  'whor', 'bitch', 'penis', 'vagin', 'anal', 'anus', 'sex', 'nazi', 'kike', 'spic', 'twat', 'tits',
  'boob', 'cum', 'jizz', 'puss', 'homo', 'gay', 'lesb', 'kill', 'dead', 'death', 'murd', 'suic',
  'god', 'allah', 'jesus', 'sik', 'amk', 'orospu', 'pic', 'got', 'meme', 'yarak', 'taşak', 'kahpe',
];

const SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'est', 'ly', 'ness', 'ful', 'less', 'ment', 'able', 'y', 'ies', 'ied'];

/** "blinked" → blink is a word: an inflection or derivation of a real word, not made up. */
function realStem(w: string, en: Map<string, number>): string | null {
  for (const suf of SUFFIXES) {
    if (!w.endsWith(suf) || w.length - suf.length < 3) continue;
    const stem = w.slice(0, -suf.length);
    for (const s of [stem, `${stem}e`, stem.replace(/i$/, 'y'), stem.replace(/(.)\1$/, '$1')]) {
      if ((en.get(s) ?? 0) >= 2) return s;
    }
  }
  return null;
}

function aiProvider(): AiProvider {
  return createAiProvider((k) => process.env[k], { timeoutMs: 90_000, totalBudgetMs: 400_000 });
}

// ---------------------------------------------------------------------------
// pseudowords
// ---------------------------------------------------------------------------

const PSEUDO_CHECK_SYSTEM = `You review made-up words for an English vocabulary test taken by Turkish speakers. The test shows each string and asks "Do you know this English word?". A string is only usable when it is NOT a word.

For each string, set "flag" to true when ANY of these holds:
- it is an English word or word form, including rare, archaic, dialect, technical, scientific or slang words;
- it is a common first name, surname, place name, brand or product name;
- it is a Turkish word or very close to one (a Turkish speaker could read it as Turkish);
- it is a word in another major European language that a Turkish learner may know (e.g. German, French, Spanish, Italian);
- it sounds rude, sexual, religious or offensive in English or Turkish.
Otherwise "flag" is false. When "flag" is true, give a short English "reason" (e.g. "English word: archaic", "Turkish: 'kalem'"). Be strict: when in doubt, flag it.`;

const PSEUDO_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { w: { type: 'string' }, flag: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['w', 'flag'],
      },
    },
  },
  required: ['items'],
};

/** Hand review of the generated list: too close to a real word or a suffix on its own. */
const HAND_REJECTS: Record<string, string> = {
  accon: 'reads as a name / "acorn"',
  hology: 'a suffix alone ("-ology")',
  fology: 'a suffix alone ("-ology")',
  hical: 'a suffix alone ("-ical")',
  micity: 'reads as "-micity" (seismicity)',
  ingue: 'a suffix alone ("-ingue")',
  ingual: 'reads as "lingual"',
  pulty: 'reads as "poultry" / "paltry"',
  squily: 'reads as "squiggly"',
  reful: 'reads as "refill" / "rueful"',
  callike: '"call-like"',
  callic: 'reads as "Gallic"',
};

async function buildPseudowords(withAi: boolean): Promise<void> {
  const list = readList();
  const levels = listLevels(list);
  const { en, tr } = await wordfreq();
  const clientLemmas = readTsv(join(ROOT, 'data/levels/client-levels.tsv')).map((r) => r[0]!);
  const top = new Set(
    [...en.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30_000).map(([w]) => w).concat(clientLemmas),
  );
  // Trigram chain over the list lemmas (letters only).
  const train = [...levels.keys()].filter((w) => /^[a-z]{3,}$/.test(w));
  const next = new Map<string, Map<string, number>>();
  for (const w of train) {
    const s = `^^${w}$`;
    for (let i = 2; i < s.length; i++) {
      const ctx = s.slice(i - 2, i);
      const m = next.get(ctx) ?? new Map<string, number>();
      m.set(s[i]!, (m.get(s[i]!) ?? 0) + 1);
      next.set(ctx, m);
    }
  }
  const r = rng(20261022);
  const pick = (m: Map<string, number>): string => {
    let total = 0;
    for (const v of m.values()) total += v;
    let x = r() * total;
    for (const [k, v] of m) {
      x -= v;
      if (x <= 0) return k;
    }
    return [...m.keys()].at(-1)!;
  };
  /** Mean log-probability per letter under the chain: how English-like a string looks. */
  const score = (w: string): number => {
    const s = `^^${w}$`;
    let lp = 0;
    for (let i = 2; i < s.length; i++) {
      const m = next.get(s.slice(i - 2, i))!;
      let total = 0;
      for (const v of m.values()) total += v;
      lp += Math.log((m.get(s[i]!) ?? 0.5) / total);
    }
    return lp / (s.length - 2);
  };
  // Real words of 5+ letters inside a candidate make it read as a compound or a real word.
  const common = [...en.entries()].filter(([w, z]) => z >= 3.5 && /^[a-z]{4,}$/.test(w)).map(([w]) => w);
  const commonSet = new Set(common);
  const embedded = (w: string): string | null => {
    for (let i = 0; i < w.length; i++)
      for (let j = i + 4; j <= w.length; j++) {
        const sub = w.slice(i, j);
        if (sub.length >= 5 && commonSet.has(sub)) return sub;
        // two real words joined ("flatear")
        if (i === 0 && j >= 3 && j <= w.length - 3 && (en.get(w.slice(0, j)) ?? 0) >= 3.5 && (en.get(w.slice(j)) ?? 0) >= 3.5)
          return `${w.slice(0, j)}+${w.slice(j)}`;
      }
    return null;
  };
  const accepted: string[] = [];
  const rejected: [string, string][] = [];
  const seen = new Set<string>();
  for (let tries = 0; accepted.length < 4000 && tries < 2_000_000; tries++) {
    let s = '^^';
    while (s.length < 16) {
      const c = pick(next.get(s.slice(-2))!);
      if (c === '$') break;
      s += c;
    }
    const w = s.slice(2);
    if (w.length < 5 || w.length > 9 || seen.has(w)) continue;
    seen.add(w);
    let why: string | null = null;
    if (en.has(w)) why = 'wordfreq en';
    else if (tr.has(w)) why = 'wordfreq tr';
    else if (levels.has(w)) why = 'word list';
    else if (/(.)\1\1/.test(w) || !/[aeiouy]/.test(w) || /[aeiou]{3}|[^aeiouy]{4}/.test(w)) why = 'shape';
    else if (/^(ation|tion|sion|ment|ally|ive|ness|ful|ical|ity|ous)/.test(w)) why = 'starts like a suffix';
    else if (score(w) < -1.8) why = `unlikely letters (${score(w).toFixed(2)})`;
    else if (embedded(w)) why = `contains "${embedded(w)}"`;
    else if (OFFENSIVE.some((o) => w.includes(o))) why = 'offensive string';
    else {
      const stem = realStem(w, en);
      if (stem) why = `inflection of "${stem}"`;
      else {
        for (const e of edits1(w)) {
          if (top.has(e)) {
            why = `one edit from "${e}"`;
            break;
          }
        }
      }
    }
    if (why) {
      if (rejected.length < 400 && !why.startsWith('wordfreq') && why !== 'word list') rejected.push([w, why]);
    } else accepted.push(w);
  }

  // A varied set: few words share a beginning or an ending (the chain loves "-ation").
  const diverse: string[] = [];
  const ends = new Map<string, number>();
  const starts = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const w of shuffle(accepted, rng(11))) {
    const e = w.slice(-3);
    const b = w.slice(0, 3);
    if ((ends.get(e) ?? 0) >= 3 || (starts.get(b) ?? 0) >= 3) continue;
    if (/[st]ion$/.test(w) && (ends.get('ion') ?? 0) >= 12) continue;
    bump(ends, e);
    bump(starts, b);
    if (/[st]ion$/.test(w)) bump(ends, 'ion');
    diverse.push(w);
    if (diverse.length >= 460) break;
  }

  let flagged = new Map<string, string>();
  if (withAi) {
    const ai = aiProvider();
    for (let i = 0; i < diverse.length; i += 100) {
      const batch = diverse.slice(i, i + 100);
      const res = await ai.generateJson({
        system: PSEUDO_CHECK_SYSTEM,
        user: JSON.stringify({ strings: batch }),
        schema: PSEUDO_CHECK_SCHEMA,
        maxOutputTokens: 16_000,
      });
      const items = (res.data as { items: { w: string; flag: boolean; reason?: string }[] }).items;
      for (const it of items) if (it.flag) flagged.set(it.w, `model: ${it.reason ?? 'flagged'}`);
      console.log(`pseudo-check ${i / 100 + 1}: ${items.filter((x) => x.flag).length} flagged (${res.model})`);
    }
  } else if (existsSync(join(OUT, 'pseudowords.tsv'))) {
    // Keep the earlier model review: its flags stay in the file.
    flagged = new Map(
      readTsv(join(OUT, 'pseudowords.tsv'))
        .filter((r) => r[1] === 'rejected' && (r[2] ?? '').startsWith('model:'))
        .map((r) => [r[0]!, r[2]!]),
    );
  }
  for (const [w, why] of Object.entries(HAND_REJECTS)) if (diverse.includes(w)) flagged.set(w, `hand: ${why}`);
  const ok = diverse.filter((w) => !flagged.has(w));
  if (ok.length < PSEUDO_COUNT) throw new Error(`only ${ok.length} pseudowords passed`);
  const chosen = ok.slice(0, PSEUDO_COUNT).sort();
  const extra = ok.filter((w) => !chosen.includes(w));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'pseudowords.tsv'),
    [
      '# Made-up words of the level test (honesty check). Built by scripts/build-level-test.ts pseudo:',
      '# letter-trigram chain on the word lists, length 5-9; not in wordfreq (English, Turkish), not in the',
      '# word lists, not one edit from the 30 000 most frequent English words, not an inflection of a real',
      '# word, no offensive string; then checked by the model (pseudo-check-v1) and reviewed by hand.',
      '# Columns: word, status (use | spare | rejected), reason. Only "use" rows go into the bank.',
      ...chosen.map((w) => `${w}\tuse\t`),
      ...extra.map((w) => `${w}\tspare\t`),
      ...[...flagged].map(([w, why]) => `${w}\trejected\t${why.replace(/\s+/g, ' ')}`),
      ...rejected.slice(0, 120).map(([w, why]) => `${w}\trejected\t${why}`),
    ].join('\n') + '\n',
  );
  console.log(`pseudowords: ${chosen.length} used, ${extra.length} spare, ${flagged.size} flagged by the model`);
}

// ---------------------------------------------------------------------------
// candidate words + meanings
// ---------------------------------------------------------------------------

export const BANK_TR_PROMPT_VERSION = 'bank-tr-v1';

const MEANING_SYSTEM = `You are an English–Turkish lexicographer. You prepare a multiple-choice vocabulary test for adult Turkish speakers: the test shows an English word and four Turkish meanings, one of them right.

For each English headword (given with its part of speech and CEFR level) return:
- "tr": the single most common Turkish translation of the word in that part of speech, as a learner's dictionary would give it first. 1–3 words, lower case (except proper nouns), no explanations, no brackets, no English. Verbs in the infinitive (-mek/-mak), adjectives as adjectives, nouns as nouns. If the word has one dominant everyday meaning, give that one.
- "alt": up to 3 other correct Turkish translations of the same word (may be empty).
- "cognate": true when Turkish has a word with this meaning that looks or sounds almost the same (television → televizyon, hotel → otel, problem → problem, taxi → taksi); otherwise false.
- "ok": false when the headword is unsuitable for a vocabulary test: an abbreviation, a proper name, a spelling variant or inflected form of another word, vulgar, a word whose meaning is only grammatical, or a word without a clear Turkish equivalent; otherwise true.

Accuracy matters more than anything: a wrong "tr" teaches a learner something false. Use standard Turkish spelling with Turkish letters (ç ğ ı İ ö ş ü).`;

const MEANING_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          w: { type: 'string' },
          tr: { type: 'string' },
          alt: { type: 'array', items: { type: 'string' } },
          cognate: { type: 'boolean' },
          ok: { type: 'boolean' },
        },
        required: ['w', 'tr', 'alt', 'cognate', 'ok'],
      },
    },
  },
  required: ['items'],
};

interface Candidate {
  lemma: string;
  pos: Pos;
  cefr: Cefr;
  zipf: number | null;
}

async function pickCandidates(): Promise<Candidate[]> {
  const list = readList();
  const levels = listLevels(list);
  const { en, tr } = await wordfreq();
  const out: Candidate[] = [];
  for (const cefr of CEFR) {
    // The lemma's easiest level must be this one, and the entry at that level must be a
    // content word (its part of speech decides the meaning asked).
    const pool = new Map<Pos, Candidate[]>();
    const seen = new Set<string>();
    for (const e of list) {
      if (e.cefr !== cefr || levels.get(e.lemma) !== cefr || seen.has(e.lemma)) continue;
      if (!(CONTENT_POS as readonly string[]).includes(e.pos)) continue;
      if (!/^[a-z]{3,14}$/.test(e.lemma)) continue;
      // Turkish look-alikes ("film", "problem", "radyo" is caught by the model later).
      if ((tr.get(e.lemma) ?? 0) >= 2.5) continue;
      seen.add(e.lemma);
      const c: Candidate = { lemma: e.lemma, pos: e.pos as Pos, cefr, zipf: en.get(e.lemma) ?? null };
      pool.set(c.pos, [...(pool.get(c.pos) ?? []), c]);
    }
    const total = [...pool.values()].reduce((n, l) => n + l.length, 0);
    const r = rng(1000 + CEFR.indexOf(cefr));
    const picked: Candidate[] = [];
    for (const pos of CONTENT_POS) {
      const l = pool.get(pos) ?? [];
      const n = Math.round((l.length / total) * CANDIDATES_PER_LEVEL);
      picked.push(...shuffle(l, r).slice(0, n));
    }
    out.push(...picked.sort((a, b) => a.lemma.localeCompare(b.lemma)));
    console.log(`${cefr}: pool ${total}, picked ${picked.length}`);
  }
  return out;
}

interface Meaning {
  tr: string;
  alt: string[];
  cognate: boolean;
  ok: boolean;
}

const MEANINGS_FILE = join(OUT, 'meanings.tsv');

function readMeanings(): Map<string, Meaning & Candidate> {
  const m = new Map<string, Meaning & Candidate>();
  if (!existsSync(MEANINGS_FILE)) return m;
  for (const [lemma, pos, cefr, zipf, tr, alt, cognate, ok] of readTsv(MEANINGS_FILE)) {
    m.set(`${lemma}\t${pos}`, {
      lemma: lemma!,
      pos: pos as Pos,
      cefr: cefr as Cefr,
      zipf: zipf ? Number(zipf) : null,
      tr: tr!,
      alt: alt ? alt.split(';') : [],
      cognate: cognate === '1',
      ok: ok === '1',
    });
  }
  return m;
}

/** Models named in the file header (a resumed run may use another model). */
function meaningModels(): Set<string> {
  if (!existsSync(MEANINGS_FILE)) return new Set();
  const head = readFileSync(MEANINGS_FILE, 'utf8').split('\n', 1)[0] ?? '';
  const m = /models? ([^.]+?)\.$/.exec(head);
  return new Set(m ? m[1]!.split(', ') : []);
}

function writeMeanings(m: Map<string, Meaning & Candidate>, model: string): void {
  const models = meaningModels();
  if (model !== 'unknown') models.add(model);
  const named = [...models];
  const rows = [...m.values()].sort((a, b) => CEFR.indexOf(a.cefr) - CEFR.indexOf(b.cefr) || a.lemma.localeCompare(b.lemma));
  writeFileSync(
    MEANINGS_FILE,
    [
      `# Turkish meanings of the level-test candidate words. Prompt ${BANK_TR_PROMPT_VERSION}, ${named.length > 1 ? 'models' : 'model'} ${named.join(', ')}.`,
      '# Written by scripts/build-level-test.ts meanings; corrected by hand where noted in the commit.',
      '# Columns: lemma, pos, cefr, zipf, tr (shown as the right answer), alt (";"), cognate (1/0), ok (1/0).',
      ...rows.map((r) =>
        [r.lemma, r.pos, r.cefr, r.zipf ?? '', r.tr, r.alt.join(';'), r.cognate ? 1 : 0, r.ok ? 1 : 0].join('\t'),
      ),
    ].join('\n') + '\n',
  );
}

async function buildMeanings(): Promise<void> {
  const candidates = await pickCandidates();
  const have = readMeanings();
  const todo = candidates.filter((c) => !have.has(`${c.lemma}\t${c.pos}`));
  console.log(`meanings: ${have.size} stored, ${todo.length} to ask`);
  const ai = aiProvider();
  let model = 'unknown';
  for (let i = 0; i < todo.length; i += MEANING_BATCH) {
    const batch = todo.slice(i, i + MEANING_BATCH);
    const res = await ai.generateJson({
      system: MEANING_SYSTEM,
      user: JSON.stringify({ words: batch.map((c) => ({ w: c.lemma, pos: c.pos, level: c.cefr })) }),
      schema: MEANING_SCHEMA,
      maxOutputTokens: 60_000,
    });
    model = res.model;
    const items = (res.data as { items: (Meaning & { w: string })[] }).items;
    const byWord = new Map(items.map((it) => [it.w.trim().toLowerCase(), it]));
    for (const c of batch) {
      const it = byWord.get(c.lemma);
      if (!it || !it.tr.trim()) continue;
      have.set(`${c.lemma}\t${c.pos}`, {
        ...c,
        tr: it.tr.trim().replace(/\s+/g, ' '),
        alt: it.alt.map((a) => a.trim()).filter(Boolean).slice(0, 3),
        cognate: it.cognate,
        ok: it.ok,
      });
    }
    writeMeanings(have, model);
    console.log(`batch ${i / MEANING_BATCH + 1}: ${items.length} answers (${res.model})`);
  }
}

// ---------------------------------------------------------------------------
// bank
// ---------------------------------------------------------------------------

export const BANK_CHECK_PROMPT_VERSION = 'bank-check-v1';

const CHECK_SYSTEM = `You check multiple-choice questions of an English vocabulary test for Turkish speakers. Each question gives an English word, its part of speech and four Turkish options.

For each question return "correct": the indexes (0–3) of EVERY option that a good bilingual dictionary would accept as a translation of the word in that part of speech (also near-synonyms that a careful teacher would mark right). Return "doubt" with a short English note when the intended answer seems wrong or unnatural Turkish; otherwise an empty string.`;

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          correct: { type: 'array', items: { type: 'integer' } },
          doubt: { type: 'string' },
        },
        required: ['id', 'correct', 'doubt'],
      },
    },
  },
  required: ['items'],
};

/** Words of a meaning, for "do two options share a word". */
const words = (s: string) =>
  new Set(
    s
      .toLocaleLowerCase('tr')
      .split(/[\s,;/]+/)
      .map((w) => w.replace(/(mek|mak)$/, ''))
      .filter((w) => w.length > 1),
  );

interface BankWord {
  w: string;
  pos: Pos;
  tr: string;
  /** Three wrong options. */
  d: [string, string, string];
}

export interface BankFile {
  version: string;
  note: string;
  /** Lemmas per level in the word list (easiest level per lemma), for the vocabulary estimate. */
  band_sizes: Record<Cefr, number>;
  levels: Record<Cefr, BankWord[]>;
  pseudo: string[];
}

function pickDistractors(item: Meaning & Candidate, pool: (Meaning & Candidate)[], r: () => number, avoid: Set<string>): [string, string, string] | null {
  const own = new Set([...words(item.tr), ...item.alt.flatMap((a) => [...words(a)])]);
  const options = shuffle(pool, r).filter((p) => {
    if (p.lemma === item.lemma || avoid.has(p.tr)) return false;
    const ws = words(p.tr);
    for (const w of ws) if (own.has(w)) return false;
    return true;
  });
  const chosen: string[] = [];
  for (const o of options) {
    if (chosen.some((c) => c === o.tr || [...words(c)].some((w) => words(o.tr).has(w)))) continue;
    chosen.push(o.tr);
    if (chosen.length === 3) return chosen as [string, string, string];
  }
  return null;
}

async function buildBank(withAi: boolean): Promise<void> {
  const meanings = [...readMeanings().values()].filter((m) => m.ok && !m.cognate && m.tr.length <= 40);
  const pseudo = readTsv(join(OUT, 'pseudowords.tsv'))
    .filter((r) => r[1] === 'use')
    .map((r) => r[0]!);
  const levels = listLevels(readList());
  const bandSizes = Object.fromEntries(CEFR.map((c) => [c, 0])) as Record<Cefr, number>;
  for (const c of levels.values()) bandSizes[c]++;

  const bank = Object.fromEntries(CEFR.map((c) => [c, [] as BankWord[]])) as Record<Cefr, BankWord[]>;
  const items = new Map<string, Meaning & Candidate>();
  for (const cefr of CEFR) {
    const r = rng(500 + CEFR.indexOf(cefr));
    const mine = meanings.filter((m) => m.cefr === cefr);
    // Keep the part-of-speech mix of the candidates.
    const chosen = shuffle(mine, r).slice(0, PER_LEVEL);
    if (chosen.length < PER_LEVEL) console.warn(`${cefr}: only ${chosen.length} words`);
    for (const m of chosen) items.set(m.lemma, m);
  }

  const poolFor = (m: Meaning & Candidate) => {
    const same = meanings.filter((p) => p.pos === m.pos && p.cefr === m.cefr);
    return same.length >= 20 ? same : meanings.filter((p) => p.pos === m.pos);
  };
  const distractors = new Map<string, [string, string, string]>();
  const avoid = new Map<string, Set<string>>();
  const r = rng(99);
  for (const m of items.values()) {
    const d = pickDistractors(m, poolFor(m), r, new Set());
    if (d) distractors.set(m.lemma, d);
  }

  if (withAi) {
    const ai = aiProvider();
    let todo = [...items.values()].filter((m) => distractors.has(m.lemma));
    for (let round = 0; round < 4 && todo.length; round++) {
      const flagged: (Meaning & Candidate)[] = [];
      for (let i = 0; i < todo.length; i += 80) {
        const batch = todo.slice(i, i + 80);
        const questions = batch.map((m, id) => {
          const opts = [m.tr, ...distractors.get(m.lemma)!];
          return { id, w: m.lemma, pos: m.pos, options: opts };
        });
        const res = await ai.generateJson({
          system: CHECK_SYSTEM,
          user: JSON.stringify({ questions }),
          schema: CHECK_SCHEMA,
          maxOutputTokens: 16_000,
        });
        const answers = (res.data as { items: { id: number; correct: number[]; doubt: string }[] }).items;
        const byId = new Map(answers.map((a) => [a.id, a]));
        for (const [id, m] of batch.entries()) {
          const a = byId.get(id);
          const right = a && a.correct.length === 1 && a.correct[0] === 0;
          if (a?.doubt) console.log(`  doubt ${m.lemma} (${m.pos}) "${m.tr}": ${a.doubt}`);
          if (!right) {
            const opts = [m.tr, ...distractors.get(m.lemma)!];
            const extra = (a?.correct ?? []).filter((k) => k !== 0).map((k) => opts[k]!);
            const set = avoid.get(m.lemma) ?? new Set<string>();
            for (const e of extra) set.add(e);
            avoid.set(m.lemma, set);
            if (a && !a.correct.includes(0)) console.log(`  answer not accepted: ${m.lemma} (${m.pos}) "${m.tr}"`);
            flagged.push(m);
          }
        }
        console.log(`check round ${round + 1}, batch ${i / 80 + 1}: ${batch.length} questions (${res.model})`);
      }
      for (const m of flagged) {
        const d = pickDistractors(m, poolFor(m), r, avoid.get(m.lemma) ?? new Set());
        if (d) distractors.set(m.lemma, d);
        else distractors.delete(m.lemma);
      }
      todo = flagged.filter((m) => distractors.has(m.lemma));
      console.log(`round ${round + 1}: ${flagged.length} re-picked`);
    }
    // Still flagged after the last round: leave the word out rather than ship a doubtful question.
    for (const m of todo) distractors.delete(m.lemma);
  }

  for (const m of items.values()) {
    const d = distractors.get(m.lemma);
    if (d) bank[m.cefr].push({ w: m.lemma, pos: m.pos, tr: m.tr, d });
  }
  for (const c of CEFR) bank[c].sort((a, b) => a.w.localeCompare(b.w));
  const file: BankFile = {
    version: BANK_VERSION,
    note: 'Level-test bank (scripts/build-level-test.ts). Words and levels derived from the CEFR-J Wordlist 1.5 (Tono Laboratory, TUFS) and the Octanove Vocabulary Profile C1/C2 1.0 (CC BY-SA 4.0); this word selection is CC BY-SA 4.0. Turkish meanings: prompt bank-tr-v1, checked with bank-check-v1. Pseudowords: generated, not words.',
    band_sizes: bandSizes,
    levels: bank,
    pseudo,
  };
  writeFileSync(join(OUT, 'bank.json'), JSON.stringify(file) + '\n');
  // The counter on the home screen needs only the level sizes, not the whole bank.
  writeFileSync(join(OUT, 'band-sizes.json'), JSON.stringify(bandSizes) + '\n');
  console.log('bank:', Object.fromEntries(CEFR.map((c) => [c, bank[c].length])), 'pseudo', pseudo.length, 'sizes', bandSizes);
}

// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  const noAi = process.argv.includes('--no-ai');
  if (cmd === 'pseudo') await buildPseudowords(process.argv.includes('--ai'));
  else if (cmd === 'meanings') await buildMeanings();
  else if (cmd === 'bank') await buildBank(!noAi);
  else {
    console.error('usage: node scripts/build-level-test.ts pseudo [--ai] | meanings | bank [--no-ai]');
    process.exit(2);
  }
}
