// Turkish mnemonics on the device (v0.3 İP2, docs/decisions/0020-mnemonics.md): the cached
// shared suggestions (lexicon_pair_notes, read-only, from ai-mnemonic), the user's rejections
// (content_feedback, target_kind 'mnemonic') and the user's pick or own text (user_content,
// kind 'mnemonic', one row per sense of the user). The two user tables sync to the user's
// account only; nothing here writes to a shared table. The AI call lives in src/ai/mnemonic.ts.
import type { MnemonicResponse } from '../../supabase/functions/_shared/mnemonic-contracts';
import { MNEMONIC_NONE_KEY } from '../../supabase/functions/_shared/mnemonic-contracts';
import {
  buildMnemonicView,
  cleanMnemonicText,
  MNEMONIC_KIND,
  MNEMONIC_SUGGESTION_KIND,
  MNEMONIC_TARGET,
  mnemonicRowId,
  mnemonicTextError,
  suggestionOf,
  type MnemonicView,
} from '../domain/mnemonics';
import type { Id, LexiconPairNote, Millis, UserContent } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { setContentFeedback } from './examples';
import { writeTx } from './writer';

// ------------------------------------------------------------------ reading

/** The user's live mnemonic row of a sense (read by index, no hashing: safe in live queries). */
async function ownRow(senseId: Id): Promise<UserContent | null> {
  const rows = await db.user_content
    .where('kind')
    .equals(MNEMONIC_KIND)
    .filter((r) => r.sense_id === senseId && r.deleted_at === null)
    .toArray();
  return rows.sort((a, b) => b.updated_at - a.updated_at)[0] ?? null;
}

async function suggestionRows(lexiconSenseId: Id | null): Promise<LexiconPairNote[]> {
  if (!lexiconSenseId) return [];
  return db.lexicon_pair_notes.where('[sense_id+kind]').equals([lexiconSenseId, MNEMONIC_SUGGESTION_KIND]).toArray();
}

export interface SenseMnemonicView extends MnemonicView {
  senseId: Id;
  /** null: the sense is not linked to the shared lexicon (no suggestions, own text only). */
  lexiconSenseId: Id | null;
}

/** Everything the "Anımsatıcı" section needs for one sense of the user. */
export async function getMnemonicView(senseId: Id): Promise<SenseMnemonicView | null> {
  const sense = await db.senses.get(senseId);
  if (!sense || sense.deleted_at !== null) return null;
  const lexiconSenseId = sense.lexicon_sense_id ?? null;
  const rows = await suggestionRows(lexiconSenseId);
  const feedback = rows.length
    ? await db.content_feedback
        .where('[target_kind+target_id]')
        .anyOf(rows.map((r) => [MNEMONIC_TARGET, r.id]))
        .toArray()
    : [];
  return { ...buildMnemonicView(rows, feedback, await ownRow(senseId)), senseId, lexiconSenseId };
}

/** The chosen mnemonic of a sense for the card (back, or the front hint), or null. */
export async function getCardMnemonic(senseId: Id | null | undefined): Promise<string | null> {
  if (!senseId) return null;
  return (await ownRow(senseId))?.text ?? null;
}

// ------------------------------------------------------------------ the shared cache

/** Local id of the "nothing found" marker (the server's marker row is not sent to clients). */
const noneMarkerId = (lexiconSenseId: Id) => `none:${lexiconSenseId}`;

/**
 * Suggestions returned by ai-mnemonic go into the local cache, so the section works offline
 * and asks the server again only on "Başka öner". `none` is kept as a local marker row.
 */
export async function storeMnemonicSuggestions(res: MnemonicResponse, termNorm: string): Promise<void> {
  const rows: LexiconPairNote[] = res.suggestions.map((s) => ({
    id: s.id,
    term_norm: termNorm,
    sense_id: s.sense_id,
    lang_pair: 'en-tr',
    kind: MNEMONIC_SUGGESTION_KIND,
    content_key: cleanMnemonicText(s.text_tr).toLocaleLowerCase('tr'),
    content: { type: s.type, text_tr: s.text_tr, why: s.why },
    curated: false,
    status: 'active',
    updated_at: s.updated_at,
  }));
  if (res.none && rows.length === 0) {
    rows.push({
      id: noneMarkerId(res.sense_id),
      term_norm: termNorm,
      sense_id: res.sense_id,
      lang_pair: 'en-tr',
      kind: MNEMONIC_SUGGESTION_KIND,
      content_key: MNEMONIC_NONE_KEY,
      content: { type: 'none' },
      curated: false,
      status: 'active',
      updated_at: 0,
    });
  }
  await db.transaction('rw', db.lexicon_pair_notes, async () => {
    if (rows.length) await db.lexicon_pair_notes.bulkPut(rows);
    // Suggestions arrived after the sense had none: the marker no longer applies.
    if (res.suggestions.length) await db.lexicon_pair_notes.delete(noneMarkerId(res.sense_id));
  });
}

// ------------------------------------------------------------------ the user's mnemonic

interface SaveInput {
  text: string;
  /** The suggestion this text comes from (picked, or picked and edited); null for own text. */
  fromId: Id | null;
}

async function saveRow(senseId: Id, input: SaveInput, now: Millis): Promise<UserContent> {
  const sense = await db.senses.get(senseId);
  if (!sense || sense.deleted_at !== null) throw new ActionError('not_found', 'sense');
  const id = await mnemonicRowId(senseId);
  return writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    const row: UserContent = {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      kind: MNEMONIC_KIND,
      lexicon_sense_id: sense.lexicon_sense_id ?? null,
      sense_id: senseId,
      context: null,
      replaces_id: input.fromId,
      text: input.text,
      translations: null,
      span: null,
      selected: true,
      deleted_at: null,
    };
    return w.put('user_content', row);
  });
}

/** "Bunu seç": keep a shared suggestion as this sense's mnemonic. */
export async function chooseMnemonic(senseId: Id, suggestionId: Id, now: Millis = Date.now()): Promise<UserContent> {
  const row = await db.lexicon_pair_notes.get(suggestionId);
  const item = row ? suggestionOf(row) : null;
  if (!item) throw new ActionError('not_found', 'mnemonic suggestion');
  // Choosing a suggestion the user had rejected takes the rejection back.
  await setContentFeedback(MNEMONIC_TARGET, suggestionId, null, now);
  return saveRow(senseId, { text: item.text, fromId: suggestionId }, now);
}

/**
 * "Düzenle" / "Kendin yaz": the user's own text. It stays in user_content (this account only)
 * and never goes to a shared table or to the model.
 * @throws ActionError('invalid_input') for an empty or too long text.
 */
export async function saveOwnMnemonic(
  senseId: Id,
  text: string,
  opts: { fromId?: Id | null } = {},
  now: Millis = Date.now(),
): Promise<UserContent> {
  if (mnemonicTextError(text)) throw new ActionError('invalid_input', 'mnemonic length');
  return saveRow(senseId, { text: cleanMnemonicText(text), fromId: opts.fromId ?? null }, now);
}

/** "Kaldır": the sense has no mnemonic again (tombstone; the suggestions stay). */
export async function removeMnemonic(senseId: Id, now: Millis = Date.now()): Promise<void> {
  const id = await mnemonicRowId(senseId);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    if (existing && existing.deleted_at === null) await w.put('user_content', { ...existing, deleted_at: now });
  });
}

/**
 * "Reddet": hide a suggestion for this user (synced content_feedback). When it was the chosen
 * mnemonic, unchanged, the choice goes too. Returns what to restore on "Geri al".
 */
export async function rejectMnemonic(
  senseId: Id,
  suggestionId: Id,
  now: Millis = Date.now(),
): Promise<{ clearedChoice: boolean }> {
  const own = await ownRow(senseId);
  const row = await db.lexicon_pair_notes.get(suggestionId);
  const item = row ? suggestionOf(row) : null;
  const clearedChoice = !!own && own.replaces_id === suggestionId && !!item && own.text === item.text;
  await setContentFeedback(MNEMONIC_TARGET, suggestionId, 'reject', now);
  if (clearedChoice) await removeMnemonic(senseId, now);
  return { clearedChoice };
}

/** "Geri al" after a rejection. */
export async function undoRejectMnemonic(
  senseId: Id,
  suggestionId: Id,
  opts: { restoreChoice: boolean },
  now: Millis = Date.now(),
): Promise<void> {
  await setContentFeedback(MNEMONIC_TARGET, suggestionId, null, now);
  if (opts.restoreChoice) await chooseMnemonic(senseId, suggestionId, now);
}
