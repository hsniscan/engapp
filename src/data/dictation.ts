// Dictation cards, "Dikte" (v0.5 İP9, docs/decisions/0051-study-modes-dictation.md), data side.
// The rule lives in domain/dictation.ts; this module gathers the rows (senses, notes, dictation
// cards, the cached shared sentences and the user's verdicts and edits), applies the plan in
// one transaction and answers "can this dictation card be shown now?" for the queue.
// Dictation cards are ordinary synced cards (card_type 'dictation'); their answers are
// ordinary review logs on their own card, so they never touch the word's recognition card.
import {
  dictationCardRowId,
  dictationSentences,
  dictationStateOf,
  emptyDictationPlan,
  planDictationCards,
  type DictationPlan,
  type DictationSentenceState,
} from '../domain/dictation';
import {
  bandFor,
  buildSenseExamples,
  EXAMPLE_SENTENCE_KIND,
  EXAMPLE_TARGET,
  exampleState,
  selectedContexts,
  type SenseExamples,
} from '../domain/examples';
import { emptyFsrs } from '../domain/fsrs';
import { primaryRecognition } from '../domain/leech';
import { deriveUnlocked, recognitionUnlocks } from '../domain/recompute';
import type { Card, Id, LexiconExample, Millis, NoteTermType, Sense, Settings } from '../domain/types';
import { db } from './db';
import { getSettings } from './settings';
import { writeTx } from './writer';

/** Tables a plan reads (a transaction that calls planNow must include them). */
const readTables = () => [db.settings, db.senses, db.notes, db.cards, db.lexicon_examples, db.content_feedback, db.user_content];

/** The sentences of these lexicon senses as the user sees them (verdicts and edits applied). */
async function examplesByLexiconSense(
  lexiconSenseIds: readonly Id[],
  settings: Settings,
): Promise<{ rows: Map<Id, LexiconExample[]>; examples: Map<Id, SenseExamples> }> {
  const rows = new Map<Id, LexiconExample[]>();
  const examples = new Map<Id, SenseExamples>();
  if (lexiconSenseIds.length === 0) return { rows, examples };
  for (const e of await db.lexicon_examples.where('sense_id').anyOf([...lexiconSenseIds]).toArray()) {
    const list = rows.get(e.sense_id);
    if (list) list.push(e);
    else rows.set(e.sense_id, [e]);
  }
  const ids = [...rows.values()].flat().map((e) => e.id);
  const [feedback, content] = ids.length
    ? await Promise.all([
        db.content_feedback
          .where('[target_kind+target_id]')
          .anyOf(ids.map((id) => [EXAMPLE_TARGET, id]))
          .toArray(),
        db.user_content.where('replaces_id').anyOf(ids).toArray(),
      ])
    : [[], []];
  const state = exampleState(
    feedback,
    content.filter((c) => c.kind === EXAMPLE_SENTENCE_KIND),
  );
  const band = bandFor(settings);
  const selected = selectedContexts(settings);
  for (const [id, list] of rows) examples.set(id, buildSenseExamples(list, state, band, selected));
  return { rows, examples };
}

interface PlanNow {
  plan: DictationPlan;
  senses: Map<Id, Sense>;
  cards: Map<Id, Card>;
}

/** Reads only (no hashing): safe inside a transaction over readTables(). */
async function planNow(senseIds: readonly Id[] | undefined): Promise<PlanNow> {
  const settings = await getSettings();
  const dictationCards = await db.cards.where('card_type').equals('dictation').toArray();
  let senses: Sense[];
  if (senseIds) {
    senses = (await db.senses.bulkGet([...senseIds])).filter((s): s is Sense => !!s);
  } else {
    const withCard = new Set(dictationCards.map((c) => c.sense_id).filter((x): x is Id => !!x));
    senses = await db.senses.filter((s) => !!s.lexicon_sense_id || withCard.has(s.id)).toArray();
  }
  const noteIds = [...new Set(senses.map((s) => s.note_id))];
  const notes = (await db.notes.bulkGet(noteIds)).filter((n) => !!n && n.deleted_at === null);
  const liveNotes = new Map<Id, NoteTermType>(notes.map((n) => [n!.id, n!.term_type]));
  const lexIds = [...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x))];
  const { rows, examples } = await examplesByLexiconSense(lexIds, settings);
  const sentences = new Map<Id, DictationSentenceState>();
  for (const s of senses) {
    if (!s.lexicon_sense_id) continue;
    const lex = s.lexicon_sense_id;
    sentences.set(s.id, dictationStateOf(rows.get(lex)?.length ?? 0, examples.get(lex) ?? null));
  }
  const ids = new Set(senses.map((s) => s.id));
  const cards = dictationCards.filter((c) => c.sense_id && ids.has(c.sense_id));
  const plan = planDictationCards({ senses, liveNotes, cards, sentences });
  return { plan, senses: new Map(senses.map((s) => [s.id, s])), cards: new Map(cards.map((c) => [c.id, c])) };
}

let lastSignature: string | null = null;

/**
 * A cheap fingerprint of what the plan depends on (counts, the newest changes and the user's
 * few sentence verdicts and edits; no sentence is read): a run with nothing new can skip it.
 */
export async function dictationCardsSignature(): Promise<string> {
  return db.transaction('r', [db.senses, db.notes, db.cards, db.lexicon_examples, db.content_feedback, db.user_content], async () => {
    const counts = await Promise.all([
      db.senses.count(),
      db.notes.count(),
      db.cards.where('card_type').equals('dictation').count(),
      db.lexicon_examples.count(),
    ]);
    // A note that comes back keeps the row counts: its newest change counts too.
    const note = await db.notes.orderBy('updated_at').last();
    const example = await db.lexicon_examples.orderBy('updated_at').last();
    const feedback = await db.content_feedback
      .where('[target_kind+target_id]')
      .between([EXAMPLE_TARGET, ''], [EXAMPLE_TARGET, '￿'])
      .toArray();
    const edits = await db.user_content.where('kind').equals(EXAMPLE_SENTENCE_KIND).toArray();
    const user = [...feedback, ...edits].map((r) => `${r.id}:${r.updated_at}:${r.deleted_at ?? ''}`).sort();
    return [...counts, note?.updated_at ?? 0, example?.updated_at ?? 0, ...user].join('|');
  });
}

export interface DictationReconcileOptions {
  /** Only these senses (the user's sense ids); default every sense. */
  senseIds?: readonly Id[];
  /** Plan even when the signature did not change (tests, after a sync). */
  force?: boolean;
}

/**
 * Bring dictation cards in line with the rule (domain/dictation.ts): create a card for a sense
 * whose shared sentences arrived, bring back one whose note came back, remove the ones whose
 * sense or note is gone. Review logs are never touched. Returns what it did.
 */
export async function reconcileDictationCards(
  opts: DictationReconcileOptions = {},
  now: Millis = Date.now(),
): Promise<DictationPlan> {
  const whole = !opts.senseIds;
  const signature = whole ? await dictationCardsSignature() : null;
  if (whole && !opts.force && signature === lastSignature) return { create: [], revive: [], remove: [] };
  const first = await db.transaction('r', readTables(), () => planNow(opts.senseIds));
  if (emptyDictationPlan(first.plan)) {
    if (whole) lastSignature = signature;
    return first.plan;
  }
  // The derived ids need hashing, which cannot run inside a Dexie transaction.
  const ids = new Map<Id, Id>();
  for (const senseId of first.plan.create) ids.set(senseId, await dictationCardRowId(senseId));

  const done = await writeTx(readTables(), now, async (w) => {
    const { plan, senses, cards } = await planNow(opts.senseIds);
    const out: DictationPlan = { create: [], revive: [], remove: [] };
    const recognitionState = async (noteId: Id) =>
      primaryRecognition(await db.cards.where('note_id').equals(noteId).toArray()) ?? null;
    for (const senseId of plan.create) {
      const id = ids.get(senseId);
      const sense = senses.get(senseId);
      if (!id || !sense) continue; // planned between the two reads: the next run makes it
      const existing = await db.cards.get(id);
      const state = await recognitionState(sense.note_id);
      if (existing) {
        await w.put('cards', { ...existing, deleted_at: null, unlocked: deriveUnlocked(existing, state) });
      } else {
        await w.put('cards', {
          ...w.base(id),
          note_id: sense.note_id,
          sense_id: sense.id,
          card_type: 'dictation',
          suspended: false,
          unlocked: recognitionUnlocks(state),
          ...emptyFsrs(w.now),
        } satisfies Card);
      }
      out.create.push(senseId);
    }
    for (const cardId of plan.revive) {
      const card = cards.get(cardId)!;
      await w.put('cards', { ...card, deleted_at: null, unlocked: deriveUnlocked(card, await recognitionState(card.note_id)) });
      out.revive.push(cardId);
    }
    for (const cardId of plan.remove) {
      await w.put('cards', { ...cards.get(cardId)!, deleted_at: w.now });
      out.remove.push(cardId);
    }
    return out;
  });
  if (whole) lastSignature = await dictationCardsSignature();
  return done;
}

/** For tests: forget the last signature. */
export function resetDictationSignature(): void {
  lastSignature = null;
}

/**
 * Dictation cards among `cards` that have no sentence to read on this device (sentences not
 * cached, or all rejected, skipped or edited): the session leaves them out instead of showing
 * a card without its question. Reads settings, senses and the example tables; safe inside a
 * transaction over them.
 */
export async function dictationCardsWithoutSentence(
  cards: readonly Pick<Card, 'id' | 'card_type' | 'sense_id'>[],
): Promise<Set<Id>> {
  const out = new Set<Id>();
  const list = cards.filter((c) => c.card_type === 'dictation');
  if (!list.length) return out;
  const settings = await getSettings();
  const senses = await db.senses.bulkGet(list.map((c) => c.sense_id ?? ''));
  const lexIds = [...new Set(senses.map((s) => s?.lexicon_sense_id).filter((x): x is Id => !!x))];
  const { examples } = await examplesByLexiconSense(lexIds, settings);
  list.forEach((c, i) => {
    const lex = senses[i]?.lexicon_sense_id;
    if (!lex || dictationSentences(examples.get(lex) ?? null).length === 0) out.add(c.id);
  });
  return out;
}

/** The sentences a dictation card of this lexicon sense may read (for getCardView). */
export async function dictationSentencesFor(lexiconSenseId: Id, settings: Settings) {
  const { examples } = await examplesByLexiconSense([lexiconSenseId], settings);
  return dictationSentences(examples.get(lexiconSenseId) ?? null);
}

let withoutSentenceMemo: { key: string; ids: Set<Id> } | null = null;

/**
 * dictationCardsWithoutSentence for every studiable dictation card, remembered until a
 * dictation card, a cached sentence, a verdict, an edit or the settings change (the queue is
 * built often: the home screen builds one per study mode).
 */
export async function hiddenDictationCards(): Promise<Set<Id>> {
  const cards = (await db.cards.where('card_type').equals('dictation').toArray()).filter(
    (c) => c.deleted_at === null && !c.suspended && c.unlocked,
  );
  if (cards.length === 0) return new Set();
  const settings = await getSettings();
  const key = [cards.map((c) => c.id).join(','), await dictationCardsSignature(), settings.updated_at].join('|');
  if (withoutSentenceMemo?.key === key) return withoutSentenceMemo.ids;
  const ids = await dictationCardsWithoutSentence(cards);
  withoutSentenceMemo = { key, ids };
  return ids;
}
