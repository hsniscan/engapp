// High-level write operations the UI calls. Each one is a single Dexie transaction; every
// synced row it touches is stamped (updated_at + hlc) and queued in the outbox inside it.
import { dayKeyOf } from '../domain/day';
import { LIMITS, overLimit, truncateCodePoints } from '../domain/limits';
import { applyRating, emptyFsrs, fsrsEqual, pickFsrs } from '../domain/fsrs';
import { normalizeTerm } from '../domain/normalize';
import { isDuplicateSense } from '../../supabase/functions/_shared/text';
import { canHaveCloze, isValidSpan } from '../domain/recognition';
import { deriveUnlocked, effectiveLogs, recognitionUnlocks, replayCard } from '../domain/recompute';
import { addAnswerToDay, emptyDay } from '../domain/streak';
import type {
  Card,
  CefrLevel,
  CardStateValue,
  CardType,
  DailyActivity,
  Id,
  Millis,
  Note,
  RatingValue,
  ReviewLog,
  Sense,
  NoteTermType,
  Source,
} from '../domain/types';
import { isRating } from '../domain/fsrs';
import { db } from './db';
import { isTodayComplete, refreshDay } from './dailyActivity';
import { ActionError } from './errors';
import { loadTodayFacts, logsByCard } from './history';
import { dayConfig, getSettings, schedulerFor } from './settings';
import { type SyncWriter, writeTx } from './writer';

export const MAX_DURATION_MS = 60_000;

// ------------------------------------------------------------------ helpers

function newCard(w: SyncWriter, noteId: Id, senseId: Id | null, type: CardType, unlocked: boolean): Card {
  return {
    ...w.base(),
    note_id: noteId,
    sense_id: senseId,
    card_type: type,
    suspended: false,
    unlocked,
    ...emptyFsrs(w.now),
  };
}

function uniqueTags(tags: Iterable<string>): string[] {
  return [...new Set([...tags].map((t) => t.trim()).filter(Boolean))];
}

function cleanSpan(sentence: string | null, span: [number, number] | null | undefined): [number, number] | null {
  return sentence && isValidSpan(sentence, span) ? [span[0], span[1]] : null;
}

function assertNoteFits(n: Pick<Note, 'term' | 'term_norm' | 'ipa' | 'tags'>): void {
  const bad = overLimit({
    term: { value: n.term, max: LIMITS.term },
    term_norm: { value: n.term_norm, max: LIMITS.term },
    ipa: { value: n.ipa, max: LIMITS.ipa },
  });
  if (bad) throw new ActionError('invalid_input', `${bad} is too long`);
  if (n.tags.length > LIMITS.tags) throw new ActionError('invalid_input', 'Too many tags');
}

function assertSenseFits(
  s: Pick<Sense, 'pos' | 'gloss_en' | 'meaning_tr' | 'meaning_tr_override' | 'source_sentence' | 'source_sentence_tr'>,
): void {
  const bad = overLimit({
    pos: { value: s.pos, max: LIMITS.pos },
    gloss_en: { value: s.gloss_en, max: LIMITS.gloss_en },
    meaning_tr: { value: s.meaning_tr, max: LIMITS.meaning_tr },
    meaning_tr_override: { value: s.meaning_tr_override, max: LIMITS.meaning_tr },
    source_sentence: { value: s.source_sentence, max: LIMITS.source_sentence },
    source_sentence_tr: { value: s.source_sentence_tr, max: LIMITS.source_sentence_tr },
  });
  if (bad) throw new ActionError('invalid_input', `${bad} is too long`);
}

function meaningKey(s: Pick<Sense, 'meaning_tr' | 'meaning_tr_override'>): string {
  return normalizeTerm(s.meaning_tr_override?.trim() || s.meaning_tr);
}

async function recognitionOf(noteId: Id): Promise<Card | undefined> {
  const cards = await db.cards.where('note_id').equals(noteId).toArray();
  return cards.find((c) => c.card_type === 'recognition' && c.deleted_at === null) ?? cards.find((c) => c.card_type === 'recognition');
}

/** Bring every production/cloze card of a note in line with the recognition state. */
async function syncUnlocked(w: SyncWriter, noteId: Id, recognitionState: CardStateValue | null): Promise<Id[]> {
  const changed: Id[] = [];
  const cards = await db.cards.where('note_id').equals(noteId).toArray();
  for (const c of cards) {
    if (c.card_type === 'recognition' || c.deleted_at !== null) continue;
    const unlocked = deriveUnlocked(c, recognitionState);
    if (unlocked !== c.unlocked) {
      await w.put('cards', { ...c, unlocked });
      changed.push(c.id);
    }
  }
  return changed;
}

/**
 * Make sure a live sense has its production card and (when possible) its cloze card. A root
 * or affix note ("-spect-") is recognition only: nothing to produce or fill in.
 */
async function ensureSenseCards(
  w: SyncWriter,
  sense: Sense,
  recognitionState: CardStateValue | null,
  termType: NoteTermType,
): Promise<Card[]> {
  const existing = await db.cards.where('sense_id').equals(sense.id).toArray();
  const out: Card[] = [];
  const wanted: CardType[] = termType === 'affix' ? [] : canHaveCloze(sense) ? ['production', 'cloze'] : ['production'];
  for (const type of ['production', 'cloze'] as const) {
    const card = existing.find((c) => c.card_type === type);
    const want = wanted.includes(type);
    if (want && !card) {
      out.push(await w.put('cards', newCard(w, sense.note_id, sense.id, type, recognitionState !== null && recognitionUnlocks(recognitionState))));
    } else if (want && card && card.deleted_at !== null) {
      out.push(await w.put('cards', { ...card, deleted_at: null, unlocked: deriveUnlocked(card, recognitionState) }));
    } else if (!want && card && card.deleted_at === null) {
      await w.put('cards', { ...card, deleted_at: w.now });
    }
  }
  return out;
}

// ------------------------------------------------------------------ notes & senses

export interface SenseInput {
  meaning_tr: string;
  lexicon_sense_id?: Id | null;
  pos?: string | null;
  gloss_en?: string | null;
  meaning_tr_override?: string | null;
  source_sentence?: string | null;
  /** Turkish translation of source_sentence; dropped when there is no sentence. */
  source_sentence_tr?: string | null;
  /** [start, end) of the term in source_sentence. An invalid span is dropped (no cloze card). */
  span?: [number, number] | null;
  source_id?: Id | null;
}

export interface AddNoteInput {
  term: string;
  term_type?: NoteTermType;
  ipa?: string | null;
  tags?: string[];
  lexicon_term_id?: Id | null;
  senses: SenseInput[];
  /**
   * Imports: a sense whose source sentence equals a live sense's sentence is skipped (the
   * term has one meaning in one sentence).
   */
  one_sense_per_sentence?: boolean;
}

export interface AddNoteResult {
  note: Note;
  /** created: new note; existing: senses added to a live note; reactivated: a soft-deleted note came back. */
  status: 'created' | 'existing' | 'reactivated';
  addedSenses: Sense[];
  /**
   * Inputs that matched a live sense and were skipped: same lexicon_sense_id, same meaning,
   * same part of speech with an overlapping Turkish meaning, or (one_sense_per_sentence) the
   * same sentence.
   */
  skippedSenses: SenseInput[];
  createdCards: Card[];
}

/**
 * Add a term with one or more senses, or add new senses to the note that already has this
 * term (matched by term_norm). A soft-deleted note with the same term is reactivated.
 * Creates the note's recognition card, a production card per sense and a cloze card per
 * sense that has a sentence and a valid span. Production/cloze cards start locked unless
 * the recognition card has already reached Review.
 * @throws ActionError('invalid_input') for an empty term or meaning.
 */
export async function addNoteWithSenses(input: AddNoteInput, now: Millis = Date.now()): Promise<AddNoteResult> {
  const term = input.term.normalize('NFC').replace(/\s+/g, ' ').trim();
  const termNorm = normalizeTerm(term);
  if (!termNorm) throw new ActionError('invalid_input', 'Empty term');
  for (const s of input.senses) if (!s.meaning_tr.trim()) throw new ActionError('invalid_input', 'Empty meaning');
  assertNoteFits({ term, term_norm: termNorm, ipa: input.ipa ?? null, tags: uniqueTags(input.tags ?? []) });
  for (const s of input.senses) {
    assertSenseFits({
      pos: s.pos ?? null,
      gloss_en: s.gloss_en ?? null,
      meaning_tr: s.meaning_tr.trim(),
      meaning_tr_override: s.meaning_tr_override?.trim() || null,
      source_sentence: s.source_sentence ?? null,
      source_sentence_tr: s.source_sentence_tr?.trim() || null,
    });
  }

  return writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    const sameTerm = await db.notes.where('term_norm').equals(termNorm).toArray();
    const live = sameTerm.filter((n) => n.deleted_at === null).sort((a, b) => a.created_at - b.created_at)[0];
    const deleted = sameTerm.filter((n) => n.deleted_at !== null).sort((a, b) => b.deleted_at! - a.deleted_at!)[0];
    const createdCards: Card[] = [];
    let status: AddNoteResult['status'];
    let note: Note;

    const merged = (n: Note): Note => {
      const m = {
        ...n,
        tags: uniqueTags([...n.tags, ...(input.tags ?? [])]),
        ipa: n.ipa ?? input.ipa ?? null,
        lexicon_term_id: n.lexicon_term_id ?? input.lexicon_term_id ?? null,
      };
      assertNoteFits(m);
      return m;
    };

    if (live) {
      status = 'existing';
      const m = merged(live);
      note = JSON.stringify(m) === JSON.stringify(live) ? live : await w.put('notes', m);
    } else if (deleted) {
      status = 'reactivated';
      note = await w.put('notes', { ...merged(deleted), deleted_at: null });
    } else {
      status = 'created';
      note = await w.put('notes', {
        ...w.base(),
        term,
        term_norm: termNorm,
        term_type: input.term_type ?? (term.includes(' ') ? 'phrase' : 'word'),
        lexicon_term_id: input.lexicon_term_id ?? null,
        ipa: input.ipa ?? null,
        tags: uniqueTags(input.tags ?? []),
        possible_duplicate: false,
        level_override: null,
      });
    }

    let recognition = await recognitionOf(note.id);
    if (!recognition) {
      recognition = await w.put('cards', newCard(w, note.id, null, 'recognition', true));
      createdCards.push(recognition);
    } else if (recognition.deleted_at !== null) {
      recognition = await w.put('cards', { ...recognition, deleted_at: null, unlocked: true });
      createdCards.push(recognition);
    }
    const recState = recognition.state;

    const senses = await db.senses.where('note_id').equals(note.id).toArray();
    let nextNo = Math.max(0, ...senses.filter((s) => s.deleted_at === null).map((s) => s.sense_no)) + 1;
    const addedSenses: Sense[] = [];
    const skippedSenses: SenseInput[] = [];

    for (const inp of input.senses) {
      const meaning = inp.meaning_tr_override?.trim() || inp.meaning_tr;
      const key = normalizeTerm(meaning);
      const sentence = inp.source_sentence?.trim() ? inp.source_sentence : null;
      const sentenceKey = input.one_sense_per_sentence && sentence ? normalizeTerm(sentence) : null;
      const matches = (s: Sense): boolean =>
        (!!inp.lexicon_sense_id && s.lexicon_sense_id === inp.lexicon_sense_id) || meaningKey(s) === key;
      // A live sense that is the same meaning in other words ("davet" next to "davetiye,
      // davet", same part of speech), or, for an import, the sense of the same sentence:
      // reuse it instead of adding a second one.
      const duplicates = (s: Sense): boolean =>
        matches(s) ||
        isDuplicateSense({ pos: s.pos, meaning_tr: s.meaning_tr_override?.trim() || s.meaning_tr }, { pos: inp.pos, meaning_tr: meaning }) ||
        (sentenceKey !== null && !!s.source_sentence && normalizeTerm(s.source_sentence) === sentenceKey);
      if (senses.some((s) => s.deleted_at === null && duplicates(s))) {
        skippedSenses.push(inp);
        continue;
      }
      const sentenceTr = (sentence && inp.source_sentence_tr?.trim()) || null;
      const fields = {
        lexicon_sense_id: inp.lexicon_sense_id ?? null,
        pos: inp.pos ?? null,
        gloss_en: inp.gloss_en ?? null,
        meaning_tr: inp.meaning_tr.trim(),
        meaning_tr_override: inp.meaning_tr_override?.trim() || null,
        source_sentence: sentence,
        source_sentence_tr: sentenceTr,
        span: cleanSpan(sentence, inp.span),
        source_id: inp.source_id ?? null,
      };
      const old = senses.find((s) => s.deleted_at !== null && matches(s));
      const sense = old
        ? await w.put('senses', {
            ...old,
            deleted_at: null,
            sense_no: nextNo++,
            ...(fields.source_sentence
              ? { source_sentence: fields.source_sentence, source_sentence_tr: fields.source_sentence_tr, span: fields.span }
              : {}),
          })
        : await w.put('senses', { ...w.base(), note_id: note.id, sense_no: nextNo++, ...fields });
      senses.push(sense);
      addedSenses.push(sense);
      createdCards.push(...(await ensureSenseCards(w, sense, recState, note.term_type)));
    }
    return { note, status, addedSenses, skippedSenses, createdCards };
  });
}

export interface NotePatch {
  term?: string;
  term_type?: NoteTermType;
  ipa?: string | null;
  tags?: string[];
  lexicon_term_id?: Id | null;
  /** The user's own level; null = the computed one. */
  level_override?: CefrLevel | null;
}

/**
 * Edit a note. Changing the term re-derives term_norm.
 * @throws ActionError('duplicate_term') if another live note already has the new term.
 */
export async function editNote(noteId: Id, patch: NotePatch, now: Millis = Date.now()): Promise<Note> {
  return writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    const note = await db.notes.get(noteId);
    if (!note) throw new ActionError('not_found');
    const next: Note = { ...note, ...patch };
    if (patch.tags) next.tags = uniqueTags(patch.tags);
    if (patch.term !== undefined) {
      next.term = patch.term.normalize('NFC').replace(/\s+/g, ' ').trim();
      next.term_norm = normalizeTerm(next.term);
      if (!next.term_norm) throw new ActionError('invalid_input', 'Empty term');
      const clash = await db.notes.where('term_norm').equals(next.term_norm).filter((n) => n.id !== noteId && n.deleted_at === null).count();
      if (clash) throw new ActionError('duplicate_term');
    }
    assertNoteFits(next);
    const saved = await w.put('notes', next);
    if ((note.term_type === 'affix') !== (saved.term_type === 'affix')) {
      // Becoming (or no longer being) a root/affix card changes which cards a sense has.
      const rec = await recognitionOf(noteId);
      for (const s of await db.senses.where('note_id').equals(noteId).toArray())
        if (s.deleted_at === null) await ensureSenseCards(w, s, rec?.state ?? null, saved.term_type);
    }
    return saved;
  });
}

const LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Set (or with null, clear) the user's own level of a note. Synced; only this user sees it.
 * @throws ActionError('invalid_input') for anything but A1–C2 or null.
 */
export async function setLevelOverride(noteId: Id, level: CefrLevel | null, now: Millis = Date.now()): Promise<Note> {
  if (level !== null && !LEVELS.includes(level)) throw new ActionError('invalid_input', 'Unknown level');
  const note = await db.notes.get(noteId);
  if (!note) throw new ActionError('not_found');
  if ((note.level_override ?? null) === level) return note;
  return editNote(noteId, { level_override: level }, now);
}

export type SensePatch = Partial<
  Pick<
    Sense,
    'meaning_tr' | 'meaning_tr_override' | 'gloss_en' | 'pos' | 'source_sentence' | 'source_sentence_tr' | 'span' | 'lexicon_sense_id' | 'sense_no'
  >
>;

/**
 * Edit a sense. Adding a sentence + span creates (or revives) its cloze card; removing
 * them soft-deletes it. A new sentence without a new translation drops the old one.
 * @throws ActionError('invalid_input') for an empty meaning or a span outside the sentence.
 */
export async function editSense(senseId: Id, patch: SensePatch, now: Millis = Date.now()): Promise<Sense> {
  return writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    const sense = await db.senses.get(senseId);
    if (!sense) throw new ActionError('not_found');
    const next: Sense = { ...sense, ...patch };
    if (!next.meaning_tr.trim()) throw new ActionError('invalid_input', 'Empty meaning');
    if (next.source_sentence !== null && !next.source_sentence.trim()) next.source_sentence = null;
    if (next.span && !(next.source_sentence && isValidSpan(next.source_sentence, next.span))) {
      if (patch.span) throw new ActionError('invalid_input', 'Span outside sentence');
      next.span = null; // sentence changed under an old span
    }
    if (!next.source_sentence) next.span = null;
    if (patch.source_sentence_tr === undefined && next.source_sentence !== sense.source_sentence) next.source_sentence_tr = null;
    next.source_sentence_tr = (next.source_sentence && next.source_sentence_tr?.trim()) || null;
    assertSenseFits(next);
    const saved = await w.put('senses', next);
    if (saved.deleted_at === null) {
      const rec = await recognitionOf(saved.note_id);
      const termType = (await db.notes.get(saved.note_id))?.term_type ?? 'word';
      await ensureSenseCards(w, saved, rec?.state ?? null, termType);
    }
    return saved;
  });
}

/** Suspend or unsuspend cards, by id or every card of a note. */
export async function setSuspended(
  target: { card_ids: Id[] } | { note_id: Id },
  suspended: boolean,
  now: Millis = Date.now(),
): Promise<number> {
  return writeTx([db.cards], now, async (w) => {
    const cards =
      'note_id' in target
        ? await db.cards.where('note_id').equals(target.note_id).toArray()
        : (await db.cards.bulkGet(target.card_ids)).filter((c): c is Card => !!c);
    let n = 0;
    for (const c of cards) {
      if (c.suspended !== suspended) {
        await w.put('cards', { ...c, suspended });
        n++;
      }
    }
    return n;
  });
}

/** Soft-delete a note with its senses and cards. Review logs are kept. */
export async function softDeleteNote(noteId: Id, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    const note = await db.notes.get(noteId);
    if (!note) throw new ActionError('not_found');
    if (note.deleted_at === null) await w.put('notes', { ...note, deleted_at: now });
    for (const s of await db.senses.where('note_id').equals(noteId).toArray()) {
      if (s.deleted_at === null) await w.put('senses', { ...s, deleted_at: now });
    }
    for (const c of await db.cards.where('note_id').equals(noteId).toArray()) {
      if (c.deleted_at === null) await w.put('cards', { ...c, deleted_at: now });
    }
  });
}

/** Soft-delete one sense and its production/cloze cards. */
export async function softDeleteSense(senseId: Id, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.senses, db.cards], now, async (w) => {
    const sense = await db.senses.get(senseId);
    if (!sense) throw new ActionError('not_found');
    if (sense.deleted_at === null) await w.put('senses', { ...sense, deleted_at: now });
    for (const c of await db.cards.where('sense_id').equals(senseId).toArray()) {
      if (c.deleted_at === null) await w.put('cards', { ...c, deleted_at: now });
    }
  });
}

/** Record the metadata of an imported text or PDF. */
export async function createSource(
  input: Pick<Source, 'kind' | 'title'> & Partial<Pick<Source, 'file_name' | 'page_count'>>,
  now: Millis = Date.now(),
): Promise<Source> {
  // Metadata only: cut to the server's limits instead of failing the import.
  return writeTx([db.sources], now, (w) =>
    w.put('sources', {
      ...w.base(),
      kind: input.kind,
      title: truncateCodePoints(input.title, LIMITS.source_title),
      file_name: input.file_name == null ? null : truncateCodePoints(input.file_name, LIMITS.file_name),
      page_count: input.page_count ?? null,
    }),
  );
}

// ------------------------------------------------------------------ answering

export interface AnswerInput {
  card_id: Id;
  rating: RatingValue;
  /** Time from showing the card to the answer; capped at 60 s. */
  duration_ms: number;
  /** Recognition card: the sense whose sentence was shown. */
  shown_sense_id?: Id | null;
}

export interface AnswerResult {
  log: ReviewLog;
  card: Card;
  /** Production/cloze cards unlocked by this answer. */
  unlockedCardIds: Id[];
  day: DailyActivity;
}

/**
 * Answer a card: writes the review log, updates the card's FSRS state, unlocks the note's
 * production/cloze cards when the recognition card reaches Review, and updates today's
 * daily_activity row — all in one transaction.
 */
export async function answerCard(input: AnswerInput, now: Millis = Date.now()): Promise<AnswerResult> {
  if (!isRating(input.rating)) throw new ActionError('invalid_input', 'Invalid rating');
  return writeTx([db.cards, db.review_logs, db.daily_activity, db.settings], now, async (w) => {
    const settings = await getSettings(now);
    const cfg = dayConfig(settings);
    const card = await db.cards.get(input.card_id);
    if (!card) throw new ActionError('not_found');
    if (card.deleted_at !== null) throw new ActionError('deleted');

    const before = card.state;
    const fsrs = applyRating(schedulerFor(settings), card, input.rating, now);
    const duration = Math.min(MAX_DURATION_MS, Math.max(0, Math.round(input.duration_ms || 0)));
    const log: ReviewLog = {
      id: w.newId(),
      user_id: w.userId,
      card_id: card.id,
      rating: input.rating,
      reviewed_at: now,
      duration_ms: duration,
      device_id: w.deviceId,
      undo_of: null,
      shown_sense_id: input.shown_sense_id ?? null,
      created_at: now,
      hlc: w.nextHlc(),
    };
    await w.insertLog(log);
    const saved = await w.put('cards', { ...card, ...fsrs, unlocked: true });
    const unlockedCardIds = card.card_type === 'recognition' ? await syncUnlocked(w, card.note_id, fsrs.state) : [];

    const key = dayKeyOf(now, cfg);
    const day = (await db.daily_activity.get(key)) ?? emptyDay(key);
    addAnswerToDay(day, { before_state: before, rating: input.rating, duration_ms: duration });
    day.completed = await isTodayComplete(cfg, now);
    await db.daily_activity.put(day);
    return { log, card: saved, unlockedCardIds, day };
  });
}

/** The latest answer of the current day that can still be undone, if any. */
export async function getLastUndoableAnswer(now: Millis = Date.now()): Promise<ReviewLog | null> {
  const settings = await getSettings(now);
  const facts = await loadTodayFacts(dayConfig(settings), now);
  return facts.answers.at(-1) ?? null;
}

/**
 * Undo an answer: adds an undo row (undo_of = logId), recomputes the card from its
 * remaining logs, re-locks production/cloze cards that were unlocked only by it, and
 * recounts that day's daily_activity. The original log is never changed.
 * @throws ActionError('already_undone' | 'not_undoable' | 'not_found')
 */
export async function undoAnswer(logId: Id, now: Millis = Date.now()): Promise<{ card: Card; undone: ReviewLog }> {
  return writeTx([db.cards, db.review_logs, db.daily_activity, db.settings], now, async (w) => {
    const settings = await getSettings(now);
    const cfg = dayConfig(settings);
    const scheduler = schedulerFor(settings);
    const log = await db.review_logs.get(logId);
    if (!log) throw new ActionError('not_found');
    if (log.undo_of !== null) throw new ActionError('not_undoable');
    const allLogs = (await logsByCard([log.card_id])).get(log.card_id) ?? [];
    if (!effectiveLogs(allLogs).some((l) => l.id === logId)) throw new ActionError('already_undone');

    const undo: ReviewLog = {
      id: w.newId(),
      user_id: w.userId,
      card_id: log.card_id,
      rating: log.rating,
      reviewed_at: Math.max(now, log.reviewed_at),
      duration_ms: 0,
      device_id: w.deviceId,
      undo_of: log.id,
      shown_sense_id: null,
      created_at: now,
      hlc: w.nextHlc(),
    };
    await w.insertLog(undo);

    let card = await db.cards.get(log.card_id);
    if (!card) throw new ActionError('not_found');
    const { fsrs } = replayCard(scheduler, card, [...allLogs, undo]);
    if (!fsrsEqual(fsrs, pickFsrs(card))) card = await w.put('cards', { ...card, ...fsrs });
    if (card.card_type === 'recognition') await syncUnlocked(w, card.note_id, fsrs.state);
    await refreshDay(dayKeyOf(log.reviewed_at, cfg), cfg, scheduler, now);
    return { card, undone: log };
  });
}
