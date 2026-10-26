// What the user knows, per lemma (v0.5 İP1, plan A.3, decision 0043). Pure: data/knowledge.ts
// reads the inputs from Dexie and the level file, this module turns them into the two
// functions every reading screen uses (lemmatize, pKnown).
//
// pKnown(lemma), first rule that applies:
//   1. a function word ("the", "is", "of"): 1;
//   2. the user's own word (notes.term_norm): Pekişiyor, Öğrenildi or Kalıcı 1, Öğreniyor 0.35,
//      Yeni (never answered) at most 0.35 too;
//   3. a "Biliyorum" word (known_terms): 1;
//   4. the level model: the share of words of the lemma's CEFR band the user knows (the
//      weekly level model, domain/levelUpdate.ts), raised for very frequent words (the model's
//      share counts word types; running text is mostly the commonest of them). The band is
//      the word list's level, else the wordfreq Zipf band (the same rule as word levels);
//   5. no level data on the device yet: a neutral 0.6.
// Rules 4–5 are then scaled by settings.reading_offset (the "çok zor / çok kolay" answers).
import { FUNCTION_WORDS, lemmaForms } from '../../supabase/functions/_shared/tokenize';
import { listLevel, zipfBand, type RefLookup } from '../../supabase/functions/_shared/level';
import { normalizeTerm } from './normalize';
import type { WordStage } from './stages';
import { READING_OFFSET_MAX } from './texts';
import type { CefrLevel } from './types';

export interface Knowledge {
  /** Dictionary form of a running word ("went" → "go"); lower case. */
  lemmatize(word: string): string;
  /** Probability 0..1 that the user knows the lemma. */
  pKnown(lemma: string): number;
}

/** Where pKnown's answer came from (the reader colours words by it). */
export type KnowledgeSource = 'function' | 'note' | 'known' | 'model' | 'none';

export interface KnowledgeInput {
  /** Stage of each live counted note, by term_norm (domain/wordStages.ts). */
  stages: ReadonlyMap<string, WordStage>;
  /** Live "Biliyorum" words, by term_norm. */
  known: ReadonlySet<string>;
  /** The level model's share of known words per band, 0..1. */
  bandKnown: Readonly<Record<CefrLevel, number>>;
  /** The client level file; null while it is not on the device. */
  levels: { lookup: RefLookup; minZipf: number | null } | null;
  /** settings.reading_offset (−0.5..0.5); 0 = none. */
  offset: number;
}

export interface KnowledgeModel extends Knowledge {
  source(lemma: string): KnowledgeSource;
  /** Stage of the user's own word for this lemma, or null. */
  stage(lemma: string): WordStage | null;
  /** CEFR band used for a lemma, or null when nothing is known about it. */
  band(lemma: string): CefrLevel | null;
}

export const P_LEARNING = 0.35;
export const P_NO_DATA = 0.6;

/** Very frequent words are almost always known when their band mostly is (see rule 4). */
export function frequencyFactor(zipf: number | null): number {
  if (zipf === null) return 1;
  if (zipf >= 6) return 0.1;
  if (zipf >= 5.5) return 0.25;
  if (zipf >= 5) return 0.5;
  return 1;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clampOffset = (x: number) =>
  Number.isFinite(x) ? Math.min(READING_OFFSET_MAX, Math.max(-READING_OFFSET_MAX, x)) : 0;

/** "won't" → "will", "don't" → "do", "it's" → "it", "children's" → "children". */
function contractionBase(norm: string): string | null {
  const m = /^(.+?)'(t|s|re|ve|ll|d|m)$/.exec(norm);
  if (!m) return null;
  const [, head, tail] = m as unknown as [string, string, string];
  if (tail === 't') {
    if (head === 'won') return 'will';
    if (head === 'can') return 'can';
    if (head === 'shan') return 'shall';
    if (head === 'ain') return 'be';
    return head.endsWith('n') ? head.slice(0, -1) : head;
  }
  return head;
}

export function buildKnowledge(input: KnowledgeInput): KnowledgeModel {
  const { stages, known, bandKnown, levels } = input;
  const offset = clampOffset(input.offset);
  const isOwn = (w: string) => stages.has(w) || known.has(w);
  const refsOf = (w: string) => levels?.lookup(w);
  const lemmaMemo = new Map<string, string>();

  const lemmatizeWord = (norm: string): string => {
    const forms = lemmaForms(norm);
    // 1. the user's own word or a "Biliyorum" word, the written form first.
    for (const f of forms) if (isOwn(f)) return f;
    // 2. the written form when the word list has it, else the first base form it has.
    if (refsOf(norm)?.refs.length) return norm;
    for (const f of forms) if (f !== norm && refsOf(f)?.refs.length) return f;
    // 3. frequency only: the written form, else a base form the frequency data has.
    if (refsOf(norm)) return norm;
    for (const f of forms) if (f !== norm && refsOf(f)) return f;
    return norm;
  };

  const lemmatize = (word: string): string => {
    const norm = normalizeTerm(word);
    const hit = lemmaMemo.get(norm);
    if (hit !== undefined) return hit;
    let out: string;
    if (!norm) out = norm;
    else {
      const base = contractionBase(norm);
      out =
        base && !isOwn(norm) && !refsOf(norm)?.refs.length
          ? lemmatizeWord(base)
          : lemmatizeWord(norm);
    }
    lemmaMemo.set(norm, out);
    return out;
  };

  const band = (lemma: string): CefrLevel | null => {
    if (!levels) return null;
    const entry = levels.lookup(lemma);
    const list = listLevel(entry?.refs, null);
    if (list) return list.cefr;
    if (typeof entry?.zipf === 'number') return zipfBand(entry.zipf);
    // A plain word the frequency data does not hold is rarer than all of it.
    if (levels.minZipf !== null && /^[\p{L}']+$/u.test(lemma)) return 'C2';
    return null;
  };

  const modelP = (lemma: string): number => {
    if (!levels) return P_NO_DATA;
    const b = band(lemma);
    if (b === null) return P_NO_DATA;
    const zipf = levels.lookup(lemma)?.zipf ?? null;
    const q = (1 - clamp01(bandKnown[b])) * frequencyFactor(zipf);
    return 1 - clamp01(q * (1 + offset));
  };

  const source = (lemma: string): KnowledgeSource => {
    if (FUNCTION_WORDS.has(lemma)) return 'function';
    if (stages.has(lemma)) return 'note';
    if (known.has(lemma)) return 'known';
    if (!levels) return 'none';
    return band(lemma) === null ? 'none' : 'model';
  };

  const pMemo = new Map<string, number>();
  const pKnown = (raw: string): number => {
    const lemma = normalizeTerm(raw);
    const hit = pMemo.get(lemma);
    if (hit !== undefined) return hit;
    let p: number;
    const stage = stages.get(lemma);
    if (FUNCTION_WORDS.has(lemma)) p = 1;
    else if (stage) {
      p =
        stage === 'learning'
          ? P_LEARNING
          : stage === 'new'
            ? Math.min(P_LEARNING, modelP(lemma))
            : 1;
    } else if (known.has(lemma)) p = 1;
    else if (lemma.includes('-') && !refsOf(lemma)) {
      // "well-known", "e-mail": as known as its least known part.
      const parts = lemma.split('-').filter(Boolean);
      p = parts.length ? Math.min(...parts.map((x) => pKnown(lemmatize(x)))) : P_NO_DATA;
    } else p = modelP(lemma);
    pMemo.set(lemma, p);
    return p;
  };

  return {
    lemmatize,
    pKnown,
    source,
    stage: (lemma) => stages.get(normalizeTerm(lemma)) ?? null,
    band: (lemma) => band(normalizeTerm(lemma)),
  };
}
