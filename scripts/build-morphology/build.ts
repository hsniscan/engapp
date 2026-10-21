// Pure part of the morphology pipeline: parse the inputs, remove noise, build word families
// and word → morpheme links. No file or network access here (see index.ts), so every rule is
// unit-tested in build.test.ts.

import { INVENTORY, morphynetIndex, type MorphemeDef } from './inventory.ts';

// ------------------------------------------------------------------ vocabulary (wordfreq)

export interface Vocab {
  /** Frequency rank, 0 = most frequent. */
  rank: Map<string, number>;
  /** Zipf value (wordfreq bins are centibels: zipf = 9 − bin / 100). */
  zipf: Map<string, number>;
}

const WORD = /^[a-z]+$/;

/**
 * The `limit` most frequent purely alphabetic lower-case words of a decoded wordfreq
 * `large_en.msgpack.gz` (header map, then one array of words per centibel bin).
 */
export function vocabFromWordfreq(decoded: unknown, limit = 30_000): Vocab {
  if (!Array.isArray(decoded) || typeof decoded[0] !== 'object' || (decoded[0] as { format?: string }).format !== 'cB')
    throw new Error('wordfreq: unexpected file format');
  const rank = new Map<string, number>();
  const zipf = new Map<string, number>();
  for (let bin = 1; bin < decoded.length && rank.size < limit; bin++) {
    const words = decoded[bin];
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      if (typeof w !== 'string' || !WORD.test(w) || rank.has(w)) continue;
      if (w.length < 2 && w !== 'a' && w !== 'i') continue;
      rank.set(w, rank.size);
      zipf.set(w, Math.round((9 - (bin - 1) / 100) * 100) / 100);
      if (rank.size >= limit) break;
    }
  }
  return { rank, zipf };
}

// ------------------------------------------------------------------ MorphyNet

export type Pos = 'N' | 'V' | 'J' | 'R';
export interface Edge {
  source: string;
  target: string;
  sourcePos: Pos;
  targetPos: Pos;
  morpheme: string;
  type: 'prefix' | 'suffix';
}

const POS = new Set(['N', 'V', 'J', 'R']);

/** `eng.derivational.v1.tsv`: source, target, source POS, target POS, morpheme, type. */
export function parseMorphyNet(tsv: string): Edge[] {
  const out: Edge[] = [];
  for (const line of tsv.split('\n')) {
    const f = line.replace(/\r$/, '').split('\t');
    if (f.length < 6) continue;
    const [source, target, sp, tp, morpheme, type] = f as [string, string, string, string, string, string];
    if (!POS.has(sp) || !POS.has(tp) || (type !== 'prefix' && type !== 'suffix')) continue;
    out.push({ source, target, sourcePos: sp as Pos, targetPos: tp as Pos, morpheme, type });
  }
  return out;
}

/** Inflection-like or compounding "morphemes": never a family link. */
const DROP_MORPHEMES = new Set([
  'suffix:s', 'suffix:es', 'suffix:ies', 'suffix:est', 'suffix:ier',
  // compounds: the "morpheme" is a word of its own (sideline, workman, homeland)
  'suffix:man', 'suffix:men', 'suffix:woman', 'suffix:work', 'suffix:land', 'suffix:side', 'suffix:self',
  'suffix:ware', 'suffix:craft', 'suffix:mate', 'suffix:where', 'suffix:way', 'suffix:line', 'suffix:fold',
  'suffix:kin', 'suffix:shire', 'suffix:ton', 'suffix:ley', 'suffix:son',
  'prefix:a', 'prefix:al', 'prefix:to', 'prefix:on', 'prefix:off', 'prefix:up', 'prefix:down', 'prefix:back',
  'prefix:after', 'prefix:for', 'prefix:by', 'prefix:in', 'prefix:homo', 'prefix:e',
]);
/** -ing / -ed forms are kept only as bases of a further derivation (meaning → meaningful). */
const WEAK_SUFFIXES = new Set(['ing', 'ed']);

/** The derived word must still contain most of its base ("moon" → "month" is noise). */
export function sharesStem(e: Pick<Edge, 'source' | 'target' | 'type'>): boolean {
  const n = Math.max(3, e.source.length - 3);
  if (e.source.length < 3) return false;
  return e.type === 'suffix'
    ? e.target.startsWith(e.source.slice(0, n))
    : e.target.endsWith(e.source.slice(-n));
}

/** MorphyNet morpheme strings that may link two words: the inventory's aliases plus -ing/-ed. */
export function allowedMorphemes(defs: MorphemeDef[] = INVENTORY): Set<string> {
  const out = new Set<string>([...WEAK_SUFFIXES].map((m) => `suffix:${m}`));
  for (const key of morphynetIndex(defs).keys()) out.add(key);
  return out;
}

/**
 * Edges between two vocabulary words, without compounds, inflections and spelling noise:
 * - both words in the vocabulary, the affix is a known one (inventory alias or -ing/-ed),
 *   the derived word still contains its base ("moon" → "month" is dropped);
 * - -ing / -ed forms only when they are the base of a further derivation (meaning → meaningful);
 * - one parent per word: "outward" comes from "ward" or from "out", never both, so two free
 *   words joined into a compound cannot bridge two families. The longer base wins.
 */
export function cleanEdges(edges: Edge[], vocab: Set<string>, allowed: Set<string> = allowedMorphemes()): Edge[] {
  const inVocab = edges.filter(
    (e) =>
      e.source !== e.target &&
      vocab.has(e.source) &&
      vocab.has(e.target) &&
      !DROP_MORPHEMES.has(`${e.type}:${e.morpheme}`) &&
      allowed.has(`${e.type}:${e.morpheme}`) &&
      sharesStem(e),
  );
  const bases = new Set(inVocab.map((e) => e.source));
  const best = new Map<string, Edge>();
  for (const e of inVocab) {
    if (e.type === 'suffix' && WEAK_SUFFIXES.has(e.morpheme) && !bases.has(e.target)) continue;
    const prev = best.get(e.target);
    if (!prev || e.source.length > prev.source.length || (e.source.length === prev.source.length && e.source < prev.source))
      best.set(e.target, e);
  }
  return [...best.values()];
}

// ------------------------------------------------------------------ Wiktionary etymologies

/** Lower-case, diacritics removed ("speciō" → "specio"), whitespace collapsed. */
export function normalizeEtymology(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Etymology text after these words names cognates, not ancestors ("cognate with Latin mittere"). */
const COGNATE_CUT = /\b(cognate with|cognates include|compare|akin to|related to|see also|more at|doublet of|unrelated to|not related to)\b/;

/**
 * Tokens (letters only) of the ancestor part of an etymology: normalized, cut at the first
 * mention of cognates. Root evidence must match a whole token.
 */
export function rootEvidenceTokens(text: string): Set<string> {
  const norm = normalizeEtymology(text);
  const cut = COGNATE_CUT.exec(norm);
  const ancestors = cut ? norm.slice(0, cut.index) : norm;
  return new Set(ancestors.match(/[a-z]+/g) ?? []);
}

const anchored = new WeakMap<RegExp, RegExp>();

/** Does a root's evidence pattern match one of the tokens? */
export function hasRootEvidence(def: Pick<MorphemeDef, 'evidence'>, tokens: Set<string>): boolean {
  if (!def.evidence) return false;
  let re = anchored.get(def.evidence);
  if (!re) {
    re = new RegExp(`^(?:${def.evidence.source})$`);
    anchored.set(def.evidence, re);
  }
  for (const t of tokens) if (re.test(t)) return true;
  return false;
}

/**
 * English morphs named by the etymology's surface analysis: "equivalent to in- + -spect",
 * "By surface analysis, decide + -ion". Returns forms like "in-", "-spect", "-ion".
 */
export function etymologyMorphs(text: string): string[] {
  const out: string[] = [];
  const re = /(?:equivalent to|by surface analysis,?)\s+([^.;()]*?\+[^.;()]*)/gi;
  for (const m of text.matchAll(re)) {
    for (const part of m[1]!.split('+')) {
      const tok = part.trim().split(/\s/)[0]!.replace(/[,"“”]/g, '');
      if (/^-?[a-z]+-?$/.test(tok) && tok.includes('-')) out.push(tok);
    }
  }
  return out;
}

/** kaikki `etymology_templates`: English affix templates ({{af|en|in-|-spect}}). */
export interface EtymologyTemplate {
  name: string;
  args?: Record<string, string>;
}
const AFFIX_TEMPLATES = new Set(['af', 'affix', 'prefix', 'pre', 'suffix', 'suf', 'confix', 'con']);

export function templateMorphs(templates: EtymologyTemplate[] | undefined): string[] {
  const out: string[] = [];
  for (const t of templates ?? []) {
    if (!AFFIX_TEMPLATES.has(t.name) || t.args?.['1'] !== 'en') continue;
    const args = t.args;
    const parts = Object.keys(args)
      .filter((k) => /^\d+$/.test(k) && k !== '1')
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => args[k]!.trim().toLowerCase());
    // {{prefix|en|un|do}} and {{suffix|en|kind|ness}} name the affix without its hyphen.
    if (t.name === 'prefix' || t.name === 'pre') parts[0] = parts[0] && !parts[0].endsWith('-') ? `${parts[0]}-` : parts[0]!;
    if (t.name === 'suffix' || t.name === 'suf') {
      const last = parts.length - 1;
      if (last > 0 && !parts[last]!.startsWith('-')) parts[last] = `-${parts[last]}`;
    }
    for (const p of parts) if (/^-?[a-z]+-?$/.test(p) && p.includes('-')) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ build

export interface EtymologyEntry {
  text: string;
  templates?: EtymologyTemplate[];
}

export interface BuildInput {
  vocab: Vocab;
  edges: Edge[];
  /** Lemma → etymology (Wiktionary). Its keys are also the set of known lemmas. */
  etymology: Map<string, EtymologyEntry>;
  inventory?: MorphemeDef[];
  /** A morpheme is kept when at least this many words carry it. */
  minWords?: number;
  /** Families larger than this are left out (they are chains of loose links). */
  maxFamily?: number;
}

export interface MorphemeOut {
  id: string;
  form: string;
  kind: MorphemeDef['kind'];
  origin: MorphemeDef['origin'];
  gloss_en: string;
  tr: string;
  words: number;
}

export interface BuildOutput {
  morphemes: MorphemeOut[];
  /** Each family: base word first, then by frequency. */
  families: string[][];
  /** lemma → [pos | '', family index | -1, morpheme indexes] */
  words: [string, string, number, number[]][];
  stats: Record<string, number>;
}

const POS_NAME: Record<Pos, string> = { N: 'noun', V: 'verb', J: 'adjective', R: 'adverb' };

function formToId(form: string, defs: MorphemeDef[]): MorphemeDef | undefined {
  const bare = form.replace(/^-|-$/g, '');
  const kind = form.startsWith('-') && form.endsWith('-') ? 'root' : form.endsWith('-') ? 'prefix' : 'suffix';
  // "in-" is ambiguous (not / into): only MorphyNet edges assign it.
  if (bare === 'in' || bare === 'im' || bare === 'il' || bare === 'ir') return undefined;
  return (
    defs.find((d) => d.kind === kind && d.kind !== 'root' && d.morphynet?.includes(bare)) ??
    defs.find((d) => d.kind === 'root' && d.id === bare)
  );
}

export function buildMorphology(input: BuildInput): BuildOutput {
  const defs = input.inventory ?? INVENTORY;
  const minWords = input.minWords ?? 3;
  const maxFamily = input.maxFamily ?? 40;
  const { vocab, etymology } = input;
  const zipf = (w: string) => vocab.zipf.get(w) ?? 0;
  const byAlias = morphynetIndex(defs);

  // Lemmas: vocabulary words that are Wiktionary headwords or MorphyNet nodes.
  const nodes = new Set(input.edges.flatMap((e) => [e.source, e.target]));
  const isLemma = (w: string) => vocab.rank.has(w) && (etymology.has(w) || nodes.has(w));

  // Families: connected components of the cleaned derivation graph.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  // Part of speech: majority vote over the edges (a word's own derivation counts double).
  const votes = new Map<string, Map<Pos, number>>();
  const vote = (w: string, p: Pos, n: number) => {
    if (!votes.has(w)) votes.set(w, new Map());
    const m = votes.get(w)!;
    m.set(p, (m.get(p) ?? 0) + n);
  };
  const incoming = new Map<string, Edge[]>();
  for (const e of input.edges) {
    vote(e.target, e.targetPos, 2);
    vote(e.source, e.sourcePos, 1);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e);
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, Set<string>>();
  for (const w of nodes) {
    const root = find(w);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(w);
  }
  const families: string[][] = [];
  const familyOf = new Map<string, number>();
  let droppedFamilies = 0;
  for (const members of groups.values()) {
    if (members.size < 2) continue;
    if (members.size > maxFamily) {
      droppedFamilies++;
      continue;
    }
    const list = [...members];
    // Base: a member that is derived from nothing inside the family, most frequent first.
    const bases = list.filter((w) => !(incoming.get(w) ?? []).some((e) => members.has(e.source)));
    const base = (bases.length ? bases : list).sort((a, b) => zipf(b) - zipf(a) || a.localeCompare(b))[0]!;
    const rest = list.filter((w) => w !== base).sort((a, b) => zipf(b) - zipf(a) || a.localeCompare(b));
    const idx = families.length;
    families.push([base, ...rest]);
    for (const w of members) familyOf.set(w, idx);
  }

  // Word → morphemes. Affixes from MorphyNet edges (inherited along the derivation chain)
  // and from the etymology's surface analysis; roots from spelling + etymology evidence.
  const direct = new Map<string, Set<string>>();
  const excluded = new Map(defs.map((d) => [d.id, new Set(d.exclude ?? [])]));
  const add = (w: string, id: string) => {
    if (excluded.get(id)?.has(w)) return;
    if (!direct.has(w)) direct.set(w, new Set());
    direct.get(w)!.add(id);
  };
  for (const e of input.edges) {
    const def = byAlias.get(`${e.type}:${e.morpheme}`);
    if (!def) continue;
    if (def.onlySourcePos && !def.onlySourcePos.includes(e.sourcePos)) continue;
    if (def.onlyTargetPos && !def.onlyTargetPos.includes(e.targetPos)) continue;
    add(e.target, def.id);
  }
  for (const [w, ety] of etymology) {
    if (!vocab.rank.has(w)) continue;
    for (const form of [...templateMorphs(ety.templates), ...etymologyMorphs(ety.text)]) {
      const def = formToId(form, defs);
      // A root named by the surface analysis still has to be spelled in the word. Affixes
      // with a part-of-speech rule (-en, -y, in-) come from MorphyNet only: "been" is not
      // "be + -en (make)".
      if (!def || def.onlySourcePos || def.onlyTargetPos) continue;
      if (def.kind !== 'root' || def.match?.test(w)) add(w, def.id);
    }
  }
  const inherited = new Map<string, Set<string>>();
  const collect = (w: string, depth: number): Set<string> => {
    const done = inherited.get(w);
    if (done) return done;
    const out = new Set(direct.get(w) ?? []);
    if (depth < 6) for (const e of incoming.get(w) ?? []) for (const id of collect(e.source, depth + 1)) out.add(id);
    inherited.set(w, out);
    return out;
  };

  const tokensCache = new Map<string, Set<string>>();
  const tokensOf = (w: string) => {
    let t = tokensCache.get(w);
    if (t === undefined) {
      t = rootEvidenceTokens(etymology.get(w)?.text ?? '');
      tokensCache.set(w, t);
    }
    return t;
  };
  const roots = defs.filter((d) => d.kind === 'root');
  // A root needs the spelling in the word and evidence in the etymology of the word or of a
  // family member that is spelled with the root too (inspector ← inspect ← Latin inspicere).
  const rootHits = (w: string): string[] => {
    const fam = familyOf.has(w) ? families[familyOf.get(w)!]! : [w];
    return roots
      .filter((d) => d.match!.test(w) && !excluded.get(d.id)?.has(w) && fam.some((m) => d.match!.test(m) && hasRootEvidence(d, tokensOf(m))))
      .map((d) => d.id);
  };

  const wordIds = new Map<string, string[]>();
  const lemmas = [...vocab.rank.keys()].filter(isLemma);
  for (const w of lemmas) {
    const ids = new Set([...collect(w, 0), ...rootHits(w)]);
    if (ids.size) wordIds.set(w, [...ids]);
  }

  // Keep morphemes carried by enough words; order by kind, then by number of words.
  const count = new Map<string, number>();
  for (const ids of wordIds.values()) for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  const kindOrder = { prefix: 0, root: 1, suffix: 2 } as const;
  const kept = defs
    .filter((d) => (count.get(d.id) ?? 0) >= minWords)
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const morphIndex = new Map(kept.map((d, i) => [d.id, i]));
  const morphemes: MorphemeOut[] = kept.map((d) => ({
    id: d.id,
    form: d.form,
    kind: d.kind,
    origin: d.origin,
    gloss_en: d.gloss_en,
    tr: d.tr,
    words: count.get(d.id) ?? 0,
  }));

  const words: BuildOutput['words'] = [];
  for (const w of lemmas.sort()) {
    const fam = familyOf.get(w) ?? -1;
    const ms = (wordIds.get(w) ?? [])
      .map((id) => morphIndex.get(id))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    if (fam === -1 && ms.length === 0) continue;
    // Only derived words get a POS: MorphyNet tags bases loosely ("know" as a noun).
    const v = incoming.has(w) ? votes.get(w) : undefined;
    const p = v ? [...v].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0] : undefined;
    words.push([w, p ? POS_NAME[p] : '', fam, ms]);
  }

  return {
    morphemes,
    families,
    words,
    stats: {
      vocab: vocab.rank.size,
      lemmas: lemmas.length,
      edges: input.edges.length,
      families: families.length,
      familyWords: familyOf.size,
      droppedFamilies,
      morphemes: morphemes.length,
      words: words.length,
    },
  };
}
