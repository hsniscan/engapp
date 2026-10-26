// Example sentences (v0.2 İP5, ADR 0013): which sentences a sense shows, in which order,
// and which one a card uses this time. Pure functions over the local rows; the data layer
// (src/data/examples.ts) reads the rows and the UI renders the result.
import {
  DEFAULT_EXAMPLE_CONTEXTS,
  EXAMPLE_CONTEXT_KEYS,
  isExampleContext,
  LEVEL_BANDS,
  levelBand,
  MAX_EXAMPLE_CONTEXTS,
  MIN_SELECTED_CONTEXTS,
} from '../../supabase/functions/_shared/examples-contracts';
import { sha256Hex } from './chunking';
import { findSpan, isValidSpan, type Span } from './recognition';
import type {
  ContentFeedback,
  FeedbackVerdict,
  Id,
  LevelBand,
  LexiconExample,
  Sense,
  Settings,
  UserContent,
} from './types';

export { DEFAULT_EXAMPLE_CONTEXTS, EXAMPLE_CONTEXT_KEYS, isExampleContext, levelBand };

/** target_kind of feedback on a shared example sentence. */
export const EXAMPLE_TARGET = 'example';
/** user_content.kind of an edited example sentence. */
export const EXAMPLE_SENTENCE_KIND = 'example_sentence';

/** The level band sentences are written for (settings.level → A2/B1/B2/C1). */
export function bandFor(settings: Pick<Settings, 'level'>): LevelBand {
  return levelBand(settings.level);
}

/**
 * Contexts prepared in the background: the user's choice (2–4 known contexts) or the
 * default list. Unknown keys (from a newer client) are ignored.
 */
export function selectedContexts(settings: Pick<Settings, 'example_contexts'>): string[] {
  const chosen = [...new Set((settings.example_contexts ?? []).filter(isExampleContext))].slice(
    0,
    MAX_EXAMPLE_CONTEXTS,
  );
  return chosen.length >= MIN_SELECTED_CONTEXTS ? chosen : [...DEFAULT_EXAMPLE_CONTEXTS];
}

/** Catalogue order, unknown keys last (alphabetically). */
export function contextOrder(a: string, b: string): number {
  const ia = (EXAMPLE_CONTEXT_KEYS as readonly string[]).indexOf(a);
  const ib = (EXAMPLE_CONTEXT_KEYS as readonly string[]).indexOf(b);
  if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || a.localeCompare(b);
  return a.localeCompare(b);
}

/**
 * Deterministic id of a content row, as a UUID (version 8, RFC 9562): SHA-256 of the parts.
 * One feedback row per target and one edit per sentence, so two devices write the same row
 * and last-writer-wins settles it. Async: compute it BEFORE opening a Dexie transaction.
 */
export async function contentRowId(parts: readonly string[]): Promise<Id> {
  const h = await sha256Hex(parts.join('\u0000'));
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const feedbackRowId = (targetKind: string, targetId: Id): Promise<Id> =>
  contentRowId(['content_feedback', targetKind, targetId]);

export const exampleEditRowId = (exampleId: Id): Promise<Id> =>
  contentRowId(['user_content', EXAMPLE_SENTENCE_KIND, exampleId]);

/** One sentence as the UI shows it. */
export interface ExampleItem {
  /** lexicon_examples.id (feedback and edits point at it). */
  id: Id;
  context: string;
  band: LevelBand;
  /** The user's edit when there is one, else the shared sentence. */
  text: string;
  /** Where the term is in `text`; null when an edit no longer contains it recognisably. */
  span: Span | null;
  /** Turkish translation (of the shared sentence; an edit keeps it only if unchanged). */
  tr: string | null;
  verdict: FeedbackVerdict | null;
  /** user_content.id of the user's edit, or null. */
  editId: Id | null;
  /** The shared sentence (shown as "original" next to an edit). */
  original: string;
}

export interface ExampleState {
  feedback: ReadonlyMap<Id, FeedbackVerdict>;
  edits: ReadonlyMap<Id, UserContent>;
}

/** Live feedback and edits, keyed by the shared sentence they are about. */
export function exampleState(
  feedback: Iterable<ContentFeedback>,
  content: Iterable<UserContent>,
): ExampleState {
  const fb = new Map<Id, FeedbackVerdict>();
  for (const f of feedback) {
    if (f.deleted_at === null && f.target_kind === EXAMPLE_TARGET) fb.set(f.target_id, f.verdict);
  }
  const edits = new Map<Id, UserContent>();
  for (const c of content) {
    if (c.deleted_at === null && c.kind === EXAMPLE_SENTENCE_KIND && c.replaces_id) edits.set(c.replaces_id, c);
  }
  return { feedback: fb, edits };
}

const VERDICT_RANK: Record<string, number> = { like: 0, none: 1, skip: 2 };

/** Span of the term in an edited sentence: the stored one, or a search for the old surface. */
export function editSpan(edit: Pick<UserContent, 'text' | 'span'>, original: LexiconExample): Span | null {
  if (edit.span && isValidSpan(edit.text, edit.span)) return edit.span;
  const surface = original.text_en.slice(original.span[0], original.span[1]);
  return findSpan(edit.text, surface);
}

function toItem(e: LexiconExample, state: ExampleState): ExampleItem {
  const edit = state.edits.get(e.id) ?? null;
  const text = edit ? edit.text : e.text_en;
  const tr = edit ? (edit.translations?.tr ?? null) : (e.translations.tr ?? null);
  return {
    id: e.id,
    context: e.context,
    band: e.level_band,
    text,
    span: edit ? editSpan(edit, e) : isValidSpan(e.text_en, e.span) ? e.span : null,
    tr,
    verdict: state.feedback.get(e.id) ?? null,
    editId: edit?.id ?? null,
    original: e.text_en,
  };
}

const bandDistance = (a: LevelBand, b: LevelBand) => Math.abs(LEVEL_BANDS.indexOf(a) - LEVEL_BANDS.indexOf(b));

export interface SenseExamples {
  /** Tabs: the selected contexts first (in the user's order), then other contexts that have sentences. */
  contexts: string[];
  /** Visible sentences per context: liked first, skipped last; rejected never. */
  byContext: Map<string, ExampleItem[]>;
}

/**
 * The sentences of one lexicon sense as the user sees them. Per context, the band closest
 * to the user's is used (ties: the easier band). Rejected sentences are left out.
 */
export function buildSenseExamples(
  examples: readonly LexiconExample[],
  state: ExampleState,
  band: LevelBand,
  selected: readonly string[],
): SenseExamples {
  const visible = examples.filter((e) => e.status === 'active' && state.feedback.get(e.id) !== 'reject');
  const groups = new Map<string, LexiconExample[]>();
  for (const e of visible) {
    const list = groups.get(e.context);
    if (list) list.push(e);
    else groups.set(e.context, [e]);
  }
  const byContext = new Map<string, ExampleItem[]>();
  for (const [context, list] of groups) {
    const best = [...new Set(list.map((e) => e.level_band))].sort(
      (a, b) => bandDistance(a, band) - bandDistance(b, band) || LEVEL_BANDS.indexOf(a) - LEVEL_BANDS.indexOf(b),
    )[0]!;
    const items = list
      .filter((e) => e.level_band === best)
      .sort((a, b) => a.updated_at - b.updated_at || (a.id < b.id ? -1 : 1))
      .map((e) => toItem(e, state))
      .sort((a, b) => VERDICT_RANK[a.verdict ?? 'none']! - VERDICT_RANK[b.verdict ?? 'none']!);
    byContext.set(context, items);
  }
  const others = [...byContext.keys()].filter((c) => !selected.includes(c)).sort(contextOrder);
  return { contexts: [...selected, ...others], byContext };
}

/** A sentence a card can show on its front (and repeat on its back). */
export interface CardSentence {
  text: string;
  span: Span | null;
  /** Translation shown on the back: the user's own one for the source sentence. */
  tr: string | null;
  /** null = the sense's own (source) sentence. */
  exampleId: Id | null;
  context: string | null;
  /** Show the translation only on tap (example sentences, unless settings say otherwise). */
  trOnTap?: boolean;
  /** v0.5 İP10: 'text' = a sentence from one of the user's own reading texts (device only). */
  origin?: 'text';
}

/**
 * The sentences a card rotates through: the source sentence first, then sentences from the
 * user's own texts (v0.5 İP10, `own`), then the example sentences of the selected contexts
 * taken in turn (one per context, then the next one…), without skipped ones. `needSpan`
 * (cloze) keeps only sentences where the term is located.
 */
export function rotationSentences(
  sense: Pick<Sense, 'source_sentence' | 'source_sentence_tr' | 'span'>,
  examples: SenseExamples | null,
  selected: readonly string[],
  needSpan: boolean,
  own: readonly { text: string; span: Span; tr: string | null }[] = [],
): CardSentence[] {
  const out: CardSentence[] = [];
  if (sense.source_sentence && (!needSpan || isValidSpan(sense.source_sentence, sense.span))) {
    out.push({
      text: sense.source_sentence,
      span: sense.span,
      tr: sense.source_sentence_tr,
      exampleId: null,
      context: null,
    });
  }
  const sourceText = sense.source_sentence?.trim().toLowerCase() ?? null;
  for (const t of own) {
    if (t.text.trim().toLowerCase() === sourceText) continue;
    out.push({ text: t.text, span: t.span, tr: t.tr, exampleId: null, context: null, origin: 'text' });
  }
  if (!examples) return out;
  const lists = selected.map((c) =>
    (examples.byContext.get(c) ?? []).filter((i) => i.verdict !== 'skip' && (!needSpan || i.span !== null)),
  );
  for (let round = 0; lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      const item = l[round];
      if (item) out.push({ text: item.text, span: item.span, tr: item.tr, exampleId: item.id, context: item.context });
    }
  }
  return out;
}

/** The sentence for this showing: a new one after every answer (reps), stable while shown. */
export function pickRotation<T>(list: readonly T[], reps: number): T | null {
  if (list.length === 0) return null;
  return list[((reps % list.length) + list.length) % list.length]!;
}

/** Contexts of `wanted` that have no visible sentence yet (what the queue should prepare). */
export function missingContexts(examples: SenseExamples | null, wanted: readonly string[]): string[] {
  return wanted.filter((c) => !(examples?.byContext.get(c)?.length));
}
