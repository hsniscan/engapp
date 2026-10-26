// loadKnowledge / loadReaderKnowledge on the real Dexie schema (decision 0043).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseClientLevels } from '@/domain/level';
import { P_LEARNING } from '@/domain/knowledgeModel';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { addNoteWithSenses, answerCard } from './actions';
import { db } from './db';
import { loadKnowledge, loadReaderKnowledge, resetKnowledgeCache } from './knowledge';
import { markKnown } from './knownTerms';
import { setLevelDataForTests } from './levelData';
import { updateSettings } from './settings';

const T = Date.UTC(2026, 10, 2, 9);

beforeEach(async () => {
  await resetDb();
  resetKnowledgeCache();
  setLevelDataForTests(
    parseClientLevels(
      [
        '# @min_zipf 3',
        'cope\t4.1\tv:B1:j',
        'thrive\t3.9\tv:B2:j',
        'quandary\t2.9\tn:C2:o',
        'walk\t5.1\tv:A1:j',
      ].join('\n'),
    ),
  );
  await updateSettings({ timezone: 'Europe/Istanbul', level: 'B1' }, T);
});
afterEach(() => setLevelDataForTests(null));

describe('loadReaderKnowledge', () => {
  it("uses the user's notes, their stages and Biliyorum words", async () => {
    const cope = await addNoteWithSenses(
      { term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] },
      T,
    );
    const rec = (await db.cards.where('note_id').equals(cope.note.id).toArray()).find(
      (c) => c.card_type === 'recognition',
    )!;
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, T + 1000);
    await addNoteWithSenses({ term: 'give up', senses: [{ meaning_tr: 'vazgeçmek' }] }, T);
    await markKnown('quandary', 'manual', T);
    const k = await loadReaderKnowledge(T + 2000);
    expect(k.lemmatize('coped')).toBe('cope');
    expect(k.pKnown('cope')).toBe(P_LEARNING);
    expect(k.stage('cope')).toBe('learning');
    expect(k.pKnown('quandary')).toBe(1);
    expect(k.noteIdOf('cope')).toBe(cope.note.id);
    expect(k.noteIdOf('walk')).toBeNull();
    expect(k.noteTerms.sort()).toEqual(['cope', 'give up']);
    // A word with no record: the level model's share for its band.
    expect(k.pKnown('thrive')).toBeGreaterThan(0);
    expect(k.pKnown('thrive')).toBeLessThan(1);
  });

  it('the reading offset makes unknown words less likely known', async () => {
    const before = (await loadKnowledge()).pKnown('thrive');
    await updateSettings({ reading_offset: 0.5 }, T + 1);
    const after = (await loadKnowledge()).pKnown('thrive');
    expect(after).toBeLessThan(before);
  });

  it('works without the level file (offline before it was ever fetched)', async () => {
    setLevelDataForTests(null);
    const k = await loadReaderKnowledge(T, async () => {
      throw new Error('offline');
    });
    expect(k.pKnown('the')).toBe(1);
    expect(k.pKnown('thrive')).toBe(0.6);
  });
});
