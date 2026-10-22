// Word levels on the client (v0.2 İP2). The rule is the server's own
// (supabase/functions/_shared/level.ts), so a level computed here is the one the server
// would store. Sources of a level, best first:
//   1. the user's own level for the note (notes.level_override, synced, this user only);
//   2. the level stored with the shared lexicon sense (resolved by the server, with the AI
//      guess and the Turkish-learner correction);
//   3. the rule on the client level file (data/levels/client-levels.tsv): guests, offline,
//      senses added by hand, and lexicon senses the server has not rated yet.
import {
  CEFR,
  levelRank,
  resolveLevel,
  type ResolvedLevel,
  type RefEntry,
  type RefLookup,
  type WordRefs,
} from '../../supabase/functions/_shared/level';
import type { CefrLevel, LevelSource, LexiconSense, Note, Sense } from './types';

export { CEFR, levelRank, resolveLevel, type ResolvedLevel, type RefLookup };

/** The client level file, parsed. */
export interface LevelData {
  lookup: RefLookup;
  /** Frequency coverage of the file ("@min_zipf"); null = unknown. */
  minZipf: number | null;
  size: number;
}

export interface WordLevel {
  /** The level shown. */
  cefr: CefrLevel;
  /** 'user': the user's own level. */
  source: LevelSource | 'user';
  /** List level before the Turkish-learner correction (list sources only). */
  list_cefr: CefrLevel | null;
  /** Short Turkish reason of the correction. */
  reason_tr: string | null;
  /** The computed level ("Otomatik"), also when the user's own level is shown. */
  auto: ResolvedLevel | null;
}

const POS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  j: 'adjective',
  r: 'adverb',
  p: 'preposition',
  c: 'conjunction',
  o: 'pronoun',
  d: 'determiner',
  i: 'interjection',
  x: 'other',
};

const asCefr = (s: string | undefined): CefrLevel | null =>
  s && (CEFR as readonly string[]).includes(s) ? (s as CefrLevel) : null;

/**
 * Parses data/levels/client-levels.tsv: "lemma \t zipf \t entries", entries separated by
 * "|", each "pos:cefr:src[:cefr_tr:reason_tr]" (scripts/build-levels.ts). Bad lines are skipped.
 */
export function parseClientLevels(text: string): LevelData {
  const map = new Map<string, WordRefs>();
  let minZipf: number | null = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^# @min_zipf ([\d.]+)/.exec(line);
      if (m) minZipf = Number(m[1]);
      continue;
    }
    const [lemma, z, entries] = line.split('\t');
    if (!lemma) continue;
    const zipf = z ? Number(z) : null;
    const refs: RefEntry[] = [];
    for (const e of entries ? entries.split('|') : []) {
      const [p, cefr, src, trCefr, ...reason] = e.split(':');
      const level = asCefr(cefr);
      const pos = POS[p ?? ''];
      if (!level || !pos || (src !== 'j' && src !== 'o')) continue;
      refs.push({
        pos,
        cefr: level,
        source: src === 'j' ? 'cefrj' : 'octanove',
        tr_cefr: asCefr(trCefr),
        tr_reason: reason.length ? reason.join(':') : null,
      });
    }
    map.set(lemma, { refs, zipf: zipf !== null && Number.isFinite(zipf) ? zipf : null });
  }
  return { lookup: (l) => map.get(l), minZipf, size: map.size };
}

/** The level stored with a lexicon sense, if the server has rated it. */
export function storedLevel(lex: LexiconSense | undefined): ResolvedLevel | null {
  if (!lex?.cefr || !lex.cefr_source) return null;
  return {
    cefr: lex.cefr,
    source: lex.cefr_source,
    list_cefr: lex.cefr_list ?? null,
    reason_tr: lex.cefr_reason_tr ?? null,
  };
}

/** Computed level of one sense of a note (sources 2 and 3 above). */
export function senseLevel(
  note: Pick<Note, 'term_norm' | 'term_type'>,
  sense: Pick<Sense, 'pos'> | null,
  lex: LexiconSense | undefined,
  data: LevelData | null,
): ResolvedLevel | null {
  // A contrast card (v0.3 İP6) is two words, not one: no level of its own.
  if (note.term_type === 'contrast') return null;
  const stored = storedLevel(lex);
  if (stored) return stored;
  if (!data) return null;
  const termType = lex?.term_type ?? note.term_type;
  // A root/affix card (İP6) is not a word: it has no CEFR level.
  if (termType === 'affix') return null;
  return resolveLevel(
    {
      lemma_norm: lex?.lemma_norm ?? note.term_norm,
      term_type: termType,
      pos: sense?.pos ?? lex?.pos ?? null,
      cefr_guess: null,
    },
    data.lookup,
    { minZipf: data.minZipf },
  );
}

/** Applies the user's own level. */
export function withOverride(auto: ResolvedLevel | null, override: CefrLevel | null): WordLevel | null {
  if (override) return { cefr: override, source: 'user', list_cefr: null, reason_tr: null, auto };
  return auto ? { ...auto, auto } : null;
}

/**
 * The level of a note: its first sense that has a level (senses in display order; the first
 * sense is the meaning the word was added for), else the term alone; then the user's own level.
 */
export function noteLevel(
  note: Pick<Note, 'term_norm' | 'term_type' | 'level_override'>,
  senses: Pick<Sense, 'pos' | 'lexicon_sense_id'>[],
  lexOf: (id: string) => LexiconSense | undefined,
  data: LevelData | null,
): WordLevel | null {
  let auto: ResolvedLevel | null = null;
  for (const s of senses) {
    auto = senseLevel(note, s, s.lexicon_sense_id ? lexOf(s.lexicon_sense_id) : undefined, data);
    if (auto) break;
  }
  auto ??= senseLevel(note, null, undefined, data);
  return withOverride(auto, note.level_override ?? null);
}

/** Sort key: A1 = 0 … C2 = 5; unknown last. */
export const levelSortKey = (l: WordLevel | null | undefined): number =>
  l ? levelRank(l.cefr) : CEFR.length;
