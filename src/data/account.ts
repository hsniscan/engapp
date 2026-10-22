// Linking this device's local data to a signed-in account (plan, "Hesap"):
//   - first sign-in: stamp user_id on local rows and queue them (adoptGuestData)
//   - the account already has data (second device): merge (default), discard local data,
//     or discard the account's data.
//   - the local data belongs to ANOTHER account: copy its cards without study history
//     (copyCardsFromOtherAccount) or start with the account's data (discardLocalData).
//     Review history is never moved between accounts.
import { LIMITS } from '../domain/limits';
import type { Id, Millis, Note, Sense } from '../domain/types';
import { type AddNoteInput, addNoteWithSenses } from './actions';
import { db } from './db';
import { adoptGuestData, applyRemoteRows, type RemoteBatch } from './maintenance';
import { getMeta, META, setMeta } from './meta';
import { SETTINGS_ID } from './settings';
import { type MutableRows, type MutableTable, writeTx } from './writer';

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
];

/** Data the user created on this device (settings alone do not count). */
export async function hasLocalUserData(): Promise<boolean> {
  const [notes, logs, sources] = await Promise.all([db.notes.count(), db.review_logs.count(), db.sources.count()]);
  return notes + logs + sources > 0;
}

/** user_id the local rows belong to (null: guest data). */
export async function getLinkedUserId(): Promise<string | null> {
  return (await getMeta<string | null>(META.userId)) ?? null;
}

/**
 * Give every local guest row to `userId` and queue it for push (adoptGuestData), review
 * logs included: guest history is the same person's. Cursors restart at 0 so the
 * account's rows are pulled. Rows of ANOTHER account are never claimed: that would copy
 * its review history into this account (use copyCardsFromOtherAccount).
 */
export async function claimLocalData(userId: string, now: Millis = Date.now()): Promise<number> {
  const previous = await getLinkedUserId();
  if (previous === userId) return 0;
  if (previous !== null) throw new Error("Another account's data cannot be claimed");
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.syncCursor, 0);
    await setMeta(META.lexiconCursor, 0);
    await setMeta(META.lexiconExamplesCursor, 0);
  });
  return adoptGuestData(userId, now);
}

/**
 * Merge keeps the account's settings: the local settings row and its queued changes are
 * dropped so the account's row arrives with the pull (ensureSettings recreates defaults if
 * the account has none).
 */
export async function dropLocalSettings(): Promise<void> {
  await db.transaction('rw', db.settings, db.outbox, async () => {
    await db.settings.delete(SETTINGS_ID);
    const queued = await db.outbox.where('[table+row_id]').equals(['settings', SETTINGS_ID]).primaryKeys();
    await db.outbox.bulkDelete(queued);
  });
}

/** "Yerel veriyi at": forget everything on this device and link it to `userId`. */
export async function discardLocalData(userId: string): Promise<void> {
  const keep = new Set(['meta', 'ref_cache']);
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) if (!keep.has(t.name)) await t.clear();
    await setMeta(META.userId, userId);
    await setMeta(META.syncCursor, 0);
    await setMeta(META.lexiconCursor, 0);
    await setMeta(META.lexiconExamplesCursor, 0);
  });
}

export interface RemoteSnapshot {
  rows: { table: string; row: unknown }[];
  /** Cursor after the last page of the snapshot. */
  nextSeq: number;
}

/**
 * "Hesaptakini at": every live row the account has but this device does not gets a
 * tombstone that orders after it (queued for push). Rows on both sides keep the local
 * version, re-stamped so it wins. Review logs cannot be deleted on the server; they stay
 * there without a card. Then local data is claimed for the account; the sync cursor is set
 * past the snapshot so the deleted rows are not pulled back as live rows.
 */
export async function discardAccountData(userId: string, snapshot: RemoteSnapshot, now: Millis = Date.now()): Promise<number> {
  await claimLocalData(userId, now);
  const tables = [
    db.notes,
    db.senses,
    db.cards,
    db.sources,
    db.settings,
    db.content_feedback,
    db.user_content,
    db.decks,
    db.known_terms,
  ];
  const n = await writeTx(tables, now, async (w) => {
    let count = 0;
    for (const { table, row } of snapshot.rows) {
      if (!(MUTABLE as string[]).includes(table)) continue;
      const remote = row as MutableRows[MutableTable];
      w.observe(remote.hlc);
      const local = (await db.table(table).get(remote.id)) as MutableRows[MutableTable] | undefined;
      if (local) {
        await w.put(table as MutableTable, { ...local, user_id: userId });
      } else if (remote.deleted_at === null) {
        await w.put(table as MutableTable, { ...remote, user_id: userId, deleted_at: now });
      }
      count++;
    }
    return count;
  });
  await db.transaction('rw', db.meta, () => setMeta(META.syncCursor, snapshot.nextSeq));
  return n;
}

/** Device-level caches that do not belong to an account and survive a copy. */
// lexicon_examples is the shared sentence cache; the other account's likes, rejections and
// edits (content_feedback, user_content) are personal and are NOT copied (ADR 0009).
const KEEP_ON_COPY = new Set(['meta', 'chunk_cache', 'lexicon_cache', 'lexicon_examples', 'error_log', 'ref_cache']);

/** The user's own content of a live note, as input for the normal add path. */
function copyInput(note: Note, senses: Sense[], sourceIds: Map<Id, Id>): AddNoteInput {
  return {
    term: note.term,
    term_type: note.term_type,
    ipa: note.ipa,
    tags: note.tags,
    lexicon_term_id: note.lexicon_term_id,
    senses: senses
      .filter((s) => s.meaning_tr.trim())
      .sort((a, b) => a.sense_no - b.sense_no)
      .map((s) => ({
        meaning_tr: s.meaning_tr,
        meaning_tr_override: s.meaning_tr_override,
        lexicon_sense_id: s.lexicon_sense_id,
        pos: s.pos,
        gloss_en: s.gloss_en,
        source_sentence: s.source_sentence,
        source_sentence_tr: s.source_sentence_tr,
        span: s.span,
        source_id: s.source_id ? (sourceIds.get(s.source_id) ?? null) : null,
      })),
  };
}

/**
 * "Kartları kopyala": this device holds another account's data and `userId` signed in.
 * In ONE transaction (a crash leaves the device as it was and the dialog asks again):
 *   1. read the other account's live notes, senses and the sources they reference;
 *   2. clear every local table except device caches (chunk/lexicon cache, error log). The
 *      other account's rows, review logs, settings, outbox, import jobs and daily activity
 *      go; they stay on the server under that account;
 *   3. link the device to `userId` and apply the account's `snapshot` (cursor after it);
 *   4. add each note again through addNoteWithSenses: new ids, user_id = `userId`, fresh
 *      HLC, every card New with the normal unlock rule. A term the account already has
 *      gets only the senses it is missing (same path as adding it by hand), so exact
 *      duplicates are skipped instead of flagged.
 * Returns the number of notes copied (created, reactivated or extended).
 */
export async function copyCardsFromOtherAccount(userId: string, snapshot: RemoteSnapshot, now: Millis = Date.now()): Promise<number> {
  return db.transaction('rw', db.tables, async () => {
    const notes = (await db.notes.toArray()).filter((n) => n.deleted_at === null).sort((a, b) => a.created_at - b.created_at);
    const senses = (await db.senses.toArray()).filter((s) => s.deleted_at === null);
    const sources = new Map((await db.sources.toArray()).filter((s) => s.deleted_at === null).map((s) => [s.id, s]));
    const decks = (await db.decks.toArray()).filter((d) => d.deleted_at === null).sort((a, b) => a.sort - b.sort);
    const sensesByNote = new Map<Id, Sense[]>();
    for (const s of senses) {
      const list = sensesByNote.get(s.note_id);
      if (list) list.push(s);
      else sensesByNote.set(s.note_id, [s]);
    }

    for (const t of db.tables) if (!KEEP_ON_COPY.has(t.name)) await t.clear();
    await setMeta(META.userId, userId);
    await setMeta(META.syncCursor, snapshot.nextSeq);
    await setMeta(META.lexiconCursor, 0);
    await setMeta(META.lexiconExamplesCursor, 0);

    const batch: RemoteBatch = {};
    for (const { table, row } of snapshot.rows) (batch[table as keyof RemoteBatch] ??= []).push(row);
    await applyRemoteRows(batch, now);

    // Sources referenced by a copied sense come along under new ids.
    const used = new Set(senses.map((s) => s.source_id).filter((id): id is Id => !!id && sources.has(id)));
    const sourceIds = await writeTx([db.sources], now, async (w) => {
      const map = new Map<Id, Id>();
      for (const id of used) {
        const { kind, title, file_name, page_count, topics } = sources.get(id)!;
        const copy = { ...w.base(), kind, title, file_name, page_count, ...(topics ? { topics } : {}) };
        map.set(id, (await w.put('sources', copy)).id);
      }
      return map;
    });

    let copied = 0;
    for (const note of notes) {
      const input = copyInput(note, sensesByNote.get(note.id) ?? [], sourceIds);
      // The rows passed the same checks before; only the tag union with a note the account
      // already has can overflow. A failing add would abort this whole transaction.
      const existing = (await db.notes.where('term_norm').equals(note.term_norm).toArray()).find((n) => n.deleted_at === null);
      if (existing) {
        const extra = (input.tags ?? []).filter((t) => !existing.tags.includes(t));
        input.tags = extra.slice(0, Math.max(0, LIMITS.tags - existing.tags.length));
      }
      const res = await addNoteWithSenses(input, now);
      if (res.status !== 'existing' || res.addedSenses.length > 0) copied++;
    }

    // Smart decks are saved filters, not history: they come along under new ids unless the
    // account already has a deck with the same name.
    if (decks.length) {
      await writeTx([db.decks], now, async (w) => {
        const have = (await db.decks.toArray()).filter((d) => d.deleted_at === null);
        const names = new Set(have.map((d) => d.name.toLocaleLowerCase('tr')));
        let sort = have.reduce((m, d) => Math.max(m, d.sort), 0);
        for (const d of decks) {
          if (names.has(d.name.toLocaleLowerCase('tr'))) continue;
          names.add(d.name.toLocaleLowerCase('tr'));
          await w.put('decks', { ...w.base(), name: d.name, filter: d.filter, sort: ++sort });
        }
      });
    }
    return copied;
  });
}

/** Notes flagged possible_duplicate (shown in the library after a merge). */
export async function countPossibleDuplicates(): Promise<number> {
  return db.notes.filter((n: Note) => n.possible_duplicate && n.deleted_at === null).count();
}
