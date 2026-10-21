// Notes that belong to an English term in a language pair (`lexicon_pair_notes`): for now the
// hand-written "yanıltıcı benzer" (false friend) list. Pure: parsing of the reviewable
// Markdown table, lookup by term and the dismiss/report filter.
import { normalizeTerm } from './normalize.ts';

export type LangPair = 'en-tr';
export type PairNoteKind = 'false_friend' | 'mnemonic_suggestion';

export interface FalseFriendContent {
  /** The Turkish look-alike ("aktüel"). */
  tr_word: string;
  /** What the English term means, in Turkish ("aslında, gerçekte"). */
  en_meaning_tr: string;
  /** What the Turkish word means ("güncel"). */
  tr_meaning_tr: string;
  /** The Turkish word's English equivalent ("current, topical"), if useful. */
  tr_meaning_en: string | null;
  /** full: unrelated meanings; partial: overlapping meanings with a trap. */
  strength: 'full' | 'partial';
  note_tr: string | null;
}

export interface FalseFriendNote {
  /** Stable key: `${term_norm}|${normalized tr_word}` (also the server's content key). */
  key: string;
  term: string;
  term_norm: string;
  lang_pair: LangPair;
  kind: 'false_friend';
  curated: boolean;
  content: FalseFriendContent;
}

export const falseFriendKey = (termNorm: string, trWord: string): string =>
  `${termNorm}|${trWord.normalize('NFC').toLocaleLowerCase('tr').trim()}`;

const HEADER = ['ingilizce', 'benzeyen türkçe', 'ingilizcesi', 'türkçesi', 'ing. karşılığı', 'tür', 'not'];

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Parses the table in data/reference/false-friends.en-tr.md. Rows with a missing required
 * field, an unknown "Tür" or a duplicate (term, Turkish word) are reported, not dropped
 * silently, so a typo in the owner's edit fails the build.
 */
export function parseFalseFriendTable(md: string): { notes: FalseFriendNote[]; errors: string[] } {
  const notes: FalseFriendNote[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let inTable = false;
  for (const [i, raw] of md.split('\n').entries()) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const c = cells(line);
    if (c.map((x) => x.toLocaleLowerCase('tr').replace(/i̇/g, 'i')).join('|') === HEADER.join('|')) {
      inTable = true;
      continue;
    }
    if (!inTable || /^-+$/.test(c[0] ?? '')) continue;
    const [term = '', tr = '', enTr = '', trTr = '', trEn = '', kind = '', note = ''] = c;
    const where = `line ${i + 1}`;
    if (c.length !== HEADER.length) {
      errors.push(`${where}: expected ${HEADER.length} columns, got ${c.length}`);
      continue;
    }
    if (!term || !tr || !enTr || !trTr) {
      errors.push(`${where}: İngilizce, Benzeyen Türkçe, İngilizcesi and Türkçesi are required`);
      continue;
    }
    if (kind !== 'tam' && kind !== 'kısmi') {
      errors.push(`${where}: Tür must be "tam" or "kısmi"`);
      continue;
    }
    const termNorm = normalizeTerm(term);
    const key = falseFriendKey(termNorm, tr);
    if (seen.has(key)) {
      errors.push(`${where}: duplicate ${term} / ${tr}`);
      continue;
    }
    seen.add(key);
    notes.push({
      key,
      term,
      term_norm: termNorm,
      lang_pair: 'en-tr',
      kind: 'false_friend',
      curated: true,
      content: {
        tr_word: tr,
        en_meaning_tr: enTr,
        tr_meaning_tr: trTr,
        tr_meaning_en: trEn || null,
        strength: kind === 'tam' ? 'full' : 'partial',
        note_tr: note || null,
      },
    });
  }
  return { notes, errors };
}

/** Feedback the user gave on a note: hidden either way; "reported" also marks it wrong. */
export type PairNoteVerdict = 'dismissed' | 'reported';

/** The false-friend warnings to show for a term, without the ones the user dismissed. */
export function falseFriendsFor(
  term: string,
  notes: readonly FalseFriendNote[] | ReadonlyMap<string, FalseFriendNote[]>,
  hidden: ReadonlySet<string> = new Set(),
): FalseFriendNote[] {
  const norm = normalizeTerm(term);
  if (!norm) return [];
  const list: readonly FalseFriendNote[] =
    'get' in notes ? (notes.get(norm) ?? []) : notes.filter((n) => n.term_norm === norm);
  return list.filter((n) => !hidden.has(n.key));
}

/** Index by term_norm for constant-time lookups on the card back. */
export function indexFalseFriends(notes: readonly FalseFriendNote[]): Map<string, FalseFriendNote[]> {
  const out = new Map<string, FalseFriendNote[]>();
  for (const n of notes) {
    const list = out.get(n.term_norm);
    if (list) list.push(n);
    else out.set(n.term_norm, [n]);
  }
  return out;
}
