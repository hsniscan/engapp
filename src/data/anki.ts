// Anki import, write side (v0.3 İP1, docs/decisions/0019-anki-import.md). The plan comes from
// domain/anki.ts; this file turns it into rows in transactions of ANKI_CHUNK_NOTES notes.
//
// - A term the library does not have at all becomes a new note with its Anki history: review
//   logs (origin 'anki', ids derived from card + revlog id) and cards replayed from them.
// - A term the library already has (live or deleted) goes through addNoteWithSenses: a new
//   meaning is added as a sense, a known one is left alone, and no history is attached.
// - So a second import of the same file finds every term and adds nothing; an interrupted
//   import continues where it stopped when the file is imported again.
import { dayBounds } from '../domain/day';
import { ankiLogId, matchLexiconSense, sameMeaning, type AnkiPlan, type PlannedCard, type PlannedNote } from '../domain/anki';
import { emptyFsrs } from '../domain/fsrs';
import { LIMITS, truncateCodePoints } from '../domain/limits';
import { canHaveCloze } from '../domain/recognition';
import { deriveUnlocked, type RecognitionUnlockInput, replayCard } from '../domain/recompute';
import type {
  AnkiImportCounts,
  AnkiImportRecord,
  Card,
  CardType,
  Id,
  LexiconSense,
  Millis,
  Note,
  ReviewLog,
  Sense,
  Source,
} from '../domain/types';
import { addNoteWithSenses } from './actions';
import { rebuildDailyActivity } from './dailyActivity';
import { db } from './db';
import { cacheLexiconSenses } from './lexicon';
import { dayConfig, getSettings, schedulerFor } from './settings';
import { writeTx, type SyncWriter } from './writer';

/** Notes per write transaction (their senses, cards and logs go together). */
export const ANKI_CHUNK_NOTES = 500;

export interface AnkiImportProgress {
  done: number;
  total: number;
}

export interface AnkiImportResult {
  source_id: Id;
  counts: AnkiImportCounts;
}

/** The import's source row: one per file name, reused when the same file comes again. */
async function ankiSource(fileName: string, now: Millis): Promise<Source> {
  const title = truncateCodePoints(fileName.replace(/\.(apkg|colpkg)$/i, '') || fileName, LIMITS.source_title);
  return writeTx([db.sources], now, async (w) => {
    const same = (await db.sources.toArray()).find((s) => s.kind === 'anki' && s.deleted_at === null && s.file_name === fileName);
    if (same) return same;
    return w.put('sources', {
      ...w.base(),
      kind: 'anki',
      title,
      file_name: truncateCodePoints(fileName, LIMITS.file_name),
      page_count: null,
    });
  });
}

interface CardRows {
  card: Card;
  logs: ReviewLog[];
}

function buildCard(
  w: SyncWriter,
  scheduler: ReturnType<typeof schedulerFor>,
  base: { note_id: Id; sense_id: Id | null; card_type: CardType; created_at: Millis },
  planned: PlannedCard | null,
  shownSenseId: Id | null,
  recognition: RecognitionUnlockInput | null,
): CardRows {
  const id = w.newId();
  const created_at = planned?.created_at ?? base.created_at;
  const logs: ReviewLog[] = (planned?.logs ?? []).map((l) => ({
    id: ankiLogId(id, l.revlog_id),
    user_id: w.userId,
    card_id: id,
    rating: l.rating,
    reviewed_at: l.reviewed_at,
    duration_ms: l.duration_ms,
    device_id: w.deviceId,
    undo_of: null,
    shown_sense_id: shownSenseId,
    created_at: w.now,
    hlc: w.nextHlc(),
    origin: 'anki',
  }));
  const fsrs = logs.length ? replayCard(scheduler, { id, created_at }, logs).fsrs : emptyFsrs(created_at);
  const unlocked = deriveUnlocked({ card_type: base.card_type, ...fsrs }, recognition);
  const card: Card = {
    ...w.base(id),
    created_at,
    note_id: base.note_id,
    sense_id: base.sense_id,
    card_type: base.card_type,
    suspended: planned?.suspended ?? false,
    unlocked,
    ...fsrs,
  };
  return { card, logs };
}

/** Rows of one new note: note, senses, the standard card set (invariant 5) and the logs. */
function buildNote(w: SyncWriter, scheduler: ReturnType<typeof schedulerFor>, p: PlannedNote, sourceId: Id) {
  const note: Note = {
    ...w.base(),
    created_at: p.created_at,
    term: p.term,
    term_norm: p.term_norm,
    term_type: p.term.includes(' ') ? 'phrase' : 'word',
    lexicon_term_id: null,
    ipa: null,
    tags: p.tags,
    possible_duplicate: false,
    level_override: null,
  };
  const senses: Sense[] = p.senses.map((s, i) => ({
    ...w.base(),
    created_at: p.created_at,
    note_id: note.id,
    sense_no: i + 1,
    lexicon_sense_id: null,
    pos: null,
    gloss_en: null,
    meaning_tr: s.meaning_tr,
    meaning_tr_override: null,
    source_sentence: s.source_sentence,
    source_sentence_tr: null,
    span: s.source_sentence ? s.span : null,
    source_id: sourceId,
  }));
  const rec = buildCard(
    w,
    scheduler,
    { note_id: note.id, sense_id: null, card_type: 'recognition', created_at: p.created_at },
    p.recognition,
    senses[0]?.id ?? null,
    null,
  );
  const out: CardRows[] = [rec];
  p.senses.forEach((ps, i) => {
    const sense = senses[i]!;
    out.push(buildCard(w, scheduler, { note_id: note.id, sense_id: sense.id, card_type: 'production', created_at: p.created_at }, ps.production, null, rec.card));
    if (canHaveCloze(sense))
      out.push(buildCard(w, scheduler, { note_id: note.id, sense_id: sense.id, card_type: 'cloze', created_at: p.created_at }, null, null, rec.card));
  });
  return { note, senses, cards: out.map((c) => c.card), logs: out.flatMap((c) => c.logs) };
}

function emptyCounts(plan: AnkiPlan): AnkiImportCounts {
  const c = plan.counts;
  return {
    notes: c.notes,
    created: 0,
    sensesAdded: 0,
    alreadyHad: 0,
    skippedNoteType: c.skippedNoteType,
    skippedEmpty: c.skippedEmpty,
    sameInFile: c.sameInFile,
    cards: c.cards,
    cardsMapped: 0,
    cardsIgnored: c.cardsIgnored,
    cardsMerged: c.cardsMerged,
    logs: 0,
    logsSkipped: c.logsSkipped,
    suspended: 0,
    media: c.media,
  };
}

/**
 * Write a planned import. New terms get their notes, cards and history in transactions of
 * `chunkNotes`; terms already in the library get only meanings they lack. daily_activity is
 * rebuilt at the end (the history fills the heatmap and the streak).
 */
export async function importAnkiPlan(
  plan: AnkiPlan,
  fileName: string,
  opts: { onProgress?: (p: AnkiImportProgress) => void; chunkNotes?: number } = {},
  now: Millis = Date.now(),
): Promise<AnkiImportResult> {
  const chunkNotes = opts.chunkNotes ?? ANKI_CHUNK_NOTES;
  const source = await ankiSource(fileName, now);
  const counts = emptyCounts(plan);
  const settings = await getSettings(now);
  const scheduler = schedulerFor(settings);

  const known = new Set<string>();
  await db.notes.each((n) => known.add(n.term_norm));
  const fresh = plan.notes.filter((p) => !known.has(p.term_norm));
  const existing = plan.notes.filter((p) => known.has(p.term_norm));
  const total = plan.notes.length;
  let done = 0;
  const created: Id[] = [];
  opts.onProgress?.({ done, total });

  for (let i = 0; i < fresh.length; i += chunkNotes) {
    const chunk = fresh.slice(i, i + chunkNotes);
    await writeTx([db.notes, db.senses, db.cards, db.review_logs], now, async (w) => {
      const notes: Note[] = [];
      const senses: Sense[] = [];
      const cards: Card[] = [];
      const logs: ReviewLog[] = [];
      for (const p of chunk) {
        const rows = buildNote(w, scheduler, p, source.id);
        notes.push(rows.note);
        senses.push(...rows.senses);
        cards.push(...rows.cards);
        logs.push(...rows.logs);
        counts.cardsMapped += (p.recognition ? 1 : 0) + p.senses.filter((s) => s.production).length;
        counts.suspended += rows.cards.filter((c) => c.suspended).length;
      }
      await db.notes.bulkPut(notes);
      await db.senses.bulkPut(senses);
      await db.cards.bulkPut(cards);
      for (const n of notes) w.enqueue('notes', n.id, 'upsert', n);
      for (const s of senses) w.enqueue('senses', s.id, 'upsert', s);
      for (const c of cards) w.enqueue('cards', c.id, 'upsert', c);
      await w.insertLogs(logs);
      counts.logs += logs.length;
      counts.created += notes.length;
      created.push(...notes.map((n) => n.id));
    });
    done += chunk.length;
    opts.onProgress?.({ done, total });
  }

  for (const p of existing) {
    const live = await db.notes.where('term_norm').equals(p.term_norm).filter((n) => n.deleted_at === null).first();
    const liveSenses = live ? (await db.senses.where('note_id').equals(live.id).toArray()).filter((s) => s.deleted_at === null) : [];
    const missing = p.senses.filter((ps) => !liveSenses.some((s) => sameMeaning(s.meaning_tr_override?.trim() || s.meaning_tr, ps.meaning_tr)));
    const dropped = (p.recognition?.logs.length ?? 0) + p.senses.reduce((n, s) => n + (s.production?.logs.length ?? 0), 0);
    counts.logsSkipped += dropped;
    counts.cardsIgnored += (p.recognition ? 1 : 0) + p.senses.filter((s) => s.production).length;
    if (live && missing.length === 0) {
      counts.alreadyHad++;
    } else {
      const res = await addNoteWithSenses(
        {
          term: p.term,
          tags: p.tags,
          one_sense_per_sentence: true,
          senses: missing.map((s) => ({ meaning_tr: s.meaning_tr, source_sentence: s.source_sentence, span: s.span, source_id: source.id })),
        },
        now,
      );
      counts.sensesAdded += res.addedSenses.length;
      if (res.addedSenses.length === 0) counts.alreadyHad++;
    }
    done++;
    if (done % 50 === 0 || done === total) opts.onProgress?.({ done, total });
  }

  if (counts.logs > 0) await rebuildDailyActivity(now);
  const prev = await db.anki_imports.get(source.id);
  const record: AnkiImportRecord = {
    id: source.id,
    file_name: fileName,
    created_at: prev?.created_at ?? now,
    updated_at: now,
    counts,
    note_ids: [...(prev?.note_ids ?? []), ...created],
    enrich: prev?.enrich ?? { status: 'off', pending: [], matched: 0, term_only: 0, unmatched: 0, paused_until: null, error: null },
  };
  await db.anki_imports.put(record);
  return { source_id: source.id, counts };
}

export function getAnkiImport(id: Id): Promise<AnkiImportRecord | undefined> {
  return db.anki_imports.get(id);
}

export function listAnkiImports(): Promise<AnkiImportRecord[]> {
  return db.anki_imports.orderBy('created_at').reverse().toArray();
}

// ------------------------------------------------------------------ "Sözlükle eşleştir"

/**
 * Queue the import's notes that are not linked to the shared lexicon yet. The runner
 * (src/features/anki/enrichQueue.ts) looks them up a batch at a time.
 */
export async function startAnkiEnrich(id: Id, now: Millis = Date.now()): Promise<AnkiImportRecord | null> {
  return db.transaction('rw', [db.anki_imports, db.notes], async () => {
    const rec = await db.anki_imports.get(id);
    if (!rec) return null;
    const notes = await db.notes.bulkGet(rec.note_ids);
    const pending = notes.filter((n): n is Note => !!n && n.deleted_at === null && n.lexicon_term_id === null).map((n) => n.id);
    const next: AnkiImportRecord = {
      ...rec,
      updated_at: now,
      enrich: { ...rec.enrich, status: pending.length ? 'queued' : 'done', pending, paused_until: null, error: null },
    };
    await db.anki_imports.put(next);
    return next;
  });
}

export interface AnkiEnrichItem {
  import_id: Id;
  note_id: Id;
  term: string;
  senses: { id: Id; meaning: string }[];
}

/** The next notes to look up: from the first queued import whose pause is over. */
export async function nextAnkiEnrichItems(limit: number, now: Millis = Date.now()): Promise<AnkiEnrichItem[]> {
  const recs = await db.anki_imports.orderBy('created_at').toArray();
  const rec = recs.find((r) => (r.enrich.status === 'queued' || r.enrich.status === 'paused') && (r.enrich.paused_until ?? 0) <= now && r.enrich.pending.length > 0);
  if (!rec) return [];
  const out: AnkiEnrichItem[] = [];
  for (const noteId of rec.enrich.pending.slice(0, limit)) {
    const note = await db.notes.get(noteId);
    const senses = note ? (await db.senses.where('note_id').equals(noteId).toArray()).filter((s) => s.deleted_at === null) : [];
    out.push({
      import_id: rec.id,
      note_id: noteId,
      term: note && note.deleted_at === null ? note.term : '',
      senses: senses.map((s) => ({ id: s.id, meaning: s.meaning_tr_override?.trim() || s.meaning_tr })),
    });
  }
  return out;
}

/** Earliest time a paused import may continue (null: nothing waits). */
export async function nextAnkiEnrichWake(): Promise<Millis | null> {
  const times = (await db.anki_imports.toArray())
    .filter((r) => r.enrich.status === 'paused' && r.enrich.pending.length > 0 && r.enrich.paused_until !== null)
    .map((r) => r.enrich.paused_until!);
  return times.length ? Math.min(...times) : null;
}

export type AnkiEnrichOutcome = 'matched' | 'term_only' | 'unmatched';

/**
 * Store one lookup: the note gets the lexicon term (and its IPA when it has none), each
 * sense with the same meaning as a lexicon sense is linked to it (level, examples, family
 * then work as for any lexicon word). The user's own meaning is never replaced.
 */
export async function applyAnkiEnrichResult(
  item: AnkiEnrichItem,
  found: { term_id: Id; senses: LexiconSense[] } | null,
  now: Millis = Date.now(),
): Promise<AnkiEnrichOutcome> {
  if (found?.senses.length) await cacheLexiconSenses(found.senses);
  return writeTx([db.notes, db.senses, db.anki_imports], now, async (w) => {
    let outcome: AnkiEnrichOutcome = 'unmatched';
    const note = await db.notes.get(item.note_id);
    if (found && note && note.deleted_at === null) {
      outcome = 'term_only';
      const ipa = note.ipa ?? found.senses.find((s) => s.ipa)?.ipa ?? null;
      if (note.lexicon_term_id !== found.term_id || note.ipa !== ipa) await w.put('notes', { ...note, lexicon_term_id: found.term_id, ipa });
      const senses = (await db.senses.where('note_id').equals(note.id).toArray()).filter((s) => s.deleted_at === null && s.lexicon_sense_id === null);
      const taken = new Set((await db.senses.where('note_id').equals(note.id).toArray()).map((s) => s.lexicon_sense_id));
      for (const s of senses) {
        const lex = matchLexiconSense(s.meaning_tr_override?.trim() || s.meaning_tr, found.senses.filter((l) => !taken.has(l.id)));
        if (!lex) continue;
        taken.add(lex.id);
        outcome = 'matched';
        await w.put('senses', { ...s, lexicon_sense_id: lex.id, pos: s.pos ?? lex.pos, gloss_en: s.gloss_en ?? lex.gloss_en });
      }
    }
    const rec = await db.anki_imports.get(item.import_id);
    if (rec) {
      const pending = rec.enrich.pending.filter((id) => id !== item.note_id);
      await db.anki_imports.put({
        ...rec,
        updated_at: now,
        enrich: {
          ...rec.enrich,
          pending,
          status: pending.length ? rec.enrich.status : 'done',
          matched: rec.enrich.matched + (outcome === 'matched' ? 1 : 0),
          term_only: rec.enrich.term_only + (outcome === 'term_only' ? 1 : 0),
          unmatched: rec.enrich.unmatched + (outcome === 'unmatched' ? 1 : 0),
          error: null,
        },
      });
    }
    return outcome;
  });
}

/** Stop the lookups until `until` (daily AI limit, offline); they continue from there. */
export async function pauseAnkiEnrich(id: Id, until: Millis, error: string, now: Millis = Date.now()): Promise<void> {
  await db.transaction('rw', db.anki_imports, async () => {
    const rec = await db.anki_imports.get(id);
    if (!rec || rec.enrich.status === 'done' || rec.enrich.status === 'off') return;
    await db.anki_imports.put({ ...rec, updated_at: now, enrich: { ...rec.enrich, status: 'paused', paused_until: until, error } });
  });
}

/** When lookups stopped by the daily AI limit continue: the start of the next local day. */
export async function ankiEnrichResumeAt(now: Millis = Date.now()): Promise<Millis> {
  return dayBounds(now, dayConfig(await getSettings(now))).end;
}
