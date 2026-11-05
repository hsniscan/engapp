// Tatoeba English–Turkish sentence pairs for the bulk example job (decision 0074).
//
// Licence: Tatoeba sentences are CC BY 2.0 FR (tatoeba.org/downloads); every shipped sentence
// keeps both sentence ids and both authors, so the app can credit them. Tatoeba AUDIO is not
// used (its licence is set per contributor and is often non-commercial).
//
// Two input formats, both read line by line (the workflow downloads and unpacks them):
//   official  per-language exports: eng_sentences_detailed.tsv and tur_sentences_detailed.tsv
//             (id, lang, text, username, added, modified) plus eng-tur_links.tsv (eng id, tur id)
//   manythings tur.txt from manythings.org/anki/tur-eng.zip (built from Tatoeba):
//             "english \t turkish \t CC-BY 2.0 (France) Attribution: tatoeba.org #1 (CK) & #2 (x)"

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export const TATOEBA_LICENSE = 'CC BY 2.0 FR';

/** One English sentence with one Turkish translation, both with their Tatoeba id and author. */
export interface TatoebaPair {
  en: string;
  tr: string;
  en_id: number;
  tr_id: number;
  /** Tatoeba usernames; '' when the export has none (an orphan sentence). */
  en_by: string;
  tr_by: string;
}

/** A sentence of a *_sentences_detailed.tsv export. */
export interface TatoebaSentence {
  id: number;
  lang: string;
  text: string;
  user: string;
}

const clean = (s: string) => s.replace(/\s+/gu, ' ').trim();

/** One line of a sentences_detailed export, or null for a malformed line. */
export function parseDetailedLine(line: string): TatoebaSentence | null {
  const f = line.split('\t');
  if (f.length < 3) return null;
  const id = Number(f[0]);
  const text = clean(f[2] ?? '');
  if (!Number.isInteger(id) || id <= 0 || !text) return null;
  const user = (f[3] ?? '').trim();
  return { id, lang: (f[1] ?? '').trim(), text, user: user === '\\N' ? '' : user };
}

/** One line of a links export: [sentence id, translation id], or null. */
export function parseLinkLine(line: string): [number, number] | null {
  const [a, b] = line.split('\t');
  const x = Number(a);
  const y = Number(b);
  return Number.isInteger(x) && Number.isInteger(y) && x > 0 && y > 0 ? [x, y] : null;
}

const ATTRIBUTION = /#(\d+)\s*\(([^)]*)\)\s*&\s*#(\d+)\s*\(([^)]*)\)/u;

/** One line of manythings' tur.txt, or null when it has no usable attribution. */
export function parseManythingsLine(line: string): TatoebaPair | null {
  const [en, tr, attr] = line.split('\t');
  if (!en || !tr || !attr) return null;
  const m = ATTRIBUTION.exec(attr);
  if (!m) return null;
  return {
    en: clean(en),
    tr: clean(tr),
    en_id: Number(m[1]),
    en_by: m[2]!.trim(),
    tr_id: Number(m[3]),
    tr_by: m[4]!.trim(),
  };
}

async function* lines(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}

/**
 * Pairs from the official exports. The links are read first, so only the English and Turkish
 * sentences that have a translation are kept in memory. An English sentence with several
 * Turkish translations gives several pairs.
 */
export async function readOfficialPairs(paths: {
  links: string;
  eng: string;
  tur: string;
}): Promise<TatoebaPair[]> {
  const links: [number, number][] = [];
  const engIds = new Set<number>();
  const turIds = new Set<number>();
  for await (const line of lines(paths.links)) {
    const l = parseLinkLine(line);
    if (!l) continue;
    links.push(l);
    engIds.add(l[0]);
    turIds.add(l[1]);
  }
  const keep = async (path: string, ids: Set<number>, lang: string) => {
    const out = new Map<number, TatoebaSentence>();
    for await (const line of lines(path)) {
      const s = parseDetailedLine(line);
      if (s && ids.has(s.id) && (!s.lang || s.lang === lang)) out.set(s.id, s);
    }
    return out;
  };
  const eng = await keep(paths.eng, engIds, 'eng');
  const tur = await keep(paths.tur, turIds, 'tur');
  return joinPairs(links, eng, tur);
}

/** Joins links with the sentences they name (links whose sentences are missing are skipped). */
export function joinPairs(
  links: Iterable<[number, number]>,
  eng: ReadonlyMap<number, TatoebaSentence>,
  tur: ReadonlyMap<number, TatoebaSentence>,
): TatoebaPair[] {
  const out: TatoebaPair[] = [];
  const seen = new Set<string>();
  for (const [a, b] of links) {
    const e = eng.get(a);
    const t = tur.get(b);
    if (!e || !t) continue;
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ en: e.text, tr: t.text, en_id: e.id, tr_id: t.id, en_by: e.user, tr_by: t.user });
  }
  return out;
}

export async function readManythingsPairs(path: string): Promise<TatoebaPair[]> {
  const out: TatoebaPair[] = [];
  for await (const line of lines(path)) {
    const p = parseManythingsLine(line);
    if (p) out.push(p);
  }
  return out;
}

/** The attribution stored with a shipped Tatoeba sentence (lexicon_examples.attribution). */
export interface TatoebaAttribution {
  license: typeof TATOEBA_LICENSE;
  en_id: number;
  en_by: string;
  tr_id: number;
  tr_by: string;
  /** The review corrected the Turkish translation (CC BY: changes are indicated). */
  tr_edited?: true;
}

export function attributionOf(p: TatoebaPair): TatoebaAttribution {
  return { license: TATOEBA_LICENSE, en_id: p.en_id, en_by: p.en_by, tr_id: p.tr_id, tr_by: p.tr_by };
}
