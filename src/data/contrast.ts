// Confusable words and contrast cards on the device (v0.3 İP6, docs/decisions/0026).
//
// - The scan for near pairs runs here, over the user's own notes (domain/confusables.ts).
// - A pair the user reported after an Again answer, or hid from the suggestions, is one
//   user_content row (kind 'confusion', id from the two terms; sense_id / replaces_id = the
//   user's senses of the two terms; context 'reported' or 'hidden'). Synced per user.
// - A contrast card ("fark kartı") is a note with term_type 'contrast' ("affect ↔ effect"),
//   one sense per term (sense 1 = the first term), and only a recognition card. Its one-line
//   difference is a user_content row (kind 'contrast', sense_id = the card's first sense).
//   Everything the user writes or edits stays in these user rows.
// - Shared content from ai-contrast is cached in lexicon_pair_notes (kind 'contrast'), so a
//   card can be made offline when the pair was fetched before. Nothing here writes to a
//   shared table on the server.
import type { ContrastNote, ContrastResponse } from '../../supabase/functions/_shared/contrast-contracts';
import {
  cleanContrastText,
  CONFUSION_KIND,
  type ConfusablePair,
  type ConfusableSide,
  type ConfusableTerm,
  confusionRowId,
  CONTRAST_KIND,
  CONTRAST_TERM_TYPE,
  contrastKey,
  contrastTerm,
  contrastTerms,
  contrastTextRowId,
  pairKey,
  pickerTerms,
  rankPairs,
  scanConfusables,
  suggestedPairs,
} from '../domain/confusables';
import { emptyFsrs } from '../domain/fsrs';
import { LIMITS, overLimit } from '../domain/limits';
import { normalizeTerm } from '../domain/normalize';
import { uuidv7 } from '../domain/ids';
import { findSpan } from '../domain/recognition';
import type { Id, LexiconPairNote, Millis, Note, Sense, UserContent } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { lapsesByNote } from './leech';
import { writeTx } from './writer';

const meaningOf = (s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>) => s.meaning_tr_override?.trim() || s.meaning_tr;

// ------------------------------------------------------------------ the user's terms

/** The user's live notes with their live senses, as the scan sees them. */
export async function getConfusableTerms(): Promise<ConfusableTerm[]> {
  const [notes, senses] = await Promise.all([
    db.notes.filter((n) => n.deleted_at === null).toArray(),
    db.senses.filter((s) => s.deleted_at === null).toArray(),
  ]);
  const byNote = new Map<Id, Sense[]>();
  for (const s of senses) {
    const list = byNote.get(s.note_id);
    if (list) list.push(s);
    else byNote.set(s.note_id, [s]);
  }
  return notes.map((n) => ({
    note_id: n.id,
    term: n.term,
    term_norm: n.term_norm,
    term_type: n.term_type,
    senses: (byNote.get(n.id) ?? [])
      .sort((a, b) => a.sense_no - b.sense_no)
      .map((s) => ({ id: s.id, meaning: meaningOf(s), lexicon_sense_id: s.lexicon_sense_id })),
  }));
}

/** The scan, remembered until the user's notes or senses change (it takes ~0.3 s at 5 000 words). */
let scanCache: { signature: string; pairs: ConfusablePair[] } | null = null;

function signatureOf(terms: readonly ConfusableTerm[]): string {
  let h = 0;
  for (const t of terms) {
    const s = `${t.note_id}|${t.term_norm}|${t.senses.map((x) => x.meaning).join(',')}`;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return `${terms.length}:${h}`;
}

function scan(terms: readonly ConfusableTerm[], familyOf?: (termNorm: string) => string | number | null): ConfusablePair[] {
  const signature = signatureOf(terms) + (familyOf ? ':f' : '');
  if (scanCache?.signature === signature) return scanCache.pairs;
  const pairs = scanConfusables(terms, familyOf ? { familyOf } : {});
  scanCache = { signature, pairs };
  return pairs;
}

// ------------------------------------------------------------------ reported and hidden pairs

async function confusionRows(): Promise<UserContent[]> {
  return db.user_content
    .where('kind')
    .equals(CONFUSION_KIND)
    .filter((r) => r.deleted_at === null)
    .toArray();
}

/** Contrast cards the user has, by pair key. */
async function cardedKeys(terms: readonly ConfusableTerm[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const t of terms) {
    if (t.term_type !== CONTRAST_TERM_TYPE) continue;
    const pair = contrastTerms(t.term);
    if (pair) out.add(pairKey(pair[0], pair[1]));
  }
  return out;
}

function sideFor(terms: Map<string, ConfusableTerm>, term: string, senseId: Id | null): ConfusableSide | null {
  const t = terms.get(normalizeTerm(term));
  if (!t) return null;
  const sense = t.senses.find((s) => s.id === senseId) ?? t.senses[0];
  return { note_id: t.note_id, term: t.term, term_norm: t.term_norm, sense_id: sense?.id ?? null };
}

function reportedPairs(rows: readonly UserContent[], terms: readonly ConfusableTerm[]): ConfusablePair[] {
  const byNorm = new Map(terms.filter((t) => t.term_type !== CONTRAST_TERM_TYPE).map((t) => [t.term_norm, t]));
  const out: ConfusablePair[] = [];
  for (const r of rows) {
    if (r.context !== 'reported') continue;
    const names = contrastTerms(r.text);
    if (!names) continue;
    const x = sideFor(byNorm, names[0], r.sense_id);
    const y = sideFor(byNorm, names[1], r.replaces_id);
    if (!x || !y) continue;
    const [a, b] = x.term_norm < y.term_norm ? [x, y] : [y, x];
    out.push({ key: pairKey(a.term, b.term), a, b, reason: 'reported', distance: 0 });
  }
  return out;
}

export interface ConfusablesView {
  /** Pairs worth a contrast card, best first (reported, then the ones the learner forgets). */
  pairs: ConfusablePair[];
}

/**
 * Pairs to offer a contrast card for: reported ones and near pairs from the device scan whose
 * words the learner actually forgets, minus hidden pairs and pairs that already have a card.
 * With `noteId`, only pairs of that note (the leech sheet). `familyOf` (morphology data)
 * leaves out members of one word family.
 */
export async function getConfusables(
  opts: { noteId?: Id; limit?: number; familyOf?: (termNorm: string) => string | number | null } = {},
): Promise<ConfusablesView> {
  const terms = await getConfusableTerms();
  const rows = await confusionRows();
  const hidden = new Set(rows.filter((r) => r.context === 'hidden').flatMap((r) => {
    const names = contrastTerms(r.text);
    return names ? [pairKey(names[0], names[1])] : [];
  }));
  const reported = reportedPairs(rows, terms);
  const all = suggestedPairs(scan(terms, opts.familyOf), reported, hidden, await cardedKeys(terms));
  const scoped = opts.noteId ? all.filter((p) => p.a.note_id === opts.noteId || p.b.note_id === opts.noteId) : all;
  const lapses = await lapsesByNote();
  // On a leech's own sheet every near pair counts: that word is forgotten already.
  const lapsesOf = (id: Id) => (id === opts.noteId ? Math.max(2, lapses.get(id) ?? 0) : (lapses.get(id) ?? 0));
  return { pairs: rankPairs(scoped, lapsesOf, opts.limit ?? 20) };
}

export interface PickerEntry {
  note_id: Id;
  term: string;
  /** First Turkish meaning, to tell look-alikes apart. */
  meaning: string | null;
  near: 'spelling' | 'meaning' | 'reported' | null;
}

/** "Hangi kelimeyle karıştırdın?": the user's terms, near ones first, filtered by `query`. */
export async function getConfusionPicker(noteId: Id, query: string, limit = 30): Promise<PickerEntry[]> {
  const terms = await getConfusableTerms();
  return pickerTerms(terms, noteId, query, scan(terms), limit).map(({ term, near }) => ({
    note_id: term.note_id,
    term: term.term,
    meaning: term.senses[0]?.meaning ?? null,
    near,
  }));
}

async function pairSides(noteA: Id, noteB: Id, senseA?: Id | null, senseB?: Id | null): Promise<[ConfusableSide, ConfusableSide]> {
  const side = async (noteId: Id, senseId: Id | null | undefined): Promise<ConfusableSide> => {
    const note = await db.notes.get(noteId);
    if (!note || note.deleted_at !== null) throw new ActionError('not_found', 'note');
    const senses = (await db.senses.where('note_id').equals(noteId).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    const sense = senses.find((s) => s.id === senseId) ?? senses[0];
    return { note_id: note.id, term: note.term, term_norm: note.term_norm, sense_id: sense?.id ?? null };
  };
  const a = await side(noteA, senseA);
  const b = await side(noteB, senseB);
  if (a.term_norm === b.term_norm) throw new ActionError('invalid_input', 'same term');
  return a.term_norm < b.term_norm ? [a, b] : [b, a];
}

async function putConfusion(
  noteA: Id,
  noteB: Id,
  context: 'reported' | 'hidden',
  senses: { a?: Id | null; b?: Id | null },
  now: Millis,
): Promise<ConfusablePair> {
  const [a, b] = await pairSides(noteA, noteB, senses.a, senses.b);
  // Which side is which follows the sorted terms; the senses travel with their notes.
  const id = await confusionRowId(a.term, b.term);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    await w.put('user_content', {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      kind: CONFUSION_KIND,
      lexicon_sense_id: null,
      sense_id: a.sense_id,
      context,
      replaces_id: b.sense_id,
      text: contrastTerm(a.term, b.term),
      translations: null,
      span: null,
      selected: context === 'reported',
      deleted_at: null,
    });
  });
  return { key: pairKey(a.term, b.term), a, b, reason: 'reported', distance: 0 };
}

/**
 * "Bununla karıştırdım": the user says which of their own terms they mixed this card's word
 * up with. Stored in the user's account only. Returns the pair (for "Fark kartı yap").
 */
export function reportConfusion(
  noteId: Id,
  otherNoteId: Id,
  opts: { senseId?: Id | null } = {},
  now: Millis = Date.now(),
): Promise<ConfusablePair> {
  // The card's sense stays with the card's word (the sides are sorted by term afterwards).
  return putConfusion(noteId, otherNoteId, 'reported', { a: opts.senseId ?? null }, now);
}

/** "Önerme": hide a suggested pair for this user. */
export async function hideConfusablePair(pair: Pick<ConfusablePair, 'a' | 'b'>, now: Millis = Date.now()): Promise<void> {
  await putConfusion(pair.a.note_id, pair.b.note_id, 'hidden', { a: pair.a.sense_id, b: pair.b.sense_id }, now);
}

/** "Geri al" after reporting or hiding a pair (tombstone). */
export async function clearConfusion(termA: string, termB: string, now: Millis = Date.now()): Promise<void> {
  const id = await confusionRowId(termA, termB);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    if (existing && existing.deleted_at === null) await w.put('user_content', { ...existing, deleted_at: now });
  });
}

// ------------------------------------------------------------------ contrast content

export interface ContrastDraftSide {
  term: string;
  note_id: Id;
  sense_id: Id;
  lexicon_sense_id: Id | null;
  meaning: string;
  pos: string | null;
  gloss_en: string | null;
  sentence: string | null;
  sentence_tr: string | null;
}

export interface ContrastDraft {
  key: string;
  /** Sorted like the card's term: a first. */
  a: ContrastDraftSide;
  b: ContrastDraftSide;
  difference: string | null;
  /** lexicon_pair_notes.id of the shared content the draft comes from, or null. */
  shared_id: Id | null;
  /** Both senses are in the shared lexicon: ai-contrast can be asked. */
  can_ask: boolean;
  /** The user already has a contrast card for this pair. */
  existing_note_id: Id | null;
}

/** Shared contrast content of two lexicon senses from the local cache, or null. */
export async function cachedContrast(lexA: Id, lexB: Id): Promise<ContrastNote | null> {
  const key = contrastKey(lexA, lexB);
  const first = key.split('|')[0]!;
  const rows = await db.lexicon_pair_notes.where('[sense_id+kind]').equals([first, 'contrast']).toArray();
  const row = rows.find((r) => r.content_key === key && r.status === 'active');
  return row ? contrastOfRow(row) : null;
}

function contrastOfRow(row: LexiconPairNote): ContrastNote | null {
  const c = row.content as { a?: Record<string, unknown>; b?: Record<string, unknown>; difference_tr?: unknown };
  const [ia, ib] = row.content_key.split('|');
  const side = (s: Record<string, unknown> | undefined, id: string | undefined) =>
    s && id && typeof s.lemma === 'string' && typeof s.sentence_en === 'string' && Array.isArray(s.span)
      ? {
          sense_id: id,
          lemma: s.lemma,
          sentence_en: s.sentence_en,
          span: [Number(s.span[0]), Number(s.span[1])] as [number, number],
          sentence_tr: typeof s.sentence_tr === 'string' ? s.sentence_tr : null,
        }
      : null;
  const a = side(c.a, ia);
  const b = side(c.b, ib);
  if (!a || !b || typeof c.difference_tr !== 'string') return null;
  return { id: row.id, key: row.content_key, a, b, difference_tr: c.difference_tr, updated_at: row.updated_at };
}

/** An ai-contrast answer goes into the local cache (read-only copy of the shared row). */
export async function storeContrastNote(res: Pick<ContrastResponse, 'note'>): Promise<void> {
  const n = res.note;
  await db.lexicon_pair_notes.put({
    id: n.id,
    term_norm: normalizeTerm(n.a.lemma),
    sense_id: n.a.sense_id,
    lang_pair: 'en-tr',
    kind: 'contrast',
    content_key: n.key,
    content: { a: { ...n.a }, b: { ...n.b }, difference_tr: n.difference_tr },
    curated: false,
    status: 'active',
    updated_at: n.updated_at,
  });
}

async function draftSide(side: ConfusableSide): Promise<ContrastDraftSide> {
  if (!side.sense_id) throw new ActionError('invalid_input', 'a word without a meaning');
  const sense = await db.senses.get(side.sense_id);
  if (!sense || sense.deleted_at !== null) throw new ActionError('not_found', 'sense');
  return {
    term: side.term,
    note_id: side.note_id,
    sense_id: sense.id,
    lexicon_sense_id: sense.lexicon_sense_id,
    meaning: meaningOf(sense),
    pos: sense.pos,
    gloss_en: sense.gloss_en,
    sentence: null,
    sentence_tr: null,
  };
}

/**
 * The contrast card for a pair as far as the device knows it: the two words and meanings,
 * and the shared sentences and difference when they are cached. Safe in live queries.
 */
export async function getContrastDraft(pair: Pick<ConfusablePair, 'a' | 'b'>): Promise<ContrastDraft> {
  const [x, y] = await Promise.all([draftSide(pair.a), draftSide(pair.b)]);
  const [a, b] = normalizeTerm(x.term) < normalizeTerm(y.term) ? [x, y] : [y, x];
  const shared = a.lexicon_sense_id && b.lexicon_sense_id ? await cachedContrast(a.lexicon_sense_id, b.lexicon_sense_id) : null;
  if (shared) {
    const of = (d: ContrastDraftSide) => (shared.a.sense_id === d.lexicon_sense_id ? shared.a : shared.b);
    a.sentence = of(a).sentence_en;
    a.sentence_tr = of(a).sentence_tr;
    b.sentence = of(b).sentence_en;
    b.sentence_tr = of(b).sentence_tr;
  }
  const termNorm = normalizeTerm(contrastTerm(a.term, b.term));
  const existing = (await db.notes.where('term_norm').equals(termNorm).toArray()).find((n) => n.deleted_at === null);
  return {
    key: pairKey(a.term, b.term),
    a,
    b,
    difference: shared?.difference_tr ?? null,
    shared_id: shared?.id ?? null,
    can_ask: !!a.lexicon_sense_id && !!b.lexicon_sense_id && a.lexicon_sense_id !== b.lexicon_sense_id,
    existing_note_id: existing?.id ?? null,
  };
}

export interface ContrastCardInput {
  a: { note_id: Id; sense_id: Id; sentence: string | null; sentence_tr: string | null };
  b: { note_id: Id; sense_id: Id; sentence: string | null; sentence_tr: string | null };
  /** The one-line difference (the user's text or the shared one, as the user approved it). */
  difference: string;
  /** The shared content it comes from (lexicon_pair_notes.id), or null. */
  shared_id: Id | null;
}

/**
 * "Fark kartını ekle": a contrast note with one sense per word, the user's difference line
 * and one recognition card. Nothing changes on the two words' own notes and cards.
 * @throws ActionError('duplicate_term') when the pair has a card; ('invalid_input') for an
 * empty difference.
 */
export async function createContrastCard(input: ContrastCardInput, now: Millis = Date.now()): Promise<Note> {
  const difference = cleanContrastText(input.difference);
  if (!difference) throw new ActionError('invalid_input', 'empty difference');
  const sides = await Promise.all(
    [input.a, input.b].map(async (s) => {
      const note = await db.notes.get(s.note_id);
      const sense = await db.senses.get(s.sense_id);
      if (!note || note.deleted_at !== null || !sense || sense.deleted_at !== null) throw new ActionError('not_found');
      return { note, sense, sentence: s.sentence?.trim() || null, sentence_tr: s.sentence_tr?.trim() || null };
    }),
  );
  sides.sort((p, q) => (p.note.term_norm < q.note.term_norm ? -1 : 1));
  const [first, second] = sides as [(typeof sides)[number], (typeof sides)[number]];
  if (first.note.term_norm === second.note.term_norm) throw new ActionError('invalid_input', 'same term');
  const term = contrastTerm(first.note.term, second.note.term);
  const termNorm = normalizeTerm(term);
  // "a ↔ b" of two long terms can pass the server's term limit; sync_push would then reject
  // the note on every attempt (domain/limits.ts).
  const bad = overLimit({
    term: { value: term, max: LIMITS.term },
    term_norm: { value: termNorm, max: LIMITS.term },
    ...Object.fromEntries(
      [first, second].flatMap((s, i) => [
        [`source_sentence_${i + 1}`, { value: s.sentence, max: LIMITS.source_sentence }],
        [`source_sentence_tr_${i + 1}`, { value: s.sentence_tr, max: LIMITS.source_sentence_tr }],
      ]),
    ),
  });
  if (bad) throw new ActionError('invalid_input', `${bad} is too long`);
  // Ids are made before the transaction: hashing (crypto.subtle) inside it would end it.
  const noteId = uuidv7(now);
  const textId = await contrastTextRowId(noteId);
  return writeTx([db.notes, db.senses, db.cards, db.user_content], now, async (w) => {
    const clash = (await db.notes.where('term_norm').equals(termNorm).toArray()).some((n) => n.deleted_at === null);
    if (clash) throw new ActionError('duplicate_term');
    const note = await w.put('notes', {
      ...w.base(noteId),
      term,
      term_norm: termNorm,
      term_type: CONTRAST_TERM_TYPE,
      lexicon_term_id: null,
      ipa: null,
      tags: [],
      possible_duplicate: false,
      level_override: null,
    });
    let firstSense: Sense | null = null;
    for (const [i, s] of [first, second].entries()) {
      const span = s.sentence ? findSpan(s.sentence, s.note.term) : null;
      const sense = await w.put('senses', {
        ...w.base(),
        note_id: note.id,
        sense_no: i + 1,
        lexicon_sense_id: s.sense.lexicon_sense_id,
        pos: s.sense.pos,
        gloss_en: s.sense.gloss_en,
        meaning_tr: meaningOf(s.sense),
        meaning_tr_override: null,
        source_sentence: s.sentence,
        source_sentence_tr: s.sentence ? s.sentence_tr : null,
        span,
        source_id: null,
      });
      firstSense ??= sense;
    }
    await w.put('cards', {
      ...w.base(),
      note_id: note.id,
      sense_id: null,
      card_type: 'recognition',
      suspended: false,
      unlocked: true,
      ...emptyFsrs(now),
    });
    await w.put('user_content', {
      ...w.base(textId),
      kind: CONTRAST_KIND,
      lexicon_sense_id: null,
      sense_id: firstSense!.id,
      context: null,
      replaces_id: input.shared_id,
      text: difference,
      translations: null,
      span: null,
      selected: true,
    });
    return note;
  });
}

export interface ContrastCardSide {
  term: string;
  sense: Sense;
}

export interface ContrastCardView {
  sides: [ContrastCardSide, ContrastCardSide] | null;
  difference: string | null;
  /** user_content.id of the difference line. */
  difference_id: Id | null;
}

/** What a contrast card shows (live; no hashing, safe in live queries). */
export async function getContrastCard(noteId: Id): Promise<ContrastCardView> {
  const note = await db.notes.get(noteId);
  const senses = (await db.senses.where('note_id').equals(noteId).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.sense_no - b.sense_no);
  const names = note ? contrastTerms(note.term) : null;
  const sides: ContrastCardView['sides'] =
    names && senses.length >= 2
      ? [
          { term: names[0], sense: senses[0]! },
          { term: names[1], sense: senses[1]! },
        ]
      : null;
  const ids = new Set(senses.map((s) => s.id));
  const row = (
    await db.user_content
      .where('kind')
      .equals(CONTRAST_KIND)
      .filter((r) => r.deleted_at === null && !!r.sense_id && ids.has(r.sense_id))
      .toArray()
  ).sort((a, b) => b.updated_at - a.updated_at)[0];
  return { sides, difference: row?.text ?? null, difference_id: row?.id ?? null };
}

/** "Düzenle" on the difference line of a contrast card (user_content only). */
export async function saveContrastText(noteId: Id, text: string, now: Millis = Date.now()): Promise<void> {
  const clean = cleanContrastText(text);
  if (!clean) throw new ActionError('invalid_input', 'empty difference');
  const senses = (await db.senses.where('note_id').equals(noteId).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.sense_no - b.sense_no);
  if (!senses[0]) throw new ActionError('not_found');
  const id = await contrastTextRowId(noteId);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    await w.put('user_content', {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      kind: CONTRAST_KIND,
      lexicon_sense_id: null,
      sense_id: senses[0]!.id,
      context: null,
      replaces_id: existing?.replaces_id ?? null,
      text: clean,
      translations: null,
      span: null,
      selected: true,
      deleted_at: null,
    });
  });
}
