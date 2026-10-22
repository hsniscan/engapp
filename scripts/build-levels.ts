/**
 * Builds the word-level reference data (v0.2 İP2) from pinned, checksummed sources:
 *
 *   CEFR-J Wordlist 1.5          A1–B2   free for research and commercial use, with citation
 *   Octanove Vocabulary Profile  C1–C2   CC BY-SA 4.0
 *   wordfreq 3.1.1 (en, large)   Zipf    data CC BY-SA 4.0 (code Apache-2.0)
 *
 *   node scripts/build-levels.ts            download (cached), verify, write the outputs
 *   node scripts/build-levels.ts --check    rebuild in memory and fail if a committed output differs
 *
 * Outputs (all derived from CC BY-SA data, so they stay CC BY-SA 4.0; docs/licenses.md):
 *   data/levels/ref-word-levels.tsv     lemma_norm, pos, cefr, source, source_version
 *   data/levels/ref-word-freq.tsv       lemma_norm, zipf (server table ref_word_freq)
 *   data/levels/client-levels.tsv       ~30k lemmas for the app (offline levels, guests)
 *   data/levels/manifest.json           sources, versions, licences, checksums, counts
 *   supabase/migrations/20261021001200_ref_word_data.sql   loads the two ref tables
 *
 * The optional input data/levels/level-tr.tsv (exported from the server with
 * `node scripts/system-jobs.ts export-tr`) adds the Turkish-learner corrections to the
 * client file, so guests see the same levels as signed-in users.
 *
 * No new dependency: the wheel is a zip (read with node:zlib) and the word list is
 * msgpack (a 60-line decoder below).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { normalizeLemma } from '../supabase/functions/_shared/text.ts';
import {
  CEFR,
  fitZipfThresholds,
  FREQ_MIN_ZIPF,
  zipfBand,
  ZIPF_THRESHOLDS,
  type Cefr,
} from '../supabase/functions/_shared/level.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/levels');
const CACHE = join(ROOT, 'node_modules/.cache/build-levels');

const OLP_COMMIT = 'd4e45b75b38f27b30dfc5c44d8c571aec7e7092f';
const OLP_RAW = `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/${OLP_COMMIT}`;

export const SOURCES = {
  cefrj: {
    name: 'CEFR-J Wordlist',
    version: '1.5',
    source_version: 'cefrj-1.5',
    url: `${OLP_RAW}/cefrj-vocabulary-profile-1.5.csv`,
    homepage: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
    sha256: 'b0dd3c635f1c9a4fdf1490c7e5b7c48e8bbe55b652ad0c9860a95f98e10ae498',
    license:
      'Free for research and commercial purposes with proper citation (CEFR-J terms of use, as published by Open Language Profiles). © Tono Laboratory, Tokyo University of Foreign Studies.',
    citation:
      'The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html (via Open Language Profiles).',
  },
  octanove: {
    name: 'Octanove Vocabulary Profile C1/C2',
    version: '1.0',
    source_version: 'octanove-1.0',
    url: `${OLP_RAW}/octanove-vocabulary-profile-c1c2-1.0.csv`,
    homepage: 'https://github.com/openlanguageprofiles/olp-en-cefrj',
    sha256: '18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380',
    license: 'CC BY-SA 4.0',
    citation: 'Octanove Vocabulary Profile C1/C2 (ver 1.0), Octanove Labs.',
  },
  wordfreq: {
    name: 'wordfreq (English, large list)',
    version: '3.1.1',
    source_version: 'wordfreq-3.1.1',
    url: 'https://files.pythonhosted.org/packages/py3/w/wordfreq/wordfreq-3.1.1-py3-none-any.whl',
    homepage: 'https://github.com/rspeer/wordfreq',
    sha256: '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473',
    member: 'wordfreq/data/large_en.msgpack.gz',
    member_sha256: 'dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c',
    license:
      'Data CC BY-SA 4.0, code Apache-2.0. Includes SUBTLEX (Brysbaert et al., free for any use with credit), OpenSubtitles 2018, Google Books Ngrams, Wikipedia, NewsCrawl, OSCAR, ParaCrawl.',
    citation:
      'Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo. https://doi.org/10.5281/zenodo.7199437',
  },
} as const;


// ---------------------------------------------------------------------------
// download + verify
// ---------------------------------------------------------------------------

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export async function fetchPinned(url: string, expected: string): Promise<Buffer> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, expected);
  if (existsSync(file)) {
    const b = readFileSync(file);
    if (sha256(b) === expected) return b;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  const got = sha256(b);
  if (got !== expected) throw new Error(`${url}: sha256 ${got}, expected ${expected}`);
  writeFileSync(file, b);
  return b;
}

/** One member of a zip archive (stored or deflated). */
export function unzipMember(zip: Buffer, name: string): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let k = 0; k < entries; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip method ${method} not supported`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not in archive`);
}

/** Minimal msgpack decoder: nil, bool, ints, floats, str, bin, array, map. */
export function decodeMsgpack(buf: Buffer): unknown {
  let i = 0;
  const str = (n: number) => {
    const s = buf.toString('utf8', i, i + n);
    i += n;
    return s;
  };
  const arr = (n: number): unknown[] => Array.from({ length: n }, () => read());
  const map = (n: number) => {
    const o: Record<string, unknown> = {};
    for (let k = 0; k < n; k++) o[String(read())] = read();
    return o;
  };
  function read(): unknown {
    const b = buf[i++]!;
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
    if ((b & 0xf0) === 0x80) return map(b & 0x0f);
    const u8 = () => buf[i++]!;
    const u16 = () => ((i += 2), buf.readUInt16BE(i - 2));
    const u32 = () => ((i += 4), buf.readUInt32BE(i - 4));
    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return buf.subarray(i, (i += u8()));
      case 0xc5:
        return buf.subarray(i, (i += u16()));
      case 0xca:
        return (i += 4), buf.readFloatBE(i - 4);
      case 0xcb:
        return (i += 8), buf.readDoubleBE(i - 8);
      case 0xcc:
        return u8();
      case 0xcd:
        return u16();
      case 0xce:
        return u32();
      case 0xd0:
        return (i += 1), buf.readInt8(i - 1);
      case 0xd1:
        return (i += 2), buf.readInt16BE(i - 2);
      case 0xd2:
        return (i += 4), buf.readInt32BE(i - 4);
      case 0xd9:
        return str(u8());
      case 0xda:
        return str(u16());
      case 0xdb:
        return str(u32());
      case 0xdc:
        return arr(u16());
      case 0xdd:
        return arr(u32());
      case 0xde:
        return map(u16());
      case 0xdf:
        return map(u32());
      default:
        throw new Error(`msgpack type 0x${b.toString(16)} not supported`);
    }
  }
  return read();
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/** Our part-of-speech names (lexicon_senses.pos) for the list's tags. */
const POS_MAP: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  vern: 'verb', // typo in Octanove 1.0
  'be-verb': 'verb',
  'do-verb': 'verb',
  'have-verb': 'verb',
  'modal auxiliary': 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  preposition: 'preposition',
  conjunction: 'conjunction',
  pronoun: 'pronoun',
  determiner: 'determiner',
  interjection: 'interjection',
  number: 'other',
  'infinitive-to': 'other',
};

export interface RefRow {
  lemma_norm: string;
  pos: string;
  cefr: Cefr;
  source: 'cefrj' | 'octanove';
  source_version: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function parseList(csv: string, source: 'cefrj' | 'octanove'): RefRow[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (n: string) => header!.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
  const [hw, pos, lvl] = [col('headword'), col('pos'), col('CEFR')];
  const out: RefRow[] = [];
  for (const r of rows) {
    const cefr = r[lvl]?.trim().toUpperCase() as Cefr;
    if (!CEFR.includes(cefr)) throw new Error(`${source}: bad level ${r.join(',')}`);
    const rawPos = (r[pos] ?? '').trim().toLowerCase();
    const p = rawPos ? POS_MAP[rawPos] : 'other';
    if (!p) throw new Error(`${source}: unknown pos "${rawPos}"`);
    // "colour/color", "a.m./A.M./am/AM": every spelling is an entry.
    for (const v of (r[hw] ?? '').split('/')) {
      const lemma = normalizeLemma(v);
      if (!lemma || !/\p{L}/u.test(lemma)) continue;
      out.push({ lemma_norm: lemma, pos: p, cefr, source, source_version: SOURCES[source].source_version });
    }
  }
  return out;
}

/** The easiest level per (lemma, pos, source): a list repeats some words ("color/colour" twice). */
function dedupeRefs(rows: RefRow[]): RefRow[] {
  const best = new Map<string, RefRow>();
  for (const r of rows) {
    const k = `${r.lemma_norm}\t${r.pos}\t${r.source}`;
    const prev = best.get(k);
    if (!prev || CEFR.indexOf(r.cefr) < CEFR.indexOf(prev.cefr)) best.set(k, r);
  }
  return [...best.values()].sort(
    (a, b) =>
      cmp(a.lemma_norm, b.lemma_norm) || cmp(a.pos, b.pos) || cmp(a.source, b.source),
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** wordfreq cB list: [header, bin0, bin1, ...]; words in bin i have Zipf 9 - i/100. */
export function parseWordfreq(gz: Buffer): Map<string, number> {
  const data = decodeMsgpack(gunzipSync(gz)) as unknown[];
  const header = data[0] as { format?: string; version?: number };
  if (header?.format !== 'cB' || header.version !== 1) throw new Error('unexpected wordfreq header');
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

/** A word list entry the app can use: letters (any script is filtered later), apostrophes, hyphens. */
const WORDLIKE = /^[a-z][a-z'-]*$/;

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

const POS_CODE: Record<string, string> = {
  noun: 'n',
  verb: 'v',
  adjective: 'j',
  adverb: 'r',
  preposition: 'p',
  conjunction: 'c',
  pronoun: 'o',
  determiner: 'd',
  interjection: 'i',
  other: 'x',
};

interface TrCorrection {
  lemma_norm: string;
  pos: string;
  source: string;
  base: Cefr;
  cefr: Cefr;
  reason: string;
}

function readCorrections(): TrCorrection[] {
  const file = join(OUT, 'level-tr.tsv');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [lemma_norm, pos, source, base, cefr, reason] = l.split('\t');
      return { lemma_norm: lemma_norm!, pos: pos!, source: source!, base: base as Cefr, cefr: cefr as Cefr, reason: reason ?? '' };
    });
}

const LICENSE_HEADER = [
  'Engapp word-level data. Derived from the CEFR-J Wordlist 1.5 (© Tono Laboratory, TUFS; free for',
  'research and commercial use with citation), the Octanove Vocabulary Profile C1/C2 1.0 (CC BY-SA 4.0)',
  'and wordfreq 3.1.1 data (CC BY-SA 4.0; Robyn Speer, incl. SUBTLEX by Brysbaert et al.).',
  'This file is licensed CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/',
  'Built by scripts/build-levels.ts. Sources, versions and checksums: data/levels/manifest.json.',
];

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export interface BuildResult {
  files: Record<string, string>;
  summary: Record<string, unknown>;
}

export async function build(): Promise<BuildResult> {
  const [cefrjCsv, octCsv, wheel] = await Promise.all([
    fetchPinned(SOURCES.cefrj.url, SOURCES.cefrj.sha256),
    fetchPinned(SOURCES.octanove.url, SOURCES.octanove.sha256),
    fetchPinned(SOURCES.wordfreq.url, SOURCES.wordfreq.sha256),
  ]);
  const gz = unzipMember(wheel, SOURCES.wordfreq.member);
  if (sha256(gz) !== SOURCES.wordfreq.member_sha256) throw new Error('wordfreq member checksum');

  const refs = dedupeRefs([
    ...parseList(cefrjCsv.toString('utf8'), 'cefrj'),
    ...parseList(octCsv.toString('utf8'), 'octanove'),
  ]);
  const freq = parseWordfreq(gz);

  // Calibration of the frequency bands on the list itself (single words, easiest level).
  const listLevel = new Map<string, Cefr>();
  for (const r of refs) {
    const prev = listLevel.get(r.lemma_norm);
    if (!prev || CEFR.indexOf(r.cefr) < CEFR.indexOf(prev)) listLevel.set(r.lemma_norm, r.cefr);
  }
  const calib: { zipf: number; cefr: Cefr }[] = [];
  for (const [lemma, cefr] of listLevel) {
    const z = freq.get(lemma);
    if (z !== undefined && !lemma.includes(' ')) calib.push({ zipf: z, cefr });
  }
  const fitted = fitZipfThresholds(calib);
  const agreement = (th: readonly number[]) => {
    let exact = 0;
    let within1 = 0;
    for (const c of calib) {
      const d = Math.abs(CEFR.indexOf(zipfBand(c.zipf, th)) - CEFR.indexOf(c.cefr));
      if (d === 0) exact++;
      if (d <= 1) within1++;
    }
    return { exact: +(exact / calib.length).toFixed(4), within1: +(within1 / calib.length).toFixed(4) };
  };

  // Server frequency table.
  const freqRows = [...freq.entries()]
    .filter(([w, z]) => z >= FREQ_MIN_ZIPF && WORDLIKE.test(w))
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  // List words below the cut keep their frequency too.
  const inServer = new Set(freqRows.map(([w]) => w));
  for (const lemma of listLevel.keys()) {
    const z = freq.get(lemma);
    if (z !== undefined && !inServer.has(lemma)) {
      freqRows.push([lemma, z]);
      inServer.add(lemma);
    }
  }
  freqRows.sort((a, b) => cmp(a[0], b[0]));

  // Client file: every list lemma plus the same frequency words as the server.
  const client = new Map<string, { zipf: number | null; entries: string[] }>();
  const corrections = readCorrections();
  const corr = new Map(corrections.map((c) => [`${c.lemma_norm}\t${c.pos}\t${c.source}`, c]));
  for (const r of refs) {
    const e = client.get(r.lemma_norm) ?? { zipf: freq.get(r.lemma_norm) ?? null, entries: [] };
    const c = corr.get(`${r.lemma_norm}\t${r.pos}\t${r.source}`);
    const tr = c && c.base === r.cefr ? `:${c.cefr}:${c.reason.replace(/[\t\n|]/g, ' ')}` : '';
    e.entries.push(`${POS_CODE[r.pos]}:${r.cefr}:${r.source === 'cefrj' ? 'j' : 'o'}${tr}`);
    client.set(r.lemma_norm, e);
  }
  for (const [w, z] of freqRows) if (!client.has(w)) client.set(w, { zipf: z, entries: [] });
  const clientMinZipf = FREQ_MIN_ZIPF;

  const header = (lines: string[]) => [...LICENSE_HEADER, ...lines].map((l) => `# ${l}`).join('\n');
  const files: Record<string, string> = {};
  files['data/levels/ref-word-levels.tsv'] =
    header(['Columns: lemma_norm, pos, cefr, source, source_version']) +
    '\n' +
    refs.map((r) => [r.lemma_norm, r.pos, r.cefr, r.source, r.source_version].join('\t')).join('\n') +
    '\n';
  files['data/levels/ref-word-freq.tsv'] =
    header([`Columns: lemma_norm, zipf. Words with Zipf >= ${FREQ_MIN_ZIPF}, plus every list word.`]) +
    '\n' +
    freqRows.map(([w, z]) => `${w}\t${z.toFixed(2)}`).join('\n') +
    '\n';
  files['data/levels/client-levels.tsv'] =
    header([
      'Columns: lemma, zipf (empty: unknown), entries separated by "|".',
      'Entry: pos:cefr:src[:cefr_tr:reason_tr]; pos n v j(adj) r(adv) p c o(pron) d i x(other); src j=CEFR-J o=Octanove.',
      `Words without entries: frequency only. Lemmas: ${client.size}; frequency-only words have Zipf >= ${clientMinZipf}.`,
      `@min_zipf ${clientMinZipf}`,
    ]) +
    '\n' +
    [...client.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([w, e]) => `${w}\t${e.zipf === null ? '' : e.zipf.toFixed(2)}\t${e.entries.join('|')}`)
      .join('\n') +
    '\n';

  const sql: string[] = [
    '-- GENERATED by scripts/build-levels.ts. Do not edit by hand.',
    ...LICENSE_HEADER.map((l) => `-- ${l}`),
    '--',
    '-- Loads ref_word_levels (CEFR-J + Octanove) and ref_word_freq (wordfreq). Idempotent: a',
    '-- later data version is a new migration with the same statements; the Turkish-learner',
    '-- corrections (tr_* columns) are kept, and are ignored by level resolution once the list',
    '-- level they were made for (tr_base_cefr) changes.',
    '',
  ];
  for (let i = 0; i < refs.length; i += 1000) {
    sql.push(
      'insert into public.ref_word_levels (lemma_norm, pos, cefr, source, source_version) values',
      refs
        .slice(i, i + 1000)
        .map(
          (r) =>
            `(${sqlString(r.lemma_norm)},${sqlString(r.pos)},'${r.cefr}','${r.source}',${sqlString(r.source_version)})`,
        )
        .join(',\n'),
      'on conflict (lemma_norm, pos, source) do update set cefr = excluded.cefr, source_version = excluded.source_version;',
      '',
    );
  }
  for (let i = 0; i < freqRows.length; i += 2000) {
    sql.push(
      'insert into public.ref_word_freq (lemma_norm, zipf) values',
      freqRows
        .slice(i, i + 2000)
        .map(([w, z]) => `(${sqlString(w)},${z.toFixed(2)})`)
        .join(',\n'),
      'on conflict (lemma_norm) do update set zipf = excluded.zipf;',
      '',
    );
  }
  sql.push(
    `insert into public.ref_sources (key, name, version, license, url, sha256, rows, coverage_min_zipf) values`,
    [
      `('cefrj', ${sqlString(SOURCES.cefrj.name)}, ${sqlString(SOURCES.cefrj.version)}, ${sqlString(SOURCES.cefrj.license)}, ${sqlString(SOURCES.cefrj.url)}, '${SOURCES.cefrj.sha256}', ${refs.filter((r) => r.source === 'cefrj').length}, null)`,
      `('octanove', ${sqlString(SOURCES.octanove.name)}, ${sqlString(SOURCES.octanove.version)}, ${sqlString(SOURCES.octanove.license)}, ${sqlString(SOURCES.octanove.url)}, '${SOURCES.octanove.sha256}', ${refs.filter((r) => r.source === 'octanove').length}, null)`,
      `('wordfreq', ${sqlString(SOURCES.wordfreq.name)}, ${sqlString(SOURCES.wordfreq.version)}, ${sqlString(SOURCES.wordfreq.license)}, ${sqlString(SOURCES.wordfreq.url)}, '${SOURCES.wordfreq.sha256}', ${freqRows.length}, ${FREQ_MIN_ZIPF.toFixed(2)})`,
    ].join(',\n'),
    'on conflict (key) do update set name = excluded.name, version = excluded.version, license = excluded.license,',
    '  url = excluded.url, sha256 = excluded.sha256, rows = excluded.rows,',
    '  coverage_min_zipf = excluded.coverage_min_zipf, loaded_at = now();',
    '',
  );
  files['supabase/migrations/20261021001200_ref_word_data.sql'] = sql.join('\n');

  const summary = {
    ref_word_levels: refs.length,
    ref_cefrj: refs.filter((r) => r.source === 'cefrj').length,
    ref_octanove: refs.filter((r) => r.source === 'octanove').length,
    list_lemmas: listLevel.size,
    ref_word_freq: freqRows.length,
    client_lemmas: client.size,
    client_min_zipf: clientMinZipf,
    tr_corrections_in_client: corrections.length,
    calibration: {
      words: calib.length,
      fitted_thresholds: fitted,
      fitted_agreement: agreement(fitted),
      used_thresholds: ZIPF_THRESHOLDS,
      used_agreement: agreement(ZIPF_THRESHOLDS),
      plan_thresholds: [5.5, 5.0, 4.5, 4.0, 3.3],
      plan_agreement: agreement([5.5, 5.0, 4.5, 4.0, 3.3]),
    },
  };
  const outputs = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, { sha256: sha256(v), bytes: Buffer.byteLength(v) }]),
  );
  files['data/levels/manifest.json'] =
    JSON.stringify(
      {
        generated_by: 'scripts/build-levels.ts',
        license: 'CC BY-SA 4.0 (derived data); see docs/licenses.md',
        sources: SOURCES,
        olp_commit: OLP_COMMIT,
        summary,
        outputs,
      },
      null,
      2,
    ) + '\n';
  return { files, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const { files, summary } = await build();
  let bad = 0;
  for (const [rel, content] of Object.entries(files)) {
    const file = join(ROOT, rel);
    if (check) {
      const cur = existsSync(file) ? readFileSync(file, 'utf8') : null;
      if (cur !== content) {
        console.error(`out of date: ${rel}`);
        bad++;
      }
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (bad) process.exit(1);
}
