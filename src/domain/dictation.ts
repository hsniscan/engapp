// Dictation cards, "Dikte" (v0.5 İP9, docs/decisions/0051-study-modes-dictation.md). Pure: which
// sentences a dictation card may read aloud, and which dictation cards to create, bring back
// or remove. The data layer (data/dictation.ts) gathers the rows and applies the plan.
//
// The rule:
//   - A sense has a dictation card when the sense and its note are live, the note is not
//     recognition-only (root/affix, contrast), and the sense has a usable shared example
//     sentence: an active lexicon example (so its audio is pre-generated, ADR 0042) whose term
//     span is known, that the user did not reject, skip or edit (an edited sentence is the
//     user's own text: it has no pre-generated audio, and private text is not sent to the
//     speech service just for a drill). The user's own source sentence is never dictated for
//     the same reason.
//   - The card is created locked and unlocks like production and cloze: when the word reaches
//     Pekişiyor (ADR 0041, domain/recompute.ts deriveUnlocked). It has its own FSRS state and
//     review logs, and never changes the word's stage or the Aktif badge.
//   - Nothing cached for the sense: unknown, nothing changes (a device that has not fetched the
//     sentences yet must not remove cards another device made). Sentences that later become
//     unusable (all rejected) do not remove the card either: the queue leaves it out while it
//     has no sentence (data/dictation.ts dictationCardsWithoutSentence), and its history stays.
//   - A deleted sense or note removes the card (the delete actions tombstone every card); a
//     note that comes back brings its dictation card back with its history.
import { contentRowId, type CardSentence, type SenseExamples } from './examples';
import { recognitionOnly, type Card, type Id, type NoteTermType, type Sense } from './types';

/**
 * The id of a sense's dictation card is derived from the sense (UUID v8), so two devices that
 * both see the sentences write the same row instead of two cards.
 */
export const dictationCardRowId = (senseId: Id): Promise<Id> => contentRowId(['cards', 'dictation', senseId]);

/**
 * The sentences a dictation card rotates through: the shared example sentences of every
 * context (the selected contexts first, then the others, one per context in turn), without
 * skipped or edited ones and without sentences whose term span is unknown.
 */
export function dictationSentences(examples: SenseExamples | null): CardSentence[] {
  if (!examples) return [];
  const lists = examples.contexts.map((c) =>
    (examples.byContext.get(c) ?? []).filter((i) => i.verdict !== 'skip' && i.editId === null && i.span !== null),
  );
  const out: CardSentence[] = [];
  for (let round = 0; lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      const item = l[round];
      if (item) out.push({ text: item.text, span: item.span, tr: item.tr, exampleId: item.id, context: item.context });
    }
  }
  return out;
}

/** What this device knows about a sense's dictation sentences. */
export type DictationSentenceState = 'ready' | 'none' | 'unknown';

export function dictationStateOf(cachedRows: number, examples: SenseExamples | null): DictationSentenceState {
  if (cachedRows === 0) return 'unknown';
  return dictationSentences(examples).length > 0 ? 'ready' : 'none';
}

export interface DictationPlanInput {
  senses: readonly Pick<Sense, 'id' | 'note_id' | 'lexicon_sense_id' | 'deleted_at'>[];
  /** Term type of each live note (deleted or missing notes are absent). */
  liveNotes: ReadonlyMap<Id, NoteTermType>;
  /** Every dictation card row (live or not) of these senses. */
  cards: readonly Pick<Card, 'id' | 'sense_id' | 'card_type' | 'deleted_at' | 'updated_at'>[];
  /** Sentence state per sense id (the user's sense); a missing entry is 'unknown'. */
  sentences: ReadonlyMap<Id, DictationSentenceState>;
}

export interface DictationPlan {
  /** Senses that get a new dictation card. */
  create: Id[];
  /** Tombstoned dictation cards to bring back (one per sense). */
  revive: Id[];
  /** Live dictation cards to remove (tombstone): their sense or note is gone. */
  remove: Id[];
}

export const emptyDictationPlan = (p: DictationPlan): boolean =>
  !p.create.length && !p.revive.length && !p.remove.length;

/** Whether a live sense may have a dictation card at all (sentences aside). */
export function senseCanDictate(
  sense: Pick<Sense, 'lexicon_sense_id' | 'deleted_at'>,
  termType: NoteTermType | undefined,
): boolean {
  return sense.deleted_at === null && termType !== undefined && !recognitionOnly(termType) && !!sense.lexicon_sense_id;
}

/** The changes that bring the senses' dictation cards in line with the rule above. */
export function planDictationCards(input: DictationPlanInput): DictationPlan {
  const bySense = new Map<Id, DictationPlanInput['cards'][number][]>();
  for (const c of input.cards) {
    if (c.card_type !== 'dictation' || !c.sense_id) continue;
    const list = bySense.get(c.sense_id);
    if (list) list.push(c);
    else bySense.set(c.sense_id, [c]);
  }
  const plan: DictationPlan = { create: [], revive: [], remove: [] };
  for (const sense of input.senses) {
    const cards = bySense.get(sense.id) ?? [];
    const live = cards.filter((c) => c.deleted_at === null);
    if (!senseCanDictate(sense, input.liveNotes.get(sense.note_id))) {
      for (const c of live) plan.remove.push(c.id);
      continue;
    }
    // A second live card of one sense (should not happen with derived ids): keep the first.
    for (const c of live.slice(1)) plan.remove.push(c.id);
    if (live.length > 0) continue;
    const state = input.sentences.get(sense.id) ?? 'unknown';
    if (cards.length > 0) {
      // A card that existed comes back with its note even before the sentences are cached:
      // its history is worth more than the wait.
      const latest = [...cards].sort((a, b) => b.updated_at - a.updated_at)[0]!;
      plan.revive.push(latest.id);
    } else if (state === 'ready') {
      plan.create.push(sense.id);
    }
  }
  return plan;
}
