import { describe, expect, it } from 'vitest';
import type { AiProvider, GenerateJsonRequest } from '../../supabase/functions/_shared/ai-provider.ts';
import { checkPhrases, phraseCheckUser, type PhraseCandidate } from './phrase-check.ts';

const REAL = new Set(['give up', 'look after', 'make a decision', 'take a photo']);

function fakeProvider(opts: { failFirst?: boolean } = {}): AiProvider & { calls: GenerateJsonRequest[] } {
  const calls: GenerateJsonRequest[] = [];
  return {
    name: 'fake',
    calls,
    async generateJson(req) {
      calls.push(req);
      if (opts.failFirst && calls.length === 1) throw new Error('down');
      const { items } = JSON.parse(req.user) as { items: { n: number; entry: string }[] };
      const data = { items: items.map((i) => ({ n: i.n, keep: REAL.has(i.entry) })) };
      expect(req.validate?.(data)).toBeNull();
      return { data, model: 'fake', attempts: 1, usage: null };
    },
  };
}

const candidates: PhraseCandidate[] = [
  { lemma: 'go to', kind: 'phrasal verb' },
  { lemma: 'give up', kind: 'phrasal verb' },
  { lemma: 'live in', kind: 'phrasal verb' },
  { lemma: 'look after', kind: 'phrasal verb' },
  { lemma: 'have make', kind: 'collocation' },
  { lemma: 'make a decision', kind: 'collocation' },
  { lemma: 'take a photo', kind: 'collocation' },
];

describe('phrase check', () => {
  it('keeps the entries the model keeps, in groups', async () => {
    const p = fakeProvider();
    const res = await checkPhrases(p, candidates, { batch: 3 });
    expect([...res.kept].sort()).toEqual([...REAL].sort());
    expect(res.rejected).toEqual(['go to', 'live in', 'have make']);
    expect(res.failed).toBe(0);
    expect(p.calls).toHaveLength(3);
  });

  it('numbers the items and says their kind', () => {
    expect(JSON.parse(phraseCheckUser(candidates.slice(0, 2)))).toEqual({
      items: [
        { n: 1, kind: 'phrasal verb', entry: 'go to' },
        { n: 2, kind: 'phrasal verb', entry: 'give up' },
      ],
    });
  });

  it('rejects an answer that skips an item', () => {
    let reason: string | null = null;
    const p: AiProvider = {
      name: 'x',
      async generateJson(req) {
        reason = req.validate!({ items: [{ n: 1, keep: true }] });
        return { data: { items: [{ n: 1, keep: true }] }, model: 'x', attempts: 1, usage: null };
      },
    };
    return checkPhrases(p, candidates.slice(0, 2)).then((res) => {
      expect(reason).toBe('answered 1 of 2 items');
      expect(res.kept.size).toBe(0);
      expect(res.failed).toBe(2);
    });
  });

  it('drops a group whose call fails and goes on', async () => {
    const res = await checkPhrases(fakeProvider({ failFirst: true }), candidates, { batch: 4 });
    expect(res.failed).toBe(4);
    expect([...res.kept].sort()).toEqual(['make a decision', 'take a photo']);
  });
});
