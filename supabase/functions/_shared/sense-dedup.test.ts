// @vitest-environment node
// Semantic duplicate guard: a sense that means the same as one the lexicon already has
// (same part of speech, overlapping Turkish meaning) is reused, never inserted again,
// even when its English gloss shares few words with the existing one and even when a
// concurrent request created the existing one a moment ago.
import { describe, expect, it, vi } from 'vitest';
import type { AiProvider, GenerateJsonRequest } from './ai-provider.ts';
import { runEnrich } from './enrich.ts';
import { pickKnownSenses, runExtract, sha256Hex, validateExtractOutput } from './extract.ts';
import type { LexTerm } from './store.ts';
import { MemoryAiStore } from './testing/memory-store.ts';

const SENTENCE = 'Thank you very much for the invitation.';
const LIST = `566 invitation ${SENTENCE}\n567 party We had a party at home.`;

const ATTEND = { gloss: 'a polite request to attend an event', meaning: 'davetiye, davet' };
const GO = { gloss: 'a polite request to go somewhere or do something', meaning: 'davet' };

function invitation(
  sense: { gloss: string; meaning: string } | { ref: string },
  over: Record<string, unknown> = {},
) {
  return {
    term: 'invitation',
    surface: 'invitation',
    term_type: 'word',
    source_sentence: SENTENCE,
    sentence_tr: 'Davetiniz için çok teşekkür ederim.',
    confidence: 0.95,
    ...('ref' in sense
      ? { known_sense: sense.ref, pos: null, gloss_en: null, meaning_tr: null, ipa: null }
      : {
          known_sense: null,
          pos: 'noun',
          gloss_en: sense.gloss,
          meaning_tr: sense.meaning,
          ipa: '/ˌɪnvɪˈteɪʃən/',
        }),
    ...over,
  };
}

function provider(...outputs: unknown[]) {
  const requests: GenerateJsonRequest[] = [];
  let i = 0;
  const p: AiProvider = {
    name: 'fake',
    generateJson: vi.fn(async (req: GenerateJsonRequest) => {
      requests.push(req);
      // Let concurrent requests interleave before either one writes.
      await new Promise((r) => setTimeout(r, 5));
      return {
        data: outputs[Math.min(i++, outputs.length - 1)],
        model: 'fake-model',
        attempts: 1,
        usage: null,
      };
    }),
  };
  return { provider: p, requests };
}

const deps = (store: MemoryAiStore, p: AiProvider) => ({
  userId: 'user-1',
  store,
  provider: () => p,
  dailyLimit: 200,
});

async function body(text: string) {
  return { text, chunk_hash: await sha256Hex(text), level: 'B1' };
}

const invitationSenses = (store: MemoryAiStore) => [...store.senses.values()];

describe('ai-extract: no second sense with the same meaning', () => {
  it('a re-import whose model ignores KNOWN_SENSES reuses the existing sense', async () => {
    const store = new MemoryAiStore();
    const existing = store.seed(
      'invitation',
      'noun',
      ATTEND.gloss,
      'attend event polite request',
      ATTEND.meaning,
    );
    const { provider: p, requests } = provider({ candidates: [invitation(GO)] });
    const res = await runExtract(await body(LIST), deps(store, p));
    expect(requests[0]!.user).toContain(`| invitation | noun | ${ATTEND.gloss}`);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({ match: 'known_sense', lexicon_hit: true });
    expect(res.candidates[0]!.lexicon).toMatchObject({
      id: existing.sense_id,
      meaning_tr: 'davetiye, davet',
    });
    expect(invitationSenses(store)).toHaveLength(1);
  });

  it('concurrent requests (chunks in flight together) create one sense, not two', async () => {
    const store = new MemoryAiStore();
    const a = provider({ candidates: [invitation(ATTEND)] });
    const b = provider({
      candidates: [invitation(GO, { source_sentence: 'Did you get the invitation?' })],
    });
    const [ra, rb] = await Promise.all([
      runExtract(await body(LIST), deps(store, a.provider)),
      runExtract(await body('12 invite Did you get the invitation?'), deps(store, b.provider)),
    ]);
    // Neither request saw the other's sense before calling the model.
    expect(a.requests[0]!.user).not.toContain('invitation |');
    expect(b.requests[0]!.user).not.toContain('invitation |');
    expect(invitationSenses(store)).toHaveLength(1);
    expect(rb.candidates[0]!.lexicon.id).toBe(ra.candidates[0]!.lexicon.id);
    expect(rb.candidates[0]!.match).toBe('known_sense');
  });

  it('keeps really different senses of the same word', async () => {
    const store = new MemoryAiStore();
    store.seed('bank', 'noun', 'the land beside a river', 'beside land river', 'kıyı');
    const text = 'She went to the bank to take out a loan.';
    const { provider: p } = provider({
      candidates: [
        {
          term: 'bank',
          surface: 'bank',
          term_type: 'word',
          source_sentence: text,
          sentence_tr: 'Kredi çekmek için bankaya gitti.',
          confidence: 0.9,
          known_sense: null,
          pos: 'noun',
          gloss_en: 'an organization that keeps and lends money',
          meaning_tr: 'banka',
          ipa: null,
        },
      ],
    });
    const res = await runExtract(await body(text), deps(store, p));
    expect(res.candidates[0]!.match).toBe('new_sense');
    expect(store.senses.size).toBe(2);
  });

  it('one candidate per term and sentence: a known ref beats a reworded new sense', () => {
    const known = new Map([['s1', { senseId: 'sense-attend', lemmaNorm: 'invitation' }]]);
    const v = validateExtractOutput(
      {
        candidates: [
          invitation(GO, { confidence: 0.99 }),
          invitation({ ref: 's1' }, { confidence: 0.6 }),
        ],
      },
      LIST,
      known,
    );
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0]!.known?.senseId).toBe('sense-attend');
    expect(v.dropped).toEqual({ duplicate: 1 });

    const twoNew = validateExtractOutput(
      {
        candidates: [invitation(GO, { confidence: 0.7 }), invitation(ATTEND, { confidence: 0.9 })],
      },
      LIST,
      new Map(),
    );
    expect(twoNew.candidates.map((c) => c.newSense?.meaning_tr)).toEqual(['davetiye, davet']);
  });

  it('offers every term a known sense before any term a second one', () => {
    const term = (lemma: string, n: number): LexTerm => ({
      term_id: `t-${lemma}`,
      lemma,
      lemma_norm: lemma,
      term_type: 'word',
      senses: Array.from({ length: n }, (_, i) => ({
        id: `${lemma}-${i}`,
        pos: 'noun',
        gloss_en: `g${i}`,
        gloss_key: `g${i}`,
        meaning_tr: `m${i}`,
        ipa: null,
        updated_at: 0,
      })),
    });
    const picked = pickKnownSenses([term('apple', 12), term('bank', 3), term('invitation', 1)], 5);
    expect(picked.map((x) => x.s.id)).toEqual([
      'apple-0',
      'apple-1',
      'bank-0',
      'bank-1',
      'invitation-0',
    ]);
  });
});

describe('ai-enrich: "Başka anlam ara" does not add a sense the term has', () => {
  it('a reworded sense with an overlapping Turkish meaning is not stored', async () => {
    const store = new MemoryAiStore();
    store.seed('invitation', 'noun', ATTEND.gloss, 'attend event polite request', ATTEND.meaning);
    const { provider: p } = provider({
      valid: true,
      lemma: 'invitation',
      term_type: 'word',
      senses: [
        {
          pos: 'noun',
          gloss_en: GO.gloss,
          meaning_tr: GO.meaning,
          ipa: null,
          used_in_sentence: false,
        },
        {
          pos: 'noun',
          gloss_en: 'a card or letter that invites someone',
          meaning_tr: 'davetiye',
          ipa: null,
          used_in_sentence: false,
        },
        {
          pos: 'noun',
          gloss_en: 'something that encourages a bad action',
          meaning_tr: 'teşvik',
          ipa: null,
          used_in_sentence: false,
        },
      ],
      sentence_known_sense: null,
    });
    const res = await runEnrich({ term: 'invitation', more: true }, deps(store, p));
    expect(res.senses.map((s) => s.meaning_tr)).toEqual(['davetiye, davet', 'teşvik']);
    expect(res.new_sense_ids).toHaveLength(1);
    expect(store.senses.size).toBe(2);
  });
});
