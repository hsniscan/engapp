// "Sözlükle eşleştir" runner with recorded ai-enrich answers (no live AI calls).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError, type EnrichResponse } from '@/ai/client';
import { db, getAnkiImport, importAnkiPlan, startAnkiEnrich } from '@/data';
import { guessMapping, planAnkiImport } from '@/domain/anki';
import { resetDb } from '@/test/db';
import { ANKI_ENRICH_RESERVE, processAnkiEnrich, type AnkiEnrichDeps } from './enrichQueue';
import { collectionOf, sampleDeck } from './testing/buildApkg';

const NOW = Date.UTC(2026, 9, 22, 12);

/** Recorded shape of ai-enrich answers (docs/ai-pipeline.md). */
function answer(term: string, senses: [string, string][], used: number | null): EnrichResponse {
  return {
    prompt_version: 'enrich-v2',
    ai_called: used !== null,
    model: used !== null ? 'recorded' : null,
    term: senses.length ? { id: `term-${term}`, lemma: term, lemma_norm: term, term_type: 'word' } : null,
    senses: senses.map(([id, meaning]) => ({
      id,
      term_id: `term-${term}`,
      lemma: term,
      lemma_norm: term,
      term_type: 'word' as const,
      pos: 'noun',
      gloss_en: `gloss ${id}`,
      meaning_tr: meaning,
      ipa: null,
      updated_at: NOW,
      cefr: 'B1' as const,
      cefr_source: 'cefrj' as const,
      cefr_list: null,
      cefr_reason_tr: null,
      zipf: 4,
    })),
    new_sense_ids: [],
    suggested_sense_id: null,
    usage: used !== null ? { used, limit: 200 } : null,
  };
}

const RECORDED: Record<string, EnrichResponse> = {
  reluctant: answer('reluctant', [['L-rel', 'isteksiz, gönülsüz']], null),
  'give up': answer('give up', [['L-give', 'pes etmek']], null),
  apple: answer('apple', [['L-apple', 'elma']], 41),
  bank: answer('bank', [['L-bank', 'banka'], ['L-shore', 'kıyı']], null),
  thorough: answer('thorough', [], 42),
};

function deps(enrich: AnkiEnrichDeps['enrich']): AnkiEnrichDeps {
  return { enrich, isOnline: () => true, isSignedIn: async () => true, sleep: async () => {}, now: () => NOW, gapMs: 0 };
}

async function importSample(): Promise<string> {
  const col = collectionOf(sampleDeck());
  const mappings = Object.fromEntries(col.noteTypes.map((nt) => [nt.id, guessMapping(nt)]));
  const { source_id } = await importAnkiPlan(planAnkiImport(col, mappings, NOW), 'english.apkg', {}, NOW);
  await startAnkiEnrich(source_id, NOW);
  return source_id;
}

beforeEach(resetDb);

describe('processAnkiEnrich', () => {
  it('links every word it can and finishes', async () => {
    const id = await importSample();
    const enrich = vi.fn(async (input: { term: string }) => RECORDED[input.term]!);
    expect(await processAnkiEnrich(deps(enrich))).toBe('idle');
    expect(enrich).toHaveBeenCalledTimes(5);
    expect(enrich.mock.calls.every(([input]) => (input as { more?: boolean }).more === false)).toBe(true);
    expect((await getAnkiImport(id))!.enrich).toMatchObject({ status: 'done', matched: 3, term_only: 1, unmatched: 1 });
    const bank = (await db.notes.where('term_norm').equals('bank').first())!;
    const senses = await db.senses.where('note_id').equals(bank.id).sortBy('sense_no');
    expect(senses.map((s) => s.lexicon_sense_id)).toEqual(['L-bank', 'L-shore']);
    expect(bank.lexicon_term_id).toBe('term-bank');
  });

  it('stops at the daily limit and continues the next day where it stopped', async () => {
    const id = await importSample();
    let calls = 0;
    const enrich = vi.fn(async (input: { term: string }) => {
      if (++calls === 3) throw new AiClientError('daily_limit', 'limit', 429);
      return RECORDED[input.term]!;
    });
    expect(await processAnkiEnrich(deps(enrich))).toBe('daily_limit');
    const rec = (await getAnkiImport(id))!;
    expect(rec.enrich).toMatchObject({ status: 'paused', error: 'daily_limit', matched: 1, term_only: 1 });
    expect(rec.enrich.pending).toHaveLength(3);
    // Next local day (day starts at 04:00 Europe/… or UTC on the test machine): later than now.
    expect(rec.enrich.paused_until!).toBeGreaterThan(NOW);
    // Same day: nothing happens.
    expect(await processAnkiEnrich(deps(enrich))).toBe('idle');
    expect(enrich).toHaveBeenCalledTimes(3);
    // The next day it goes on with the remaining words.
    const tomorrow = { ...deps(async (input: { term: string }) => RECORDED[input.term]!), now: () => rec.enrich.paused_until! };
    expect(await processAnkiEnrich(tomorrow)).toBe('idle');
    expect((await getAnkiImport(id))!.enrich).toMatchObject({ status: 'done', pending: [] });
  });

  it('leaves part of the daily AI budget for the user', async () => {
    const id = await importSample();
    const enrich = vi.fn(async (input: { term: string }) =>
      input.term === 'apple' ? { ...RECORDED.apple!, usage: { used: 200 - ANKI_ENRICH_RESERVE, limit: 200 } } : RECORDED[input.term]!,
    );
    expect(await processAnkiEnrich(deps(enrich))).toBe('daily_limit');
    expect(enrich).toHaveBeenCalledTimes(3);
    expect((await getAnkiImport(id))!.enrich.pending).toHaveLength(2);
  });

  it('waits offline or signed out without touching the queue', async () => {
    const id = await importSample();
    const enrich = vi.fn();
    expect(await processAnkiEnrich({ ...deps(enrich), isOnline: () => false })).toBe('offline');
    expect(await processAnkiEnrich({ ...deps(enrich), isSignedIn: async () => false })).toBe('signed_out');
    expect(enrich).not.toHaveBeenCalled();
    expect((await getAnkiImport(id))!.enrich.pending).toHaveLength(5);
  });

  it('pauses after a passing server failure', async () => {
    const id = await importSample();
    const enrich = vi.fn(async () => {
      throw new AiClientError('ai_failed', 'busy', 503);
    });
    expect(await processAnkiEnrich(deps(enrich))).toBe('retry_later');
    expect((await getAnkiImport(id))!.enrich).toMatchObject({ status: 'paused', error: 'ai_failed' });
  });
});
