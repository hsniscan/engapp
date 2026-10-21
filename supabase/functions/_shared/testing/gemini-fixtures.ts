// Recorded/representative Gemini generateContent responses (v1beta REST envelope as
// observed in Oct 2026). Used by unit tests; no test ever calls the real API.

export const CHUNK =
  'After years of trying, Maria finally gave up smoking. On Sunday she sat on the bank of the river and watched the boats drift by.\n' +
  'On Monday she went to the bank to take out a loan. The manager turned her application down because her income was too low.';

export function envelope(payload: unknown, extra: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: 'internal reasoning that must be ignored', thought: true },
            { text: JSON.stringify(payload), thoughtSignature: 'EmAKXgFpFH0T' },
          ],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 1233,
      candidatesTokenCount: 410,
      thoughtsTokenCount: 12,
      totalTokenCount: 1655,
    },
    modelVersion: 'test-model',
    ...extra,
  };
}

const nullSense = { pos: null, gloss_en: null, meaning_tr: null, ipa: null };

export const GOOD_EXTRACT = {
  candidates: [
    {
      term: 'give up',
      surface: 'gave up',
      term_type: 'phrase',
      source_sentence: 'After years of trying, Maria finally gave up smoking.',
      sentence_tr: 'Yıllarca uğraştıktan sonra Maria sonunda sigarayı bıraktı.',
      confidence: 0.97,
      known_sense: null,
      pos: 'phrasal verb',
      gloss_en: 'stop doing a habit or activity',
      meaning_tr: 'bırakmak',
      ipa: '/ɡɪv ˈʌp/',
    },
    {
      term: 'bank',
      surface: 'bank',
      term_type: 'word',
      source_sentence: 'On Sunday she sat on the bank of the river and watched the boats drift by.',
      sentence_tr: 'Pazar günü nehir kıyısında oturup sürüklenen tekneleri izledi.',
      confidence: 0.95,
      known_sense: null,
      pos: 'noun',
      gloss_en: 'the land beside a river',
      meaning_tr: 'kıyı',
      ipa: '/bæŋk/',
    },
    {
      term: 'turn down',
      surface: 'turned her application down',
      term_type: 'phrase',
      source_sentence: 'The manager turned her application down because her income was too low.',
      sentence_tr: '“Müdür, geliri çok düşük olduğu için başvurusunu reddetti.”',
      confidence: 0.9,
      known_sense: null,
      pos: 'phrasal verb',
      gloss_en: 'reject an offer or request',
      meaning_tr: 'reddetmek',
      ipa: '/tɜːrn ˈdaʊn/',
    },
  ],
};

/** Second sense of "bank" while the river sense is offered as s1. */
export function knownSenseExtract(ref: string) {
  return {
    candidates: [
      {
        term: 'bank',
        surface: 'bank',
        term_type: 'word',
        source_sentence:
          'On Sunday she sat on the bank of the river and watched the boats drift by.',
        sentence_tr: 'Pazar günü nehir kıyısında oturup sürüklenen tekneleri izledi.',
        confidence: 0.96,
        known_sense: ref,
        ...nullSense,
      },
      {
        term: 'bank',
        surface: 'bank',
        term_type: 'word',
        source_sentence: 'On Monday she went to the bank to take out a loan.',
        sentence_tr: '   ',
        confidence: 0.94,
        known_sense: null,
        pos: 'noun',
        gloss_en: 'an organization that keeps and lends money',
        meaning_tr: 'banka',
        ipa: null,
      },
    ],
  };
}

/** Sentence not in the chunk (paraphrased), plus one good candidate. */
export const HALLUCINATED_SENTENCE = {
  candidates: [
    {
      term: 'quit',
      surface: 'quit',
      term_type: 'word',
      source_sentence: 'Maria quit smoking after many years.',
      confidence: 0.9,
      known_sense: null,
      pos: 'verb',
      gloss_en: 'stop doing something',
      meaning_tr: 'bırakmak',
      ipa: null,
    },
    GOOD_EXTRACT.candidates[0],
  ],
};

/** Missing meaning_tr / wrong types in single items; the rest is fine. */
export const MISSING_FIELD = {
  candidates: [
    {
      term: 'loan',
      surface: 'loan',
      term_type: 'word',
      source_sentence: 'On Monday she went to the bank to take out a loan.',
      confidence: 0.9,
      known_sense: null,
      pos: 'noun',
      gloss_en: 'money that is borrowed',
      ipa: null,
    },
    { term: 'income', surface: 'income', term_type: 'word', confidence: 0.9 },
    GOOD_EXTRACT.candidates[1],
  ],
};

/** Not the schema at all. */
export const SCHEMA_ERROR = { words: ['give up', 'bank'] };

export const QUOTA_ERROR_BODY = {
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }],
  },
};

export const OVERLOADED_BODY = {
  error: {
    code: 503,
    message: 'The model is experiencing high demand. Please try again later.',
    status: 'UNAVAILABLE',
  },
};

export const BAD_REQUEST_BODY = {
  error: {
    code: 400,
    message: 'Request contains an invalid argument.',
    status: 'INVALID_ARGUMENT',
  },
};

export const NOT_FOUND_BODY = {
  error: {
    code: 404,
    message: 'models/gemini-x is not found for API version v1beta',
    status: 'NOT_FOUND',
  },
};

export const ENRICH_BANK = {
  valid: true,
  lemma: 'bank',
  term_type: 'word',
  senses: [
    {
      pos: 'noun',
      gloss_en: 'an organization that keeps and lends money',
      meaning_tr: 'banka',
      ipa: '/bæŋk/',
      used_in_sentence: false,
    },
    {
      pos: 'noun',
      gloss_en: 'Land beside rivers.',
      meaning_tr: 'kıyı',
      ipa: '/bæŋk/',
      used_in_sentence: false,
    },
    {
      pos: 'verb',
      gloss_en: 'to keep money in a particular bank',
      meaning_tr: 'bankaya yatırmak',
      ipa: '/bæŋk/',
      used_in_sentence: false,
    },
  ],
  sentence_known_sense: null,
};

export const ENRICH_INVALID = {
  valid: false,
  lemma: 'asdfqwer',
  term_type: 'word',
  senses: [],
  sentence_known_sense: null,
};

// ---------------------------------------------------------------------------

export interface FakeCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export type FakeReply =
  { status: number; body: unknown; headers?: Record<string, string> } | 'timeout' | 'network';

/** fetch replacement answering with the scripted replies in order. */
export function fakeFetch(replies: FakeReply[]) {
  const calls: FakeCall[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i++;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply === 'timeout') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}
