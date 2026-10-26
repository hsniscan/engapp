// Whole-database operations: recompute, sync apply hook, backup/restore, CSV, integrity.
import { z } from 'zod';
import {
  type BackupFile,
  type BackupTables,
  buildBackup,
  buildNotesCsv,
  type CsvHeaders,
  verifyBackup,
} from '../domain/backup';
import { fsrsEqual, pickFsrs } from '../domain/fsrs';
import { compareHlc } from '../domain/hlc';
import { checkIntegrity, type IntegrityReport } from '../domain/integrity';
import { keepProfileFields } from '../domain/profile';
import { fillLateColumns } from '../domain/syncMerge';
import { primaryRecognition } from '../domain/leech';
import { deriveUnlocked, effectiveLogs, replayCard } from '../domain/recompute';
import {
  cardSchema,
  contentFeedbackSchema,
  deckSchema,
  knownTermSchema,
  levelTestSchema,
  noteSchema,
  practiceLogSchema,
  reviewLogSchema,
  senseSchema,
  settingsSchema,
  sourceSchema,
  userContentSchema,
  weeklyReportSchema,
  readerTextSchema,
  encounterRowSchema,
} from '../domain/schemas';
import {
  type Card,
  type Id,
  type LevelTest,
  type Millis,
  type Note,
  type PracticeLog,
  type ReviewLog,
  type Settings,
  type WeeklyReport,
} from '../domain/types';
import { emptyFsrs } from '../domain/fsrs';
import { db, STAGE_RULE_NOTICE_KEY } from './db';
import { compactGuestOutbox, compactOutbox } from './outbox';
import { whileRestoring } from './restoreState';
import { rebuildDailyActivity } from './dailyActivity';
import { ActionError } from './errors';
import { groupLogs } from './history';
import { getDeviceId, getMeta, META, setMeta } from './meta';
import { dayConfig, getSettings, schedulerFor, updateSettings } from './settings';
import { type MutableRows, type MutableTable, type SyncWriter, writeTx } from './writer';

const MUTABLE: MutableTable[] = [
  'notes',
  'senses',
  'cards',
  'sources',
  'settings',
  'content_feedback',
  'user_content',
  'decks',
  'known_terms',
  'texts',
  'encounters',
];
const allSyncedTables = () => [
  db.content_feedback,
  db.user_content,
  db.level_tests,
  db.known_terms,
  db.notes,
  db.senses,
  db.cards,
  db.review_logs,
  db.sources,
  db.settings,
  db.practice_logs,
  db.decks,
  db.weekly_reports,
  db.texts,
  db.encounters,
];

// ------------------------------------------------------------------ recompute

const sameParams = (a: number[] | null | undefined, b: number[] | null | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Recompute FSRS fields (from logs) and `unlocked` (from the recognition card) for the given
 * cards, or all cards. Writes only cards that changed. Call inside writeTx.
 */
export async function recomputeCardsIn(
  w: SyncWriter,
  cardIds: Iterable<Id> | 'all',
): Promise<number> {
  const settings = await getSettings(w.now);
  const scheduler = schedulerFor(settings);
  let cards: Card[];
  let byCard: Map<Id, ReviewLog[]>;
  if (cardIds === 'all') {
    cards = await db.cards.toArray();
    byCard = groupLogs(await db.review_logs.toArray());
  } else {
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return 0;
    // Siblings matter for unlock: include every card of the touched notes.
    const touched = (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c);
    const noteIds = [...new Set(touched.map((c) => c.note_id))];
    cards = noteIds.length ? await db.cards.where('note_id').anyOf(noteIds).toArray() : [];
    byCard = groupLogs(
      await db.review_logs
        .where('card_id')
        .anyOf(cards.map((c) => c.id))
        .toArray(),
    );
  }

  const updated = new Map<Id, Card>();
  for (const c of cards) {
    const { fsrs } = replayCard(scheduler, c, byCard.get(c.id) ?? []);
    updated.set(c.id, fsrsEqual(fsrs, pickFsrs(c)) ? c : { ...c, ...fsrs });
  }
  // The primary recognition card of each note drives the unlock rule (domain/leech.ts).
  const recognitionByNote = new Map<Id, Card[]>();
  for (const c of updated.values()) {
    if (c.card_type !== 'recognition') continue;
    const list = recognitionByNote.get(c.note_id);
    if (list) list.push(c);
    else recognitionByNote.set(c.note_id, [c]);
  }
  const recognitionOfNote = new Map<Id, Card>();
  for (const [noteId, list] of recognitionByNote) {
    const primary = primaryRecognition(list);
    if (primary) recognitionOfNote.set(noteId, primary);
  }
  const changed: Card[] = [];
  for (const original of cards) {
    let c = updated.get(original.id)!;
    const unlocked = deriveUnlocked(c, recognitionOfNote.get(c.note_id) ?? null);
    if (unlocked !== c.unlocked) c = { ...c, unlocked };
    if (c !== original) changed.push(c);
  }
  await w.putMany('cards', changed);
  return changed.length;
}

/** Rebuild every card's FSRS state and unlock flag from the review logs. */
export async function recomputeAllCards(now: Millis = Date.now()): Promise<number> {
  return writeTx([db.cards, db.review_logs, db.settings], now, (w) => recomputeCardsIn(w, 'all'));
}

// ------------------------------------------------------------------ learning model (ADR 0041)

/** Meta key: the one-off replay that fills ramp_step / learned_at has run on this device. */
export const LEARNING_MODEL_BACKFILL_KEY = 'learning_model_backfill_v1';

/**
 * One-off job after the upgrade to the learning model: replay every card from its logs to fill
 * ramp_step and learned_at (the v26 Dexie upgrade only set them to 0 / null). Due dates do not
 * change, because every log written before the release is before RAMP_EPOCH and is replayed
 * without caps. Changed cards are queued, so the server gets the derived values too. Runs once
 * per device; returns the number of cards written (0 when it already ran).
 */
export async function backfillLearningModel(now: Millis = Date.now()): Promise<number> {
  if ((await getMeta<boolean>(LEARNING_MODEL_BACKFILL_KEY)) === true) return 0;
  const changed = await recomputeAllCards(now);
  await setMeta(LEARNING_MODEL_BACKFILL_KEY, true);
  return changed;
}

/** The one-time Bugün note about the new counting rule is still to be shown. */
export async function stageRuleNoticePending(): Promise<boolean> {
  return (await getMeta<boolean>(STAGE_RULE_NOTICE_KEY)) === false;
}

/** The user saw (or closed) the note about the new counting rule. */
export async function markStageRuleNoticeSeen(): Promise<void> {
  await setMeta(STAGE_RULE_NOTICE_KEY, true);
}

// ------------------------------------------------------------------ reset study history

/** Notes per transaction in resetStudyHistory (their cards and logs go together). */
export const RESET_CHUNK_NOTES = 200;

export interface ResetHistoryResult {
  /** Answers cancelled (one undo row each). */
  undoneLogs: number;
  /** Cards whose state changed (back to New, re-locked). */
  resetCards: number;
}

/** One undo row per answer that still counts; the logs themselves are never changed. */
async function undoLogsIn(w: SyncWriter, logs: ReviewLog[]): Promise<number> {
  const undo: ReviewLog[] = [];
  for (const list of groupLogs(logs).values()) {
    for (const log of effectiveLogs(list)) {
      undo.push({
        id: w.newId(),
        user_id: w.userId,
        card_id: log.card_id,
        rating: log.rating,
        reviewed_at: Math.max(w.now, log.reviewed_at),
        duration_ms: 0,
        device_id: w.deviceId,
        undo_of: log.id,
        shown_sense_id: null,
        created_at: w.now,
        hlc: w.nextHlc(),
      });
    }
  }
  await w.insertLogs(undo);
  return undo.length;
}

/**
 * "Çalışma geçmişini sıfırla": every card goes back to New and the review history stops
 * counting, so stats, streak and the heatmap start empty. Logs are immutable, so each
 * answer that still counts gets an undo row (the same rows undoAnswer writes); the server
 * accepts them as ordinary log inserts and other devices recompute their cards from them
 * when they pull. Cards are then recomputed (New, production/cloze re-locked) and queued.
 * Notes, senses, cards and suspensions are kept.
 *
 * Runs in transactions of `chunkNotes` notes; an interrupted reset is finished by
 * running it again (answers already undone no longer count).
 */
export async function resetStudyHistory(
  now: Millis = Date.now(),
  chunkNotes = RESET_CHUNK_NOTES,
): Promise<ResetHistoryResult> {
  const res: ResetHistoryResult = { undoneLogs: 0, resetCards: 0 };
  const cardNote = new Map<Id, Id>();
  await db.cards.each((c) => cardNote.set(c.id, c.note_id));
  const noteIds = [...new Set(cardNote.values())];
  for (let i = 0; i < noteIds.length; i += chunkNotes) {
    const chunk = noteIds.slice(i, i + chunkNotes);
    await writeTx([db.cards, db.review_logs, db.settings], now, async (w) => {
      const cardIds = (await db.cards.where('note_id').anyOf(chunk).primaryKeys()) as Id[];
      res.undoneLogs += await undoLogsIn(
        w,
        await db.review_logs.where('card_id').anyOf(cardIds).toArray(),
      );
      res.resetCards += await recomputeCardsIn(w, cardIds);
    });
  }
  // Logs whose card is not on this device (it may still arrive by sync) are history too.
  const orphanCardIds = ((await db.review_logs.orderBy('card_id').uniqueKeys()) as Id[]).filter(
    (id) => !cardNote.has(id),
  );
  for (let i = 0; i < orphanCardIds.length; i += chunkNotes) {
    const chunk = orphanCardIds.slice(i, i + chunkNotes);
    await writeTx([db.review_logs], now, async (w) => {
      res.undoneLogs += await undoLogsIn(
        w,
        await db.review_logs.where('card_id').anyOf(chunk).toArray(),
      );
    });
  }
  await rebuildDailyActivity(now);
  return res;
}

// ------------------------------------------------------------------ sync hook

type InsertOnlyRemote = 'review_logs' | 'practice_logs' | 'level_tests' | 'weekly_reports';
export type RemoteBatch = Partial<Record<MutableTable | InsertOnlyRemote, unknown[]>>;

export interface ApplyRemoteResult {
  applied: number;
  skipped: number;
  invalid: number;
  recomputedCards: number;
}

const rowSchemas = {
  notes: noteSchema,
  senses: senseSchema,
  cards: cardSchema,
  sources: sourceSchema,
  settings: settingsSchema,
  review_logs: reviewLogSchema,
  practice_logs: practiceLogSchema,
  content_feedback: contentFeedbackSchema,
  user_content: userContentSchema,
  decks: deckSchema,
  known_terms: knownTermSchema,
  level_tests: levelTestSchema,
  weekly_reports: weeklyReportSchema,
  texts: readerTextSchema,
  encounters: encounterRowSchema,
} satisfies Record<MutableTable | InsertOnlyRemote, z.ZodType>;

/**
 * Hook for the sync engine's pull. Rows are validated; mutable rows win when their hlc is
 * greater than the local row's (last writer wins), review and practice logs are inserted if
 * new (practice logs touch nothing else: no recompute, no daily_activity). Pulled
 * rows are NOT queued in the outbox. Afterwards cards whose logs or rows changed are
 * recomputed (changes are queued), possible duplicate notes are flagged, and daily_activity
 * is rebuilt when logs arrived.
 */
export async function applyRemoteRows(
  batch: RemoteBatch,
  now: Millis = Date.now(),
): Promise<ApplyRemoteResult> {
  const result: ApplyRemoteResult = { applied: 0, skipped: 0, invalid: 0, recomputedCards: 0 };
  let logsArrived = false;
  await writeTx([...allSyncedTables(), db.report_drafts], now, async (w) => {
    const touchedCards = new Set<Id>();
    const touchedTerms = new Set<string>();
    // New FSRS parameters from another device (v0.3 İP4): every card is replayed with them.
    let paramsChanged = false;
    for (const table of [
      ...MUTABLE,
      'review_logs',
      'practice_logs',
      'level_tests',
      'weekly_reports',
    ] as const) {
      for (const raw of batch[table] ?? []) {
        const parsed = rowSchemas[table].safeParse(raw);
        if (!parsed.success) {
          result.invalid++;
          continue;
        }
        if (table === 'practice_logs') {
          const p = parsed.data as PracticeLog;
          w.observe(p.hlc);
          if (await db.practice_logs.get(p.id)) result.skipped++;
          else {
            await db.practice_logs.add(p);
            result.applied++;
          }
          continue;
        }
        if (table === 'level_tests') {
          // Insert-only study history: never replayed into cards.
          const t = parsed.data as LevelTest;
          w.observe(t.hlc);
          if (await db.level_tests.get(t.id)) result.skipped++;
          else {
            await db.level_tests.add(t);
            result.applied++;
          }
          continue;
        }
        if (table === 'weekly_reports') {
          const r = parsed.data as WeeklyReport;
          w.observe(r.hlc);
          if (await applyRemoteReport(r)) result.applied++;
          else result.skipped++;
          continue;
        }
        const row = parsed.data as MutableRows[MutableTable] | ReviewLog;
        w.observe(row.hlc);
        if (table === 'review_logs') {
          const log = row as ReviewLog;
          if (await db.review_logs.get(log.id)) result.skipped++;
          else {
            await db.review_logs.add(log);
            touchedCards.add(log.card_id);
            logsArrived = true;
            result.applied++;
          }
          continue;
        }
        const local = (await db.table(table).get(row.id)) as MutableRows[MutableTable] | undefined;
        const order = local ? compareHlc(row.hlc, local.hlc) : 1;
        if (local && order === 0) {
          // The same write: take columns an older app version dropped (domain/syncMerge.ts).
          const filled = fillLateColumns(table, row, local);
          if (filled === local) result.skipped++;
          else {
            await db.table(table).put(filled);
            result.applied++;
          }
          continue;
        }
        if (local && order < 0) {
          result.skipped++;
          continue;
        }
        await db.table(table).put(keepProfileFields(table, row, local));
        result.applied++;
        if (
          table === 'settings' &&
          !sameParams((local as Settings | undefined)?.fsrs_params, (row as Settings).fsrs_params)
        ) {
          paramsChanged = true;
        }
        if (table === 'cards') touchedCards.add(row.id);
        if (table === 'notes') touchedTerms.add((row as Note).term_norm);
      }
    }
    result.recomputedCards = await recomputeCardsIn(w, paramsChanged ? 'all' : touchedCards);
    await flagDuplicates(w, touchedTerms);
  });
  if (logsArrived) await rebuildDailyActivity(now);
  return result;
}

/**
 * A pulled weekly report. The server keeps one report per user and week, the first one it
 * got (migration 20261023000900), so the pulled row is the week's report on every device:
 * it replaces a report of the same week this device made (its push was skipped by the server)
 * and the week's draft. Returns false when the row was here already.
 */
async function applyRemoteReport(r: WeeklyReport): Promise<boolean> {
  const sameWeek = await db.weekly_reports.where('week').equals(r.week).toArray();
  await db.report_drafts.delete(r.week);
  if (sameWeek.length === 1 && sameWeek[0]!.id === r.id) return false;
  const others = sameWeek.filter((x) => x.id !== r.id).map((x) => x.id);
  if (others.length) {
    await db.weekly_reports.bulkDelete(others);
    for (const id of others) {
      const queued = await db.outbox
        .where('[table+row_id]')
        .equals(['weekly_reports', id])
        .primaryKeys();
      await db.outbox.bulkDelete(queued);
    }
  }
  await db.weekly_reports.put(r);
  return true;
}

/** Mark live notes sharing a term_norm as possible duplicates (account merge rule). */
async function flagDuplicates(w: SyncWriter, termNorms: Iterable<string>): Promise<number> {
  const norms = [...new Set(termNorms)];
  if (norms.length === 0) return 0;
  const byTerm = new Map<string, Note[]>();
  for (const note of await db.notes.where('term_norm').anyOf(norms).toArray()) {
    if (note.deleted_at !== null) continue;
    const list = byTerm.get(note.term_norm) ?? [];
    list.push(note);
    byTerm.set(note.term_norm, list);
  }
  const flag: Note[] = [];
  for (const live of byTerm.values()) {
    if (live.length < 2) continue;
    for (const note of live)
      if (!note.possible_duplicate) flag.push({ ...note, possible_duplicate: true });
  }
  await w.putMany('notes', flag);
  return flag.length;
}

// ------------------------------------------------------------------ backup

async function readTables(): Promise<BackupTables> {
  return db.transaction('r', allSyncedTables(), async () => ({
    notes: await db.notes.toArray(),
    senses: await db.senses.toArray(),
    cards: await db.cards.toArray(),
    review_logs: await db.review_logs.toArray(),
    sources: await db.sources.toArray(),
    settings: await db.settings.toArray(),
    practice_logs: await db.practice_logs.toArray(),
    content_feedback: await db.content_feedback.toArray(),
    user_content: await db.user_content.toArray(),
    decks: await db.decks.toArray(),
    level_tests: await db.level_tests.toArray(),
    known_terms: await db.known_terms.toArray(),
    weekly_reports: await db.weekly_reports.toArray(),
    texts: await db.texts.toArray(),
    encounters: await db.encounters.toArray(),
  }));
}

/**
 * Build the JSON backup (all synced tables incl. tombstones, settings, schema_version,
 * checksum). The UI serializes it with JSON.stringify, saves the file and only then calls
 * recordBackup: a file that never reached the disk must not count as a backup (ADR 0058).
 */
export async function exportBackup(now: Millis = Date.now()): Promise<BackupFile> {
  return buildBackup(await readTables(), {
    exported_at: now,
    device_id: await getDeviceId(),
  });
}

/** Record a backup that was really saved ("Son yedek: bugün"). */
export async function recordBackup(now: Millis = Date.now()): Promise<void> {
  await updateSettings({ last_backup_at: now }, now);
}

/** Notes as CSV (UTF-8 BOM, ";" separated). Pass translated column headers from tr.json. */
export async function exportCsv(headers?: CsvHeaders, now: Millis = Date.now()): Promise<string> {
  const settings = await getSettings(now);
  const [notes, senses] = await Promise.all([db.notes.toArray(), db.senses.toArray()]);
  return buildNotesCsv(notes, senses, {
    timezone: dayConfig(settings).timezone,
    ...(headers ? { headers } : {}),
  });
}

export type RestoreMode = 'overwrite' | 'merge';

export interface RestoreResult {
  inserted: number;
  replaced: number;
  kept: number;
  deleted: number;
  logsAdded: number;
  recomputedCards: number;
}

function sameRow(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(a, Object.keys(a as object).sort()) ===
    JSON.stringify(b, Object.keys(b as object).sort())
  );
}

/** Rows per transaction while restoring (decision 0025). */
export const RESTORE_CHUNK = 500;

function chunks<T>(rows: readonly T[], size = RESTORE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Restore a backup (a parsed object or the raw JSON string; verified first).
 * - merge: rows missing locally are added as-is; rows present on both sides keep the one
 *   with the greater hlc; notes with the same term are flagged possible_duplicate.
 * - overwrite: the backup's notes/senses/cards/sources/settings replace local ones; local
 *   rows absent from the backup are soft-deleted (so the deletion syncs).
 * Review and practice logs are insert-only in both modes: missing ones are added, none are removed.
 * Afterwards all cards are recomputed and daily_activity is rebuilt; a guest's outbox is
 * compacted (compactGuestOutbox).
 *
 * Writes go in transactions of RESTORE_CHUNK rows with bulkGet/bulkPut (decision 0025:
 * 10,000 cards in seconds instead of ~90 s). Each chunk is atomic with its outbox rows; an
 * interrupted restore is finished by running it again (every step is idempotent: rows
 * already restored compare equal, logs already present are skipped).
 * @throws ActionError('invalid_backup') with the verify error as message.
 */
export function restoreBackup(
  file: unknown,
  mode: RestoreMode,
  now: Millis = Date.now(),
  chunkSize = RESTORE_CHUNK,
): Promise<RestoreResult> {
  // Whole-table views pause meanwhile (data/restoreState.ts).
  return whileRestoring(() => restoreBackupNow(file, mode, now, chunkSize));
}

async function restoreBackupNow(
  file: unknown,
  mode: RestoreMode,
  now: Millis,
  chunkSize: number,
): Promise<RestoreResult> {
  const verified = await verifyBackup(file);
  if (!verified.ok) throw new ActionError('invalid_backup', verified.error);
  const tables = verified.backup.tables;
  const res: RestoreResult = {
    inserted: 0,
    replaced: 0,
    kept: 0,
    deleted: 0,
    logsAdded: 0,
    recomputedCards: 0,
  };

  const terms = new Set<string>();
  for (const table of MUTABLE) {
    // content_feedback / user_content (before schema_version 5), decks (before 7),
    // known_terms (before 8) and texts / encounters (before 11) are absent in older files:
    // such a file says nothing about them, so overwrite leaves the local rows alone.
    const fromFile = tables[table] as MutableRows[MutableTable][] | undefined;
    const incoming = fromFile ?? [];
    for (const chunk of chunks(incoming, chunkSize)) {
      await writeTx([db.table(table)], now, async (w) => {
        const existing = (await db.table(table).bulkGet(chunk.map((r) => r.id))) as (
          MutableRows[MutableTable] | undefined
        )[];
        const asIs: MutableRows[MutableTable][] = [];
        const stamped: MutableRows[MutableTable][] = [];
        for (const [i, row] of chunk.entries()) {
          const local = existing[i];
          if (!local) {
            asIs.push(row);
            res.inserted++;
          } else if (sameRow(local, row)) {
            res.kept++;
          } else if (mode === 'overwrite') {
            stamped.push(row);
            res.replaced++;
          } else if (compareHlc(row.hlc, local.hlc) > 0) {
            asIs.push(row);
            res.replaced++;
          } else {
            res.kept++;
          }
          if (table === 'notes') terms.add((row as Note).term_norm);
        }
        await w.putManyAsIs(table, asIs);
        await w.putMany(table, stamped);
      });
    }
    // settings is a single row: a backup without settings keeps the local ones.
    if (mode === 'overwrite' && fromFile && table !== 'settings') {
      const ids = new Set(incoming.map((r) => r.id));
      const localIds = (await db.table(table).toCollection().primaryKeys()) as Id[];
      for (const chunk of chunks(
        localIds.filter((id) => !ids.has(id)),
        chunkSize,
      )) {
        await writeTx([db.table(table)], now, async (w) => {
          const locals = (await db.table(table).bulkGet(chunk)) as (
            MutableRows[MutableTable] | undefined
          )[];
          const gone = locals
            .filter((l): l is MutableRows[MutableTable] => !!l && l.deleted_at === null)
            .map((l) => ({ ...l, deleted_at: now }) as MutableRows[MutableTable]);
          await w.putMany(table as MutableTable, gone);
          res.deleted += gone.length;
        });
      }
    }
  }

  for (const chunk of chunks(tables.review_logs, chunkSize)) {
    await writeTx([db.review_logs], now, async (w) => {
      const known = await db.review_logs.bulkGet(chunk.map((l) => l.id));
      const fresh = chunk.filter((_, i) => !known[i]);
      for (const log of fresh) w.observe(log.hlc);
      // A guest's logs are queued by adoptGuestData at the first sign-in (all of them), so
      // queuing them now would only fill the outbox (decision 0025).
      await w.insertLogs(fresh, w.userId !== null);
      res.logsAdded += fresh.length;
    });
  }
  for (const chunk of chunks(tables.practice_logs ?? [], chunkSize)) {
    await writeTx([db.practice_logs], now, async (w) => {
      const known = await db.practice_logs.bulkGet(chunk.map((l) => l.id));
      const fresh = chunk.filter((_, i) => !known[i]);
      for (const log of fresh) w.observe(log.hlc);
      await w.insertPracticeLogs(fresh, w.userId !== null);
    });
  }
  for (const chunk of chunks(tables.level_tests ?? [], chunkSize)) {
    await writeTx([db.level_tests], now, async (w) => {
      const known = await db.level_tests.bulkGet(chunk.map((t) => t.id));
      const fresh = chunk.filter((_, i) => !known[i]);
      for (const test of fresh) w.observe(test.hlc);
      await w.insertLevelTests(fresh, w.userId !== null);
    });
  }
  // Weekly reports (schema_version 9): one per week; a week this device has keeps its own.
  // Insert-only like the logs, so a guest's are queued at the first sign-in instead.
  const haveWeeks = new Set((await db.weekly_reports.toArray()).map((r) => r.week));
  for (const chunk of chunks(tables.weekly_reports ?? [], chunkSize)) {
    await writeTx([db.weekly_reports, db.report_drafts], now, async (w) => {
      const fresh: WeeklyReport[] = [];
      for (const report of chunk) {
        if (haveWeeks.has(report.week)) continue;
        haveWeeks.add(report.week);
        w.observe(report.hlc);
        fresh.push(report);
      }
      await w.insertWeeklyReports(fresh, w.userId !== null);
      await db.report_drafts.bulkDelete(fresh.map((r) => r.week));
    });
  }

  await writeTx([db.notes, db.cards, db.review_logs, db.settings], now, async (w) => {
    if (mode === 'merge') await flagDuplicates(w, terms);
    res.recomputedCards = await recomputeCardsIn(w, 'all');
  });
  await rebuildDailyActivity(now);
  await compactGuestOutbox();
  return res;
}

// ------------------------------------------------------------------ integrity

export async function runIntegrityCheck(): Promise<IntegrityReport> {
  return db.transaction('r', [db.notes, db.senses, db.cards, db.review_logs, db.outbox], async () =>
    checkIntegrity({
      notes: await db.notes.toArray(),
      senses: await db.senses.toArray(),
      cards: await db.cards.toArray(),
      logs: await db.review_logs.toArray(),
      outbox: await db.outbox.toArray(),
    }),
  );
}

export interface RepairResult {
  before: IntegrityReport;
  after: IntegrityReport;
  recomputedCards: number;
}

/**
 * "Veri onarımı": soft-delete orphan cards/senses and cards whose sense is gone, recreate
 * missing recognition cards, retry stuck outbox rows, then recompute all cards and rebuild
 * daily_activity. Logs without a card are left alone (logs are never deleted; the card may
 * still arrive by sync).
 */
export async function repairIntegrity(now: Millis = Date.now()): Promise<RepairResult> {
  const before = await runIntegrityCheck();
  let recomputedCards = 0;
  await writeTx([db.notes, db.senses, db.cards, db.review_logs, db.settings], now, async (w) => {
    for (const id of [...before.orphanCards, ...before.cardsWithoutSense]) {
      const c = await db.cards.get(id);
      if (c && c.deleted_at === null) await w.put('cards', { ...c, deleted_at: now });
    }
    for (const id of before.orphanSenses) {
      const s = await db.senses.get(id);
      if (s && s.deleted_at === null) await w.put('senses', { ...s, deleted_at: now });
    }
    for (const noteId of before.notesWithoutRecognition) {
      const old = (await db.cards.where('note_id').equals(noteId).toArray()).find(
        (c) => c.card_type === 'recognition',
      );
      if (old) await w.put('cards', { ...old, deleted_at: null, unlocked: true });
      else
        await w.put('cards', {
          ...w.base(),
          note_id: noteId,
          sense_id: null,
          card_type: 'recognition',
          suspended: false,
          unlocked: true,
          ...emptyFsrs(now),
        });
    }
    for (const seq of before.stuckOutbox)
      await db.outbox.update(seq, { attempts: 0, next_attempt_at: now });
    recomputedCards = await recomputeCardsIn(w, 'all');
  });
  await rebuildDailyActivity(now);
  return { before, after: await runIntegrityCheck(), recomputedCards };
}

// ------------------------------------------------------------------ account

/**
 * Guest → account: remember the user id, stamp it on every guest row of the mutable
 * tables (queued for push) and queue every review log for its first push, then compact
 * the outbox (one entry per row). Logs themselves
 * are not rewritten; the server takes user_id from the session.
 */
export async function adoptGuestData(userId: string, now: Millis = Date.now()): Promise<number> {
  await db.transaction('rw', db.meta, () => setMeta(META.userId, userId));
  const queued = await writeTx(allSyncedTables(), now, async (w) => {
    let n = 0;
    for (const table of MUTABLE) {
      const rows = (await db.table(table).toArray()) as MutableRows[MutableTable][];
      for (const row of rows) {
        if (row.user_id === null) {
          await w.put(table, { ...row, user_id: userId });
          n++;
        }
      }
    }
    for (const log of await db.review_logs.toArray()) {
      w.enqueue('review_logs', log.id, 'upsert', log);
      n++;
    }
    for (const log of await db.practice_logs.toArray()) {
      w.enqueue('practice_logs', log.id, 'upsert', log);
      n++;
    }
    for (const test of await db.level_tests.toArray()) {
      w.enqueue('level_tests', test.id, 'upsert', test);
      n++;
    }
    for (const report of await db.weekly_reports.toArray()) {
      w.enqueue('weekly_reports', report.id, 'upsert', report);
      n++;
    }
    return n;
  });
  // Before the first push: one entry per row (guest edits and the re-queued logs above
  // leave several).
  await compactOutbox();
  return queued;
}
