// Example rotation (v0.5 İP10, docs/decisions/0052-smart-review.md): sentences from the user's
// own reading texts that contain a card's word, and the rule that picks a different sentence
// on every review. Pure: the data layer (data/textSentences.ts) reads the texts and caches the
// results; nothing here reaches the network, and user text never leaves the device.
import { splitSentences } from './chunking';
import { normalizeTerm } from './normalize';
import type { Span } from './recognition';

/** Sentences per word taken from the user's texts (newest text first). */
export const MAX_TEXT_SENTENCES = 4;
/** A usable example sentence: long enough to give context, short enough for a card. */
export const MIN_SENTENCE_CHARS = 20;
export const MAX_SENTENCE_CHARS = 260;
/** Paragraphs searched per text at most (a 300k-character book stays cheap). */
const MAX_PARAGRAPHS = 4000;

// A few frequent irregular verbs (their past and participle forms). Everything else gets the
// regular endings; a miss only means one sentence fewer, never a wrong one.
const IRREGULAR: Record<string, readonly string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  get: ['gets', 'got', 'gotten', 'getting'],
  make: ['made'],
  take: ['took', 'taken'],
  come: ['came'],
  see: ['saw', 'seen'],
  know: ['knew', 'known'],
  give: ['gave', 'given'],
  find: ['found'],
  think: ['thought'],
  tell: ['told'],
  become: ['became'],
  leave: ['left'],
  feel: ['felt'],
  bring: ['brought'],
  begin: ['began', 'begun', 'beginning'],
  keep: ['kept'],
  hold: ['held'],
  write: ['wrote', 'written'],
  stand: ['stood'],
  hear: ['heard'],
  let: ['letting'],
  mean: ['meant'],
  set: ['setting'],
  meet: ['met'],
  run: ['ran', 'running'],
  pay: ['paid'],
  sit: ['sat', 'sitting'],
  speak: ['spoke', 'spoken'],
  lie: ['lay', 'lain', 'lying', 'lied'],
  lead: ['led'],
  read: ['reading'],
  grow: ['grew', 'grown'],
  lose: ['lost'],
  fall: ['fell', 'fallen'],
  send: ['sent'],
  build: ['built'],
  understand: ['understood'],
  draw: ['drew', 'drawn'],
  break: ['broke', 'broken'],
  spend: ['spent'],
  cut: ['cutting'],
  rise: ['rose', 'risen'],
  drive: ['drove', 'driven'],
  buy: ['bought'],
  wear: ['wore', 'worn'],
  choose: ['chose', 'chosen'],
  seek: ['sought'],
  throw: ['threw', 'thrown'],
  catch: ['caught'],
  deal: ['dealt'],
  win: ['won', 'winning'],
  forget: ['forgot', 'forgotten', 'forgetting'],
  sell: ['sold'],
  fight: ['fought'],
  teach: ['taught'],
  eat: ['ate', 'eaten'],
  sleep: ['slept'],
  fly: ['flew', 'flown', 'flies'],
  swim: ['swam', 'swum', 'swimming'],
  sing: ['sang', 'sung'],
  drink: ['drank', 'drunk'],
  shake: ['shook', 'shaken'],
  hide: ['hid', 'hidden'],
  bite: ['bit', 'bitten'],
  freeze: ['froze', 'frozen'],
  steal: ['stole', 'stolen'],
  child: ['children'],
  man: ['men'],
  woman: ['women'],
  person: ['people'],
  foot: ['feet'],
  tooth: ['teeth'],
  mouse: ['mice'],
  good: ['better', 'best'],
  bad: ['worse', 'worst'],
};


/** Part of speech as far as the endings go. */
type FormClass = 'noun' | 'verb' | 'adj' | 'other';

export function formClass(pos: string | null | undefined): FormClass {
  const p = (pos ?? '').toLowerCase();
  if (/^(n|noun)/.test(p)) return 'noun';
  if (/^(v|verb)/.test(p)) return 'verb';
  if (/^(adj|a$|adjective)/.test(p)) return 'adj';
  return 'other';
}

/** "-s" / "-es" / "-ies". */
function sForm(w: string): string {
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** A short consonant-vowel-consonant word doubles its last letter ("stop" → "stopp-"). */
function doubled(w: string): string {
  return w.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(w) ? w + w[w.length - 1]! : w;
}

/** `w` + an ending that starts with a vowel ("-ed", "-ing", "-er", "-est"). */
function vowelEnding(w: string, end: string): string {
  if (end === 'ing') {
    if (/ie$/.test(w)) return `${w.slice(0, -2)}ying`;
    if (/[^e]e$/.test(w)) return `${w.slice(0, -1)}ing`;
    return `${doubled(w)}ing`;
  }
  if (/e$/.test(w)) return `${w}${end.slice(1)}`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}i${end}`;
  return `${doubled(w)}${end}`;
}

/**
 * Regular inflections of one lower-case English word for its word class: nouns their plural,
 * verbs "-s", "-ed", "-ing", adjectives "-er", "-est" (and "-ly" is a different word, so not).
 * Unknown class: "-s", "-ed", "-ing". Words of one or two letters are only themselves.
 */
function regularForms(w: string, cls: FormClass): string[] {
  const out = new Set<string>([w]);
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return [...out];
  if (cls === 'adj') {
    out.add(vowelEnding(w, 'er')).add(vowelEnding(w, 'est'));
    return [...out];
  }
  out.add(sForm(w));
  if (cls === 'noun') return [...out];
  out.add(vowelEnding(w, 'ed')).add(vowelEnding(w, 'ing'));
  return [...out];
}

/**
 * Surface forms to look for: the term, its regular forms and the known irregular ones (an
 * irregular verb keeps "-s" and "-ing" but not "-ed"). A phrase ("give up") varies its first
 * word only; "to go" is searched as "go".
 */
export function wordForms(term: string, pos?: string | null): string[] {
  let t = normalizeTerm(term).replace(/^to /, '');
  t = t.replace(/[^\p{L}\p{N}' -]/gu, '').trim();
  if (!t) return [];
  const words = t.split(' ');
  const head = words[0]!;
  const tail = words.slice(1).join(' ');
  const irregular = Object.hasOwn(IRREGULAR, head) ? IRREGULAR[head] : undefined;
  const cls = tail ? 'verb' : formClass(pos);
  const heads = new Set<string>(
    irregular
      ? [head, ...irregular, ...(head.length >= 3 && cls !== 'adj' ? [sForm(head), vowelEnding(head, 'ing')] : [])]
      : regularForms(head, cls),
  );
  return [...heads].map((h) => (tail ? `${h} ${tail}` : h));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regular expression for all forms, on word boundaries, case-insensitive. */
export function formsPattern(forms: readonly string[]): RegExp | null {
  if (forms.length === 0) return null;
  const alts = [...forms].sort((a, b) => b.length - a.length).map((f) => escape(f).replace(/ /g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}'])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/** A sentence from the user's own text, with where the word is in it. */
export interface TextSentence {
  text: string;
  span: Span;
  /** Turkish translation when the text carries one (a graded library text); else null. */
  tr: string | null;
  /** texts.id it came from (stays on the device). */
  textId: string;
}

/** What the search needs about one text. Plain bodies, or ready sentences with translations. */
export type SearchableText =
  | { id: string; body: string }
  | { id: string; sentences: readonly { en: string; tr: string | null }[] };

const usable = (s: string) => s.length >= MIN_SENTENCE_CHARS && s.length <= MAX_SENTENCE_CHARS && !/\n/.test(s);
const sentenceNorm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Sentences of `texts` (pass them newest first) that contain the term in one of its forms: at
 * most `max`, one per distinct sentence, and never `exclude` (the card's own sentence).
 * Deterministic for the same input.
 */
export function findTextSentences(
  texts: readonly SearchableText[],
  term: string,
  opts: { max?: number; exclude?: readonly (string | null | undefined)[]; pos?: string | null } = {},
): TextSentence[] {
  const max = opts.max ?? MAX_TEXT_SENTENCES;
  const re = formsPattern(wordForms(term, opts.pos));
  if (!re || max <= 0) return [];
  const seen = new Set((opts.exclude ?? []).filter((x): x is string => !!x).map(sentenceNorm));
  const out: TextSentence[] = [];
  const take = (raw: string, tr: string | null, textId: string): boolean => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!usable(text)) return false;
    const m = re.exec(text);
    if (!m) return false;
    const key = sentenceNorm(text);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push({ text, span: [m.index, m.index + m[0].length], tr: tr && tr.trim() ? tr.trim() : null, textId });
    return out.length >= max;
  };
  for (const t of texts) {
    if ('sentences' in t) {
      for (const s of t.sentences) if (re.test(s.en) && take(s.en, s.tr, t.id)) return out;
      continue;
    }
    if (!re.test(t.body)) continue;
    const paragraphs = t.body.split(/\n\s*\n/).slice(0, MAX_PARAGRAPHS);
    for (const p of paragraphs) {
      if (!re.test(p)) continue;
      for (const s of splitSentences(p.replace(/\s*\n\s*/g, ' '))) if (take(s, null, t.id)) return out;
    }
  }
  return out;
}

// ------------------------------------------------------------------ rotation

/** Short stable key of a sentence (FNV-1a 32-bit, hex): what "shown last time" remembers. */
export function sentenceKey(text: string): string {
  let h = 0x811c9dc5;
  const s = sentenceNorm(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The sentence a card showed last, at which answer count (meta, device-local). */
export interface LastShown {
  reps: number;
  key: string;
}

/**
 * The sentence for this showing. One step further after every answer (`reps`), stable while
 * the card is shown (the same `reps` gives the same sentence again), and never the sentence
 * shown at an earlier answer count right before, when there is another one: a list that grew
 * or shrank in between (a new text, a hidden example) would otherwise repeat it.
 */
export function pickRotating<T>(
  list: readonly T[],
  reps: number,
  last: LastShown | null,
  keyOf: (item: T) => string,
): T | null {
  const n = list.length;
  if (n === 0) return null;
  if (last && last.reps === reps) {
    const same = list.find((x) => keyOf(x) === last.key);
    if (same !== undefined) return same;
  }
  const i = ((reps % n) + n) % n;
  if (n > 1 && last && last.reps < reps && keyOf(list[i]!) === last.key) return list[(i + 1) % n]!;
  return list[i]!;
}
