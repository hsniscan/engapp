// Example sentences on the device (v0.2 İP5, ADR 0013): the shared sentence cache
// (lexicon_examples, read-only, pulled by sync), the user's verdicts (content_feedback) and
// edits (user_content), both synced and private. The sentences are written once in bulk and
// shipped; the on-demand generation and its device queue were removed in v0.5.2 (ADR 0061).
import {
  bandFor,
  buildSenseExamples,
  EXAMPLE_SENTENCE_KIND,
  EXAMPLE_TARGET,
  editSpan,
  exampleEditRowId,
  exampleState,
  feedbackRowId,
  selectedContexts,
  type ExampleState,
  type SenseExamples,
} from '../domain/examples';
import type {
  FeedbackVerdict,
  Id,
  LevelBand,
  LexiconExample,
  Millis,
  UserContent,
} from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { getOrderedContexts } from './profile';
import { getSettings } from './settings';
import { writeTx } from './writer';

/** Longest edited sentence (the shared ones are at most 300 characters, too). */
export const MAX_EDIT_CHARS = 300;

// ------------------------------------------------------------------ reading

/** Feedback and edits about these shared sentences. */
async function stateFor(exampleIds: Id[]): Promise<ExampleState> {
  if (exampleIds.length === 0) return exampleState([], []);
  const [feedback, content] = await Promise.all([
    db.content_feedback
      .where('[target_kind+target_id]')
      .anyOf(exampleIds.map((id) => [EXAMPLE_TARGET, id]))
      .toArray(),
    db.user_content.where('replaces_id').anyOf(exampleIds).toArray(),
  ]);
  return exampleState(feedback, content);
}

/** Cached sentences of these lexicon senses (every band), grouped by sense. */
async function cachedExamples(lexiconSenseIds: Id[]): Promise<Map<Id, LexiconExample[]>> {
  const out = new Map<Id, LexiconExample[]>();
  if (lexiconSenseIds.length === 0) return out;
  for (const e of await db.lexicon_examples.where('sense_id').anyOf(lexiconSenseIds).toArray()) {
    const list = out.get(e.sense_id);
    if (list) list.push(e);
    else out.set(e.sense_id, [e]);
  }
  return out;
}

/** Everything the "Örnek cümleler" section needs for one lexicon sense. */
export interface SenseExamplesView {
  lexiconSenseId: Id;
  band: LevelBand;
  /** Contexts chosen in Settings (or the defaults). */
  selected: string[];
  /** Settings: show the Turkish translation without a tap. */
  trVisible: boolean;
  examples: SenseExamples;
}

export async function getSenseExamples(lexiconSenseId: Id, now: Millis = Date.now()): Promise<SenseExamplesView> {
  const settings = await getSettings(now);
  const band = bandFor(settings);
  const rows = (await cachedExamples([lexiconSenseId])).get(lexiconSenseId) ?? [];
  const state = await stateFor(rows.map((r) => r.id));
  // Tabs: the selected contexts, the user's most interesting first (İP7 profile; with an
  // empty profile the settings order stays).
  const selected = await getOrderedContexts(selectedContexts(settings), now);
  return {
    lexiconSenseId,
    band,
    selected,
    trVisible: settings.example_tr_visible === true,
    examples: buildSenseExamples(rows, state, band, selected),
  };
}

/** Sentences of one lexicon sense for a card (rotation): read inside the caller's transaction. */
export async function senseExamplesFor(
  lexiconSenseId: Id,
  band: LevelBand,
  selected: string[],
): Promise<SenseExamples> {
  const rows = (await cachedExamples([lexiconSenseId])).get(lexiconSenseId) ?? [];
  return buildSenseExamples(rows, await stateFor(rows.map((r) => r.id)), band, selected);
}

/** Tables getCardView must read to build a rotating sentence. */
export const exampleTables = () => [db.lexicon_examples, db.content_feedback, db.user_content];

// ------------------------------------------------------------------ verdicts and edits

/**
 * Like / skip / reject a shared sentence; null takes the verdict back. One row per sentence
 * (deterministic id), synced to the user's account only.
 */
export function setExampleVerdict(
  exampleId: Id,
  verdict: FeedbackVerdict | null,
  now: Millis = Date.now(),
): Promise<void> {
  return setContentFeedback(EXAMPLE_TARGET, exampleId, verdict, now);
}

/**
 * One synced content_feedback row per (target_kind, target_id) of this user; null takes
 * the verdict back (tombstone). Used for example sentences and false-friend warnings.
 */
export async function setContentFeedback(
  targetKind: string,
  targetId: Id,
  verdict: FeedbackVerdict | null,
  now: Millis = Date.now(),
): Promise<void> {
  const id = await feedbackRowId(targetKind, targetId);
  await writeTx([db.content_feedback], now, async (w) => {
    const existing = await db.content_feedback.get(id);
    if (verdict === null) {
      if (existing && existing.deleted_at === null) await w.put('content_feedback', { ...existing, deleted_at: now });
      return;
    }
    if (existing && existing.deleted_at === null && existing.verdict === verdict) return;
    await w.put('content_feedback', {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      target_kind: targetKind,
      target_id: targetId,
      verdict,
      deleted_at: null,
    });
  });
}

/**
 * Save the user's own version of a shared sentence. It stays in user_content (this account
 * only) and is never sent to the server's shared tables or to the model.
 * @throws ActionError('invalid_input') for an empty or too long sentence.
 */
export async function saveExampleEdit(
  exampleId: Id,
  text: string,
  opts: { senseId?: Id | null } = {},
  now: Millis = Date.now(),
): Promise<UserContent> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_EDIT_CHARS) throw new ActionError('invalid_input', 'example sentence length');
  const original = await db.lexicon_examples.get(exampleId);
  if (!original) throw new ActionError('not_found', 'example sentence');
  const id = await exampleEditRowId(exampleId);
  return writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    const unchanged = clean === original.text_en;
    const row: UserContent = {
      ...(existing ?? w.base(id)),
      user_id: existing?.user_id ?? w.userId,
      kind: EXAMPLE_SENTENCE_KIND,
      lexicon_sense_id: original.sense_id,
      sense_id: opts.senseId ?? existing?.sense_id ?? null,
      context: original.context,
      replaces_id: exampleId,
      text: clean,
      // The shared translation no longer fits an edited sentence.
      translations: unchanged ? { ...original.translations } : null,
      span: editSpan({ text: clean, span: null }, original),
      selected: null,
      // Saving the original text again takes the edit back.
      deleted_at: unchanged ? now : null,
    };
    return w.put('user_content', row);
  });
}

/** Back to the shared sentence. */
export async function removeExampleEdit(exampleId: Id, now: Millis = Date.now()): Promise<void> {
  const id = await exampleEditRowId(exampleId);
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(id);
    if (existing && existing.deleted_at === null) await w.put('user_content', { ...existing, deleted_at: now });
  });
}
