// Lexicon pre-match: find dictionary forms that may occur in a text chunk, so the
// existing senses of those terms can be offered to the model (it then answers with a
// sense id instead of regenerating content). Recall matters more than precision: a
// form that is not in the lexicon simply finds nothing.

import { normalizeLemma } from './text.ts';

export interface Token {
  text: string; // as in the chunk
  norm: string; // lower-case, folded apostrophes
  index: number; // offset in the chunk
}

const WORD_RE = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    out.push({ text: m[0], norm: normalizeLemma(m[0]), index: m.index ?? 0 });
  }
  return out;
}

/** Very common function words: never looked up on their own and never start an n-gram. */
export const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'nor',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'as',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'our',
  'their',
  'not',
  'no',
  'so',
  'if',
  'than',
  'then',
  'there',
  'here',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'will',
  'would',
  'can',
  'could',
  'shall',
  'should',
  'may',
  'might',
  'must',
  's',
  't',
]);

// Irregular forms -> base form (verbs, plurals, comparatives). Not exhaustive: a miss
// only means the model generates the sense instead of reusing it. Null prototype: a text
// word like "constructor" or "toString" must not find Object.prototype members.
const IRREGULAR: Record<string, string[]> = Object.assign(Object.create(null) as Record<string, string[]>, {
  arose: ['arise'],
  arisen: ['arise'],
  awoke: ['awake'],
  awoken: ['awake'],
  bore: ['bear'],
  borne: ['bear'],
  beat: ['beat'],
  beaten: ['beat'],
  became: ['become'],
  began: ['begin'],
  begun: ['begin'],
  bent: ['bend'],
  bet: ['bet'],
  bound: ['bind'],
  bit: ['bite'],
  bitten: ['bite'],
  bled: ['bleed'],
  blew: ['blow'],
  blown: ['blow'],
  broke: ['break'],
  broken: ['break'],
  bred: ['breed'],
  brought: ['bring'],
  built: ['build'],
  burnt: ['burn'],
  burst: ['burst'],
  bought: ['buy'],
  caught: ['catch'],
  chose: ['choose'],
  chosen: ['choose'],
  clung: ['cling'],
  came: ['come'],
  cost: ['cost'],
  crept: ['creep'],
  cut: ['cut'],
  dealt: ['deal'],
  dug: ['dig'],
  did: ['do'],
  done: ['do'],
  drew: ['draw'],
  drawn: ['draw'],
  dreamt: ['dream'],
  drank: ['drink'],
  drunk: ['drink'],
  drove: ['drive'],
  driven: ['drive'],
  ate: ['eat'],
  eaten: ['eat'],
  fell: ['fall'],
  fallen: ['fall'],
  fed: ['feed'],
  felt: ['feel'],
  fought: ['fight'],
  found: ['find'],
  fled: ['flee'],
  flung: ['fling'],
  flew: ['fly'],
  flown: ['fly'],
  forbade: ['forbid'],
  forbidden: ['forbid'],
  forgot: ['forget'],
  forgotten: ['forget'],
  forgave: ['forgive'],
  forgiven: ['forgive'],
  froze: ['freeze'],
  frozen: ['freeze'],
  got: ['get'],
  gotten: ['get'],
  gave: ['give'],
  given: ['give'],
  went: ['go'],
  gone: ['go'],
  ground: ['grind'],
  grew: ['grow'],
  grown: ['grow'],
  hung: ['hang'],
  heard: ['hear'],
  hid: ['hide'],
  hidden: ['hide'],
  hit: ['hit'],
  held: ['hold'],
  hurt: ['hurt'],
  kept: ['keep'],
  knelt: ['kneel'],
  knew: ['know'],
  known: ['know'],
  laid: ['lay'],
  led: ['lead'],
  leant: ['lean'],
  leapt: ['leap'],
  learnt: ['learn'],
  left: ['leave'],
  lent: ['lend'],
  let: ['let'],
  lay: ['lie'],
  lain: ['lie'],
  lit: ['light'],
  lost: ['lose'],
  made: ['make'],
  meant: ['mean'],
  met: ['meet'],
  mistook: ['mistake'],
  mistaken: ['mistake'],
  overcame: ['overcome'],
  paid: ['pay'],
  put: ['put'],
  quit: ['quit'],
  read: ['read'],
  rode: ['ride'],
  ridden: ['ride'],
  rang: ['ring'],
  rung: ['ring'],
  rose: ['rise'],
  risen: ['rise'],
  ran: ['run'],
  said: ['say'],
  saw: ['see'],
  seen: ['see'],
  sought: ['seek'],
  sold: ['sell'],
  sent: ['send'],
  set: ['set'],
  shook: ['shake'],
  shaken: ['shake'],
  shed: ['shed'],
  shone: ['shine'],
  shot: ['shoot'],
  showed: ['show'],
  shown: ['show'],
  shrank: ['shrink'],
  shrunk: ['shrink'],
  shut: ['shut'],
  sang: ['sing'],
  sung: ['sing'],
  sank: ['sink'],
  sunk: ['sink'],
  sat: ['sit'],
  slept: ['sleep'],
  slid: ['slide'],
  spoke: ['speak'],
  spoken: ['speak'],
  sped: ['speed'],
  spent: ['spend'],
  spun: ['spin'],
  spread: ['spread'],
  sprang: ['spring'],
  sprung: ['spring'],
  stood: ['stand'],
  stole: ['steal'],
  stolen: ['steal'],
  stuck: ['stick'],
  stung: ['sting'],
  strode: ['stride'],
  struck: ['strike'],
  strove: ['strive'],
  striven: ['strive'],
  swore: ['swear'],
  sworn: ['swear'],
  swept: ['sweep'],
  swam: ['swim'],
  swum: ['swim'],
  swung: ['swing'],
  took: ['take'],
  taken: ['take'],
  taught: ['teach'],
  tore: ['tear'],
  torn: ['tear'],
  told: ['tell'],
  thought: ['think'],
  threw: ['throw'],
  thrown: ['throw'],
  understood: ['understand'],
  undertook: ['undertake'],
  undertaken: ['undertake'],
  upset: ['upset'],
  woke: ['wake'],
  woken: ['wake'],
  wore: ['wear'],
  worn: ['wear'],
  wove: ['weave'],
  woven: ['weave'],
  wept: ['weep'],
  won: ['win'],
  wound: ['wind'],
  withdrew: ['withdraw'],
  withdrawn: ['withdraw'],
  wrote: ['write'],
  written: ['write'],
  was: ['be'],
  were: ['be'],
  been: ['be'],
  is: ['be'],
  are: ['be'],
  am: ['be'],
  has: ['have'],
  had: ['have'],
  does: ['do'],
  children: ['child'],
  men: ['man'],
  women: ['woman'],
  people: ['person'],
  mice: ['mouse'],
  feet: ['foot'],
  teeth: ['tooth'],
  geese: ['goose'],
  data: ['datum', 'data'],
  criteria: ['criterion'],
  phenomena: ['phenomenon'],
  analyses: ['analysis'],
  crises: ['crisis'],
  theses: ['thesis'],
  lives: ['life'],
  knives: ['knife'],
  wives: ['wife'],
  leaves: ['leaf', 'leave'],
  halves: ['half'],
  better: ['good', 'well'],
  best: ['good', 'well'],
  worse: ['bad'],
  worst: ['bad'],
  further: ['far', 'further'],
  farther: ['far'],
  less: ['little', 'less'],
  least: ['little'],
  "one's": ["one's"],
});

const VOWEL = /[aeiou]/;

/** Candidate base forms of one lower-case word (always includes the word itself). */
export function lemmaForms(word: string): string[] {
  const w = normalizeLemma(word);
  const forms = new Set<string>([w]);
  for (const f of IRREGULAR[w] ?? []) forms.add(f);
  const add = (f: string) => {
    if (f.length >= 2) forms.add(f);
  };
  const undouble = (stem: string) => {
    // stopped -> stop, bigger -> big (doubled final consonant)
    if (
      stem.length >= 3 &&
      stem.at(-1) === stem.at(-2) &&
      !VOWEL.test(stem.at(-1)!) &&
      !/(ll|ss|zz|ff)$/.test(stem)
    ) {
      add(stem.slice(0, -1));
    }
  };

  if (w.length > 3 && w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.length > 3 && /(ses|xes|zes|ches|shes|oes)$/.test(w)) add(w.slice(0, -2));
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith("'s")) add(w.slice(0, -2));

  if (w.length > 4 && w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  if (w.length > 3 && w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    add(stem);
    add(stem + 'e');
    undouble(stem);
  }

  if (w.length > 4 && w.endsWith('ying')) add(w.slice(0, -4) + 'ie');
  if (w.length > 4 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    add(stem);
    add(stem + 'e');
    undouble(stem);
  }

  if (w.length > 4 && w.endsWith('ier')) add(w.slice(0, -3) + 'y');
  if (w.length > 5 && w.endsWith('iest')) add(w.slice(0, -4) + 'y');
  if (w.length > 3 && w.endsWith('er')) {
    const stem = w.slice(0, -2);
    add(stem);
    add(stem + 'e');
    undouble(stem);
  }
  if (w.length > 4 && w.endsWith('est')) {
    const stem = w.slice(0, -3);
    add(stem);
    add(stem + 'e');
    undouble(stem);
  }
  return [...forms];
}

export interface PrematchOptions {
  maxNgram?: number; // longest multi-word expression looked up (default 4)
  maxForms?: number; // cap on returned forms (default 5000, the SQL side's slice)
}

/**
 * All lemma_norm values worth looking up for a chunk: base forms of content words,
 * plus 2..maxNgram-word sequences with the first word in each of its base forms
 * ("gave up" -> "gave up", "give up"). Multi-word sequences do not cross sentence
 * punctuation. Ordered unigrams first, then by n-gram length, de-duplicated.
 */
export function prematchForms(text: string, opts: PrematchOptions = {}): string[] {
  const maxNgram = opts.maxNgram ?? 4;
  const maxForms = opts.maxForms ?? 5000;
  const tokens = tokenize(text);
  const buckets: Set<string>[] = Array.from({ length: maxNgram }, () => new Set<string>());

  // Sentence/clause breaks between tokens.
  const breakBefore: boolean[] = tokens.map((t, i) => {
    if (i === 0) return true;
    const prev = tokens[i - 1]!;
    const between = text.slice(prev.index + prev.text.length, t.index);
    return /[.!?;:()"\n\r]|,/.test(between);
  });

  const formsCache = new Map<string, string[]>();
  const formsOf = (w: string) => {
    let f = formsCache.get(w);
    if (!f) {
      f = lemmaForms(w);
      formsCache.set(w, f);
    }
    return f;
  };

  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i]!.norm;
    if (!FUNCTION_WORDS.has(first) && first.length >= 2) {
      for (const f of formsOf(first)) buckets[0]!.add(f);
    }
    if (FUNCTION_WORDS.has(first) && !IRREGULAR[first]) continue;
    let tail = '';
    for (let n = 2; n <= maxNgram && i + n - 1 < tokens.length; n++) {
      const j = i + n - 1;
      if (breakBefore[j]) break;
      tail += ' ' + tokens[j]!.norm;
      for (const f of formsOf(first)) buckets[n - 1]!.add(f + tail);
    }
  }

  const out: string[] = [];
  for (const b of buckets) {
    for (const f of b) {
      if (out.length >= maxForms) return out;
      out.push(f);
    }
  }
  return out;
}

/** Base-form candidates for a term typed by the user ("gave up" -> ["gave up", "give up"]). */
export function termForms(term: string): string[] {
  const norm = normalizeLemma(term);
  const words = norm.split(' ');
  const forms = new Set<string>([norm]);
  if (words.length === 1) {
    for (const f of lemmaForms(norm)) forms.add(f);
  } else if (words.length > 1) {
    const rest = words.slice(1).join(' ');
    for (const f of lemmaForms(words[0]!)) forms.add(`${f} ${rest}`);
  }
  return [...forms];
}
