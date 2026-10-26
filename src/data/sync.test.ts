import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { removeRowsMissingOnServer, type ResyncTable } from './sync';

const T = Date.UTC(2026, 9, 21, 9);

beforeEach(resetDb);

const nothingSeen = (): Record<ResyncTable, Set<string>> => ({
  notes: new Set(),
  senses: new Set(),
  cards: new Set(),
  sources: new Set(),
  known_terms: new Set(),
  settings: new Set(),
  content_feedback: new Set(),
  user_content: new Set(),
  decks: new Set(),
  texts: new Set(),
  encounters: new Set(),
});

describe('removeRowsMissingOnServer', () => {
  it('never removes a row written (and queued) while the cleanup was starting', async () => {
    const cleanup = removeRowsMissingOnServer(nothingSeen(), T);
    const added = addNoteWithSenses({ term: 'fresh', senses: [{ meaning_tr: 'taze' }] }, T);
    await Promise.all([cleanup, added]);
    const { note } = await added;
    expect(await db.notes.get(note.id)).toBeDefined();
    expect(await db.cards.where('note_id').equals(note.id).count()).toBeGreaterThan(0);
  });
});
