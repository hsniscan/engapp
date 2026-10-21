// Startup integrity check. Pure: the data layer loads rows, this finds the problems,
// and data/actions.ts repairs what can be repaired.
import type { Card, Id, Note, OutboxRow, ReviewLog, Sense } from './types';

export const STUCK_OUTBOX_ATTEMPTS = 10;

export interface IntegrityInput {
  notes: Pick<Note, 'id' | 'deleted_at'>[];
  senses: Pick<Sense, 'id' | 'note_id' | 'deleted_at'>[];
  cards: Pick<Card, 'id' | 'note_id' | 'sense_id' | 'card_type' | 'deleted_at'>[];
  logs: Pick<ReviewLog, 'id' | 'card_id'>[];
  outbox: Pick<OutboxRow, 'seq' | 'attempts'>[];
}

export interface IntegrityReport {
  /** Live cards whose note is missing or deleted. */
  orphanCards: Id[];
  /** Live senses whose note is missing or deleted. */
  orphanSenses: Id[];
  /** Live production/cloze cards whose sense is missing or deleted. */
  cardsWithoutSense: Id[];
  /** Live notes with no live recognition card. */
  notesWithoutRecognition: Id[];
  /** Logs pointing to a card that does not exist locally (may still arrive by sync). */
  logsWithoutCard: Id[];
  /** Outbox rows that failed STUCK_OUTBOX_ATTEMPTS times or more. */
  stuckOutbox: number[];
  ok: boolean;
}

export function checkIntegrity(input: IntegrityInput): IntegrityReport {
  const liveNotes = new Set(input.notes.filter((n) => n.deleted_at === null).map((n) => n.id));
  const liveSenses = new Set(input.senses.filter((s) => s.deleted_at === null).map((s) => s.id));
  const allCards = new Set(input.cards.map((c) => c.id));
  const withRecognition = new Set<Id>();

  const orphanCards: Id[] = [];
  const cardsWithoutSense: Id[] = [];
  for (const c of input.cards) {
    if (c.deleted_at !== null) continue;
    if (!liveNotes.has(c.note_id)) {
      orphanCards.push(c.id);
      continue;
    }
    if (c.card_type === 'recognition') withRecognition.add(c.note_id);
    else if (c.sense_id === null || !liveSenses.has(c.sense_id)) cardsWithoutSense.push(c.id);
  }
  const orphanSenses = input.senses.filter((s) => s.deleted_at === null && !liveNotes.has(s.note_id)).map((s) => s.id);
  const notesWithoutRecognition = [...liveNotes].filter((id) => !withRecognition.has(id));
  const logsWithoutCard = input.logs.filter((l) => !allCards.has(l.card_id)).map((l) => l.id);
  const stuckOutbox = input.outbox
    .filter((o) => o.attempts >= STUCK_OUTBOX_ATTEMPTS && o.seq !== undefined)
    .map((o) => o.seq!);

  const report = {
    orphanCards,
    orphanSenses,
    cardsWithoutSense,
    notesWithoutRecognition,
    logsWithoutCard,
    stuckOutbox,
  };
  return { ...report, ok: Object.values(report).every((v) => v.length === 0) };
}
