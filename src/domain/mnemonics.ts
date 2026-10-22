// Turkish mnemonics ("Anımsatıcı", v0.3 İP2, docs/decisions/0020-mnemonics.md). Pure: the
// shared suggestions of a lexicon sense (lexicon_pair_notes rows, kind 'mnemonic_suggestion'),
// the user's rejections (content_feedback, target_kind 'mnemonic') and the user's own pick or
// text (one user_content row per sense, kind 'mnemonic') make up what the screen shows.
import {
  MAX_USER_MNEMONIC_CHARS,
  MAX_MNEMONICS_PER_SENSE,
  MNEMONIC_NONE_KEY,
  MNEMONIC_TYPES,
  type MnemonicType,
} from '../../supabase/functions/_shared/mnemonic-contracts';
import { contentRowId } from './examples';
import type { ContentFeedback, Id, LexiconPairNote, UserContent } from './types';

export { MAX_USER_MNEMONIC_CHARS, MNEMONIC_TYPES };
export type { MnemonicType };

/** user_content.kind of the user's mnemonic. */
export const MNEMONIC_KIND = 'mnemonic';
/** content_feedback.target_kind of a rejected suggestion (target_id = lexicon_pair_notes.id). */
export const MNEMONIC_TARGET = 'mnemonic';
/** lexicon_pair_notes.kind of a shared suggestion. */
export const MNEMONIC_SUGGESTION_KIND = 'mnemonic_suggestion';

/** One user_content row per sense of the user (deterministic: two devices write the same row). */
export const mnemonicRowId = (senseId: Id): Promise<Id> => contentRowId(['user_content', MNEMONIC_KIND, senseId]);

export interface MnemonicItem {
  /** lexicon_pair_notes.id */
  id: Id;
  type: MnemonicType;
  text: string;
  why: string | null;
}

/** A shared suggestion row as an item; null for the "nothing found" marker and malformed rows. */
export function suggestionOf(row: LexiconPairNote): MnemonicItem | null {
  if (row.kind !== MNEMONIC_SUGGESTION_KIND || row.status !== 'active' || row.content_key === MNEMONIC_NONE_KEY)
    return null;
  const c = row.content;
  const type = typeof c.type === 'string' ? c.type : '';
  const text = typeof c.text_tr === 'string' ? c.text_tr.trim() : '';
  if (!(MNEMONIC_TYPES as readonly string[]).includes(type) || !text) return null;
  return { id: row.id, type: type as MnemonicType, text, why: typeof c.why === 'string' && c.why.trim() ? c.why.trim() : null };
}

/** The user's text as saved: one line, trimmed. */
export const cleanMnemonicText = (text: string): string => text.replace(/\s+/g, ' ').trim();

export type MnemonicTextError = 'empty' | 'too_long';

export function mnemonicTextError(text: string): MnemonicTextError | null {
  const clean = cleanMnemonicText(text);
  if (!clean) return 'empty';
  if (clean.length > MAX_USER_MNEMONIC_CHARS) return 'too_long';
  return null;
}

/** The mnemonic the user keeps for a sense. */
export interface ChosenMnemonic {
  /** user_content.id */
  rowId: Id;
  text: string;
  /** The suggestion it came from (null: written by the user). */
  fromId: Id | null;
  /** Picked from a suggestion and then changed. */
  edited: boolean;
}

export interface MnemonicView {
  /** Suggestions to show (rejected ones left out), oldest first. */
  suggestions: MnemonicItem[];
  /** How many suggestions this user rejected (hidden). */
  rejected: number;
  chosen: ChosenMnemonic | null;
  /** Suggestions were asked for this sense before (on any device of any user). */
  asked: boolean;
  /** Asked, and the model found no good association: there is no suggestion at all. */
  none: boolean;
  /** The sense has as many suggestions as it can keep: "Başka öner" asks the model no more. */
  exhausted: boolean;
}

export function chosenOf(row: UserContent | null | undefined, suggestions: readonly MnemonicItem[]): ChosenMnemonic | null {
  if (!row || row.deleted_at !== null || row.kind !== MNEMONIC_KIND || !row.text.trim()) return null;
  const from = row.replaces_id ? (suggestions.find((s) => s.id === row.replaces_id) ?? null) : null;
  return {
    rowId: row.id,
    text: row.text,
    fromId: row.replaces_id,
    edited: row.replaces_id !== null && (!from || from.text !== row.text),
  };
}

/**
 * What the "Anımsatıcı" section shows for one sense: the shared rows of its lexicon sense, the
 * user's live rejections and the user's own row.
 */
export function buildMnemonicView(
  rows: readonly LexiconPairNote[],
  feedback: readonly ContentFeedback[],
  own: UserContent | null | undefined,
): MnemonicView {
  const all = rows
    .filter((r) => r.kind === MNEMONIC_SUGGESTION_KIND && r.status === 'active')
    .sort((a, b) => a.updated_at - b.updated_at || (a.id < b.id ? -1 : 1));
  const items = all.map(suggestionOf).filter((s): s is MnemonicItem => s !== null);
  const rejected = new Set(
    feedback
      .filter((f) => f.target_kind === MNEMONIC_TARGET && f.deleted_at === null && f.verdict === 'reject')
      .map((f) => f.target_id),
  );
  const chosen = chosenOf(own, items);
  // The chosen suggestion stays visible even when rejected later on another device.
  const visible = items.filter((s) => !rejected.has(s.id) || s.id === chosen?.fromId);
  return {
    suggestions: visible,
    rejected: items.length - visible.length,
    chosen,
    asked: all.length > 0,
    none: all.length > 0 && items.length === 0,
    exhausted: items.length >= MAX_MNEMONICS_PER_SENSE,
  };
}
