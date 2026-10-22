// Kelime Bankası on the device (decision 0038). `word_bank` is a read-only copy of the shared
// public.word_bank (system content, the same for every user and guest), pulled page by page
// after meta.word_bank_cursor. Adding a word from the bank goes through addNoteWithSenses like
// the manual form and the imports: the note is the user's own (synced, or local for a guest
// until sign-in), linked to the shared lexicon sense; nothing is ever written back.
import {
  exampleSpan,
  wordBankRowSchema,
  type WordBankRow,
} from '../../supabase/functions/_shared/wordbank-contract';
import type { Millis } from '../domain/types';
import { entryFromRow, type OwnedTerms, type WordBankEntry } from '../domain/wordBank';
import { addNoteWithSenses, type AddNoteInput, type AddNoteResult } from './actions';
import { db } from './db';
import { getKnownTermKeys } from './knownTerms';
import { getMeta, setMeta } from './meta';

export const WORD_BANK_META = {
  /** server_seq of the last pulled row. */
  cursor: 'word_bank_cursor',
  /** When the last full pull finished (ms). */
  syncedAt: 'word_bank_synced_at',
} as const;

export async function getWordBankCursor(): Promise<number> {
  const cursor = (await getMeta<number>(WORD_BANK_META.cursor)) ?? 0;
  // A copy that was cleared (a "Yerel veriyi at" from an older version) starts over.
  if (cursor > 0 && (await db.word_bank.count()) === 0) return 0;
  return cursor;
}

export async function getWordBankSyncedAt(): Promise<number | null> {
  return (await getMeta<number>(WORD_BANK_META.syncedAt)) ?? null;
}

export async function markWordBankSynced(now: Millis = Date.now()): Promise<void> {
  await setMeta(WORD_BANK_META.syncedAt, now);
}

/** Pulled rows that are not valid are skipped (a newer server may send more than we know). */
export function parseWordBankRows(rows: readonly unknown[]): {
  valid: WordBankRow[];
  maxSeq: number;
} {
  const valid: WordBankRow[] = [];
  let maxSeq = 0;
  for (const raw of rows) {
    const seq = Number((raw as { server_seq?: unknown } | null)?.server_seq);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
    const r = wordBankRowSchema.safeParse(raw);
    if (r.success) valid.push(r.data);
  }
  return { valid, maxSeq };
}

/**
 * Stores one pulled page and moves the cursor past it, in one transaction: new and changed
 * rows are written, retired rows removed. Returns what changed.
 */
export async function applyWordBankPage(
  rows: readonly unknown[],
): Promise<{ stored: number; removed: number; cursor: number }> {
  const { valid, maxSeq } = parseWordBankRows(rows);
  const keep = valid.filter((r) => !r.retired).map(entryFromRow);
  const gone = valid.filter((r) => r.retired).map((r) => entryFromRow(r).id);
  return db.transaction('rw', db.word_bank, db.meta, async () => {
    const before = (await getMeta<number>(WORD_BANK_META.cursor)) ?? 0;
    const cursor = Math.max(before, maxSeq);
    if (keep.length) await db.word_bank.bulkPut(keep);
    if (gone.length) await db.word_bank.bulkDelete(gone);
    await setMeta(WORD_BANK_META.cursor, cursor);
    return { stored: keep.length, removed: gone.length, cursor };
  });
}

export async function listWordBank(): Promise<WordBankEntry[]> {
  return db.word_bank.toArray();
}

export async function countWordBank(): Promise<number> {
  return db.word_bank.count();
}

/** Words the user knows without a card and words with a live note, by normalised term. */
export async function getOwnedTerms(): Promise<OwnedTerms> {
  const carded = new Set<string>();
  await db.notes.each((n) => {
    if (n.deleted_at === null) carded.add(n.term_norm);
  });
  return { known: await getKnownTermKeys(), carded };
}

/**
 * The add input for a bank word: its display spelling, the chosen meanings (default: the
 * first, the most common one) with the shared lexicon sense, part of speech and the example
 * sentence with its translation (the example also gives the word a cloze card).
 */
export function bankNoteInput(
  entry: WordBankEntry,
  senseIndexes: readonly number[] = [0],
): AddNoteInput {
  const picked = [...new Set(senseIndexes)]
    .sort((a, b) => a - b)
    .map((i) => entry.senses[i])
    .filter((s) => s !== undefined);
  const senses = picked.length ? picked : entry.senses.slice(0, 1);
  return {
    term: entry.lemma,
    term_type: entry.lemma.includes(' ') ? 'phrase' : 'word',
    lexicon_term_id: entry.lexicon_term_id,
    senses: senses.map((s) => ({
      meaning_tr: s.meaning_tr,
      pos: entry.pos,
      lexicon_sense_id: s.sense_id,
      source_sentence: s.example_en,
      source_sentence_tr: s.example_tr,
      span: exampleSpan(s.example_en, entry.lemma_norm),
    })),
  };
}

export interface BankAddResult {
  /** Words that got a new note or new meanings. */
  added: string[];
  /** Words the user already had with these meanings. */
  unchanged: string[];
  cards: number;
}

/** Adds bank words one by one through the normal add path (each word is one transaction). */
export async function addFromWordBank(
  picks: readonly { entry: WordBankEntry; senses?: readonly number[] }[],
  now: Millis = Date.now(),
): Promise<BankAddResult> {
  const out: BankAddResult = { added: [], unchanged: [], cards: 0 };
  for (const p of picks) {
    const res: AddNoteResult = await addNoteWithSenses(bankNoteInput(p.entry, p.senses), now);
    if (res.addedSenses.length > 0 || res.status !== 'existing') out.added.push(res.note.term);
    else out.unchanged.push(res.note.term);
    out.cards += res.createdCards.length;
  }
  return out;
}
