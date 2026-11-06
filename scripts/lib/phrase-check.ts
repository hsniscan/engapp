// A language check of the phrase list (decision 0074, amended 2026-11-06): corpus counts rank
// verb + particle titles and verb + noun pairs well, but the most frequent ones are often a
// verb with a preposition in its plain sense ("go to", "live in", "talk about") or a broken
// pair ("have make" from "have made"). One cheap text call per group of candidates keeps only
// real phrasal verbs and natural collocations a learner studies as a unit. Text AI of the
// system jobs (scripts/lib/system-ai.ts): Claude first, under the system pool of the monthly
// text budget, Gemini behind it.

import type { AiProvider } from '../../supabase/functions/_shared/ai-provider.ts';

export type PhraseKind = 'phrasal verb' | 'collocation';

export interface PhraseCandidate {
  lemma: string;
  kind: PhraseKind;
}

export const PHRASE_CHECK_BATCH = 60;

export const PHRASE_CHECK_SYSTEM = `You check candidate entries for an English vocabulary deck for Turkish learners. Each item is either a "phrasal verb" or a "collocation". Answer keep=true only for entries worth learning as one unit.

phrasal verb: keep a real phrasal or prepositional verb whose meaning is not simply the verb plus the particle, or that learners must learn as a fixed pair (give up, look after, run out of, put up with, turn down, find out, deal with, look forward to, get on with). Reject a verb with a preposition in its plain, literal sense (go to, talk to, live in, come from, look at, be on, have in, do in, find in, need to, use to, talk about, sit on), modal or auxiliary combinations, and anything that is not idiomatic English.

collocation: keep a natural, common verb + noun combination that native speakers use as a fixed pair, especially where Turkish uses a different verb (make a decision, take a photo, pay attention, have fun, keep a secret, catch a cold, do homework). Reject fragments and broken pairs (have make, have play, give it, make it, have a lot), pairs that only exist inside a larger idiom, and pairs with a plain, literal meaning that teaches nothing (see a car, have a car).

Return one answer for every item, by its number.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, keep: { type: 'boolean' } },
        required: ['n', 'keep'],
      },
    },
  },
  required: ['items'],
} as const;

interface Answer {
  items: { n: number; keep: boolean }[];
}

function parseAnswer(data: unknown, size: number): Answer | string {
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return 'no items list';
  const seen = new Set<number>();
  const out: Answer['items'] = [];
  for (const it of items) {
    const n = (it as { n?: unknown })?.n;
    const keep = (it as { keep?: unknown })?.keep;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > size || typeof keep !== 'boolean') continue;
    if (!seen.has(n)) out.push({ n, keep });
    seen.add(n);
  }
  return seen.size === size ? { items: out } : `answered ${seen.size} of ${size} items`;
}

export function phraseCheckUser(batch: readonly PhraseCandidate[]): string {
  return JSON.stringify({ items: batch.map((c, i) => ({ n: i + 1, kind: c.kind, entry: c.lemma })) });
}

/**
 * The candidates the check keeps. A group whose call fails is dropped (logged): a missing
 * entry is better than a wrong one, and the caller oversamples.
 */
export async function checkPhrases(
  provider: AiProvider,
  candidates: readonly PhraseCandidate[],
  opts: { batch?: number; log?: (msg: string, data?: Record<string, unknown>) => void } = {},
): Promise<{ kept: Set<string>; rejected: string[]; failed: number }> {
  const size = opts.batch ?? PHRASE_CHECK_BATCH;
  const kept = new Set<string>();
  const rejected: string[] = [];
  let failed = 0;
  for (let i = 0; i < candidates.length; i += size) {
    const batch = candidates.slice(i, i + size);
    try {
      const res = await provider.generateJson({
        system: PHRASE_CHECK_SYSTEM,
        user: phraseCheckUser(batch),
        schema: SCHEMA as unknown as Record<string, unknown>,
        validate: (d) => {
          const a = parseAnswer(d, batch.length);
          return typeof a === 'string' ? a : null;
        },
        maxOutputTokens: 40 * batch.length + 200,
      });
      const a = parseAnswer(res.data, batch.length);
      if (typeof a === 'string') throw new Error(a);
      for (const { n, keep } of a.items) {
        const c = batch[n - 1]!;
        if (keep) kept.add(c.lemma);
        else rejected.push(c.lemma);
      }
    } catch (e) {
      failed += batch.length;
      opts.log?.('phrase check failed for a group', {
        from: i,
        size: batch.length,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { kept, rejected, failed };
}
