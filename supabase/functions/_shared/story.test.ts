// @vitest-environment node
// ai-story (decision 0050): the output checks, the daily limit, the text budget, the privacy
// of the request, and the edge function end to end with a mocked model. No live calls.
import { describe, expect, it } from 'vitest';
import { AiError } from './ai-provider.ts';
import { DEFAULT_CLAUDE_TEXT_MODEL } from './ai-claude-text.ts';
import { ApiError } from './errors.ts';
import { createStoryFunction } from './setup.ts';
import { claudeStoryModel, createClaudeStoryModel } from './story-claude.ts';
import {
  pickedMinUsed,
  PICKED_PROMPT_VERSION,
  storyRequest,
  storyResponse,
  STORY_PROMPT_VERSION,
} from './story-contract.ts';
import { buildStoryUserPrompt, PICKED_SYSTEM_PROMPT, STORY_SYSTEM_PROMPT } from './story-prompt.ts';
import { MemoryStoryStore } from './story-store.ts';
import {
  pickedDailyLimit,
  runStory,
  usedTargets,
  validateStoryOutput,
  type StoryDeps,
  type StoryModel,
  type StoryModelRequest,
} from './story.ts';
import { GOOD_STORY, STORY_REQUEST, STORY_TARGETS } from './testing/story-fixtures.ts';
import { MemoryTextBudgetStore } from './text-budget.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A model that answers from a list (the last answer repeats) and records every request. */
function fakeModel(answers: unknown[], costUsd = 0.0004) {
  const calls: StoryModelRequest[] = [];
  let i = 0;
  const model: StoryModel = {
    model: 'claude-haiku-test',
    async call(req) {
      calls.push(req);
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return { data: a, costUsd, model: 'claude-haiku-test' };
    },
  };
  return { model, calls };
}

function deps(over: Partial<StoryDeps> = {}, answers: unknown[] = [GOOD_STORY]) {
  const fm = fakeModel(answers);
  const store = new MemoryStoryStore(() => '2026-11-02');
  const d: StoryDeps = { userId: 'u1', store, model: () => fm.model, dailyLimit: 1, ...over };
  return { d, store, calls: fm.calls };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiError ? e.code : `other: ${String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// validateStoryOutput
// ---------------------------------------------------------------------------

describe('validateStoryOutput', () => {
  it('accepts a good answer and verifies the target words in the text itself', () => {
    const v = validateStoryOutput(GOOD_STORY, STORY_TARGETS);
    if (typeof v === 'string') throw new Error(v);
    expect(v.title).toBe('The Sunday Cake');
    expect(v.paragraphs).toHaveLength(4);
    // "decided", "borrowed" count for "decide", "borrow".
    expect(v.used_lemmas).toEqual(STORY_TARGETS);
    expect(v.questions[1]).toEqual({
      q: 'Where did the recipe come from?',
      options: ['A shop in the village', 'A book from her neighbour', "Her brother's phone"],
      answer: 1,
    });
    // Target glosses first, then other words of the text; a gloss for a word that is not in
    // the text ("unicorn") is dropped.
    expect(v.glosses.map((g) => g.lemma)).toEqual([...STORY_TARGETS, 'neighbour']);
    expect(v.glosses[2]).toEqual({ lemma: 'borrow', gloss_tr: 'ödünç almak' });
  });

  it('does not trust the model’s used_words', () => {
    const targets = ['decide', 'journey', 'borrow', 'nervous', 'volcano'];
    expect(usedTargets(GOOD_STORY.paragraphs, targets)).toEqual(['decide', 'journey', 'borrow', 'nervous']);
    const claimed = { ...clone(GOOD_STORY), used_words: targets };
    expect(validateStoryOutput(claimed, targets)).toBe('targets_missing');
  });

  it('finds a phrasal target in an inflected form', () => {
    expect(usedTargets(['In the end she gave it up and went home.'], ['give up'])).toEqual(['give up']);
  });

  it.each([
    ['invalid_shape', (s: typeof GOOD_STORY) => ({ title: s.title })],
    ['bad_title', (s: typeof GOOD_STORY) => ({ ...s, title: '<b>Cake</b>' })],
    ['bad_text', (s: typeof GOOD_STORY) => ({ ...s, paragraphs: [...s.paragraphs, 'See https://x.example now.'] })],
    ['bad_text', (s: typeof GOOD_STORY) => ({ ...s, paragraphs: [...s.paragraphs.slice(1), 'Привет мир.'] })],
    ['length', (s: typeof GOOD_STORY) => ({ ...s, paragraphs: s.paragraphs.slice(0, 2) })],
    ['bad_questions', (s: typeof GOOD_STORY) => ({ ...s, questions: s.questions.slice(0, 2) })],
    [
      'bad_questions',
      (s: typeof GOOD_STORY) => ({
        ...s,
        questions: s.questions.map((q, i) => (i === 0 ? { ...q, answer_index: 3 } : q)),
      }),
    ],
    [
      'bad_questions',
      (s: typeof GOOD_STORY) => ({
        ...s,
        questions: s.questions.map((q, i) => (i === 2 ? { ...q, options: ['Tea', 'tea.', 'Milk'] } : q)),
      }),
    ],
    ['glosses_missing', (s: typeof GOOD_STORY) => ({ ...s, glosses: s.glosses.slice(1) })],
  ])('refuses an answer: %s', (reason, edit) => {
    expect(validateStoryOutput(edit(clone(GOOD_STORY)), STORY_TARGETS)).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
// The request: only what the plan allows leaves the device
// ---------------------------------------------------------------------------

describe('storyRequest (privacy)', () => {
  it('is closed: a text, a sentence or a user id is refused', () => {
    for (const extra of [{ text: 'my diary' }, { sentence: 'I went home.' }, { user_id: 'u2' }]) {
      expect(storyRequest.safeParse({ ...STORY_REQUEST, ...extra }).success).toBe(false);
    }
    expect(storyRequest.safeParse(STORY_REQUEST).success).toBe(true);
  });

  it('takes 5–8 distinct dictionary forms', () => {
    const bad = [
      ['decide', 'journey', 'borrow', 'nervous'],
      [...STORY_TARGETS, 'a1', 'b2', 'c3'],
      ['decide', 'decide', 'borrow', 'nervous', 'recipe'],
      ['decide', 'journey', 'borrow', 'nervous', 'I went to the shop yesterday'],
    ];
    for (const t of bad) expect(storyRequest.safeParse({ ...STORY_REQUEST, target_lemmas: t }).success).toBe(false);
  });

  it('sends the model exactly the request’s fields (snapshot)', async () => {
    const { d, calls } = deps();
    await runStory(STORY_REQUEST, d);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toBe(STORY_SYSTEM_PROMPT);
    expect(calls[0]!.user).toBe(
      [
        'LEVEL: B1',
        'DIFFICULTY: dengeli',
        'TOPICS: food, travel',
        'TARGET_WORDS: decide, journey, borrow, nervous, recipe, improve',
        'AVOID_WORDS: (none)',
      ].join('\n'),
    );
  });

  it('a regeneration adds only the avoid list', () => {
    expect(
      buildStoryUserPrompt({
        level: 'A2',
        difficulty: 'rahat',
        interests: ['daily_life'],
        targets: STORY_TARGETS,
        avoid: ['wonderful'],
      }),
    ).toContain('TOPICS: daily life\nTARGET_WORDS: decide, journey, borrow, nervous, recipe, improve\nAVOID_WORDS: wonderful');
  });
});

// ---------------------------------------------------------------------------
// runStory: daily limit, budget, retries
// ---------------------------------------------------------------------------

describe('runStory', () => {
  it('returns the checked story with today’s usage', async () => {
    const { d } = deps();
    const r = await runStory(STORY_REQUEST, d);
    expect(storyResponse.parse(r)).toEqual(r);
    expect(r.prompt_version).toBe(STORY_PROMPT_VERSION);
    expect(r.usage).toEqual({ used: 1, limit: 1 });
    expect(r.story.used_lemmas).toHaveLength(6);
  });

  it('keeps to one story a day, plus one regeneration of it', async () => {
    const { d } = deps();
    await runStory(STORY_REQUEST, d);
    expect(await code(runStory(STORY_REQUEST, d))).toBe('daily_limit');
    const again = { ...STORY_REQUEST, avoid: ['wonderful'] };
    expect(await code(runStory(again, d))).toBe('ok');
    expect(await code(runStory(again, d))).toBe('daily_limit');
    // Another user is not affected.
    expect(await code(runStory(STORY_REQUEST, { ...d, userId: 'u2' }))).toBe('ok');
  });

  it('refuses a regeneration before the day’s story', async () => {
    const { d, calls } = deps();
    expect(await code(runStory({ ...STORY_REQUEST, avoid: ['lemon'] }, d))).toBe('daily_limit');
    expect(calls).toHaveLength(0);
  });

  it('tries once more on an unusable answer', async () => {
    const bad = { ...clone(GOOD_STORY), glosses: [] };
    const { d, calls } = deps({}, [bad, GOOD_STORY]);
    const r = await runStory(STORY_REQUEST, d);
    expect(calls).toHaveLength(2);
    expect(r.story.title).toBe('The Sunday Cake');
  });

  it('two unusable answers: ai_failed, and the day’s story is given back', async () => {
    const { d, store, calls } = deps({}, [undefined, { title: 'x' }]);
    expect(await code(runStory(STORY_REQUEST, d))).toBe('ai_failed');
    expect(calls).toHaveLength(2);
    expect([...store.days.values()][0]).toEqual({ stories: 0, retries: 0 });
    expect(await code(runStory(STORY_REQUEST, deps({ store }).d))).toBe('ok');
  });

  it('maps a provider failure and refunds', async () => {
    const { d, store } = deps({}, [new AiError('quota_exceeded', 'rate limited', 30)]);
    expect(await code(runStory(STORY_REQUEST, d))).toBe('quota_exceeded');
    expect([...store.days.values()][0]!.stories).toBe(0);
  });

  it('without a configured model: internal, nothing counted', async () => {
    const { d, store } = deps({ model: null });
    expect(await code(runStory(STORY_REQUEST, d))).toBe('internal');
    expect(store.days.size).toBe(0);
  });

  it('every call goes through the monthly text budget and books its cost', async () => {
    const budgetStore = new MemoryTextBudgetStore();
    const bad = { ...clone(GOOD_STORY), questions: [] };
    const { d } = deps({ budget: { store: budgetStore, capUsd: 10 } }, [bad, GOOD_STORY]);
    await runStory(STORY_REQUEST, d);
    expect(budgetStore.holds.size).toBe(0);
    expect(budgetStore.reserved).toBe(0);
    // Both answered calls are billed, the unusable one too.
    expect(budgetStore.spent).toBeCloseTo(0.0008, 6);
  });

  it('a used-up budget: budget_exhausted, no call, the day’s story given back', async () => {
    const budgetStore = new MemoryTextBudgetStore();
    budgetStore.spent = 10;
    const { d, store, calls } = deps({ budget: { store: budgetStore, capUsd: 10 } });
    expect(await code(runStory(STORY_REQUEST, d))).toBe('budget_exhausted');
    expect(calls).toHaveLength(0);
    expect([...store.days.values()][0]!.stories).toBe(0);
  });

  it('a call that fails in transport is settled at zero', async () => {
    const budgetStore = new MemoryTextBudgetStore();
    const { d } = deps({ budget: { store: budgetStore, capUsd: 10 } }, [new AiError('ai_failed', 'socket hang up')]);
    expect(await code(runStory(STORY_REQUEST, d))).toBe('ai_failed');
    expect(budgetStore.spent).toBe(0);
    expect(budgetStore.reserved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// "Kelimelerimle metin oluştur": source 'picked' (v0.5.1, decision 0056)
// ---------------------------------------------------------------------------

const PICKED_REQUEST = {
  ...STORY_REQUEST,
  source: 'picked',
  genre: 'dialogue',
  length: 'medium',
  target_lemmas: ['decide', 'journey', 'borrow'],
};

describe('picked texts', () => {
  it('takes 3–8 picked words; the daily story still needs 5', () => {
    expect(storyRequest.safeParse(PICKED_REQUEST).success).toBe(true);
    expect(
      storyRequest.safeParse({ ...PICKED_REQUEST, target_lemmas: ['decide', 'journey'] }).success,
    ).toBe(false);
    expect(
      storyRequest.safeParse({ ...STORY_REQUEST, target_lemmas: ['decide', 'journey', 'borrow'] })
        .success,
    ).toBe(false);
    // A daily story is always a medium story; a form or a length is a picked text's only.
    expect(storyRequest.safeParse({ ...STORY_REQUEST, genre: 'email' }).success).toBe(false);
    expect(storyRequest.safeParse({ ...PICKED_REQUEST, genre: 'poem' }).success).toBe(false);
    expect(storyRequest.safeParse({ ...PICKED_REQUEST, text: 'my diary' }).success).toBe(false);
  });

  it('needs all of 3 words, at most two left out of more', () => {
    expect([3, 4, 5, 6, 8].map(pickedMinUsed)).toEqual([3, 3, 3, 4, 6]);
  });

  it('sends the picked prompt: the daily fields plus FORM and LENGTH (snapshot)', async () => {
    const { d, calls } = deps();
    const r = await runStory(PICKED_REQUEST, d);
    expect(calls[0]!.system).toBe(PICKED_SYSTEM_PROMPT);
    expect(calls[0]!.user).toBe(
      [
        'LEVEL: B1',
        'DIFFICULTY: dengeli',
        'FORM: dialogue',
        'LENGTH: 180-250',
        'TOPICS: food, travel',
        'TARGET_WORDS: decide, journey, borrow',
        'AVOID_WORDS: (none)',
      ].join('\n'),
    );
    expect(r.prompt_version).toBe(PICKED_PROMPT_VERSION);
    expect(r.story.used_lemmas).toEqual(['decide', 'journey', 'borrow']);
  });

  it('has its own limit of 5 a day, apart from the day’s story', async () => {
    const { d, store } = deps({ dailyLimit: 1 });
    for (let i = 0; i < 5; i++) expect(await code(runStory(PICKED_REQUEST, d))).toBe('ok');
    expect(await code(runStory(PICKED_REQUEST, d))).toBe('daily_limit');
    // The day's story is not touched by picked texts.
    expect(await code(runStory(STORY_REQUEST, d))).toBe('ok');
    expect(store.days.get('u1|2026-11-02')).toEqual({ stories: 1, retries: 0 });
    expect(store.days.get('u1|2026-11-02|picked')).toEqual({ stories: 5, retries: 0 });
  });

  it('a failed picked text gives its own count back', async () => {
    const { d, store } = deps({}, [new AiError('ai_failed', 'socket hang up')]);
    expect(await code(runStory(PICKED_REQUEST, d))).toBe('ai_failed');
    expect(store.days.get('u1|2026-11-02|picked')).toEqual({ stories: 0, retries: 0 });
    expect(store.days.has('u1|2026-11-02')).toBe(false);
  });

  it('a text far longer than the length asked for is refused', async () => {
    const long = { ...clone(GOOD_STORY), paragraphs: [...GOOD_STORY.paragraphs, ...GOOD_STORY.paragraphs] };
    const { d } = deps({}, [long]);
    expect(await code(runStory({ ...PICKED_REQUEST, length: 'short' }, d))).toBe('ai_failed');
  });

  it('PICKED_STORY_DAILY_LIMIT overrides the default of 5', () => {
    expect(pickedDailyLimit(() => undefined)).toBe(5);
    expect(pickedDailyLimit((k) => (k === 'PICKED_STORY_DAILY_LIMIT' ? '7' : undefined))).toBe(7);
    expect(pickedDailyLimit(() => 'x')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Claude adapter (mocked fetch)
// ---------------------------------------------------------------------------

const claudeMessage = (text: string, stop = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: DEFAULT_CLAUDE_TEXT_MODEL,
  content: [{ type: 'text', text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 900, output_tokens: 600 },
});

function fakeClaude(bodies: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  let i = 0;
  const fetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, sent };
}

describe('createClaudeStoryModel', () => {
  it('model id from CLAUDE_STORY_MODEL, else CLAUDE_TEXT_MODEL, else the default', () => {
    expect(claudeStoryModel((k) => ({ CLAUDE_STORY_MODEL: 'haiku-story' })[k])).toBe('haiku-story');
    expect(claudeStoryModel((k) => ({ CLAUDE_TEXT_MODEL: 'haiku-text' })[k])).toBe('haiku-text');
    expect(claudeStoryModel(() => undefined)).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
  });

  it('one structured-output call; the answer and its cost', async () => {
    const api = fakeClaude([claudeMessage(JSON.stringify(GOOD_STORY))]);
    const m = createClaudeStoryModel({ apiKey: 'k', model: DEFAULT_CLAUDE_TEXT_MODEL, fetch: api.fetch });
    const r = await m.call({ system: 'S', user: 'U', schema: { type: 'object' }, maxOutputTokens: 100, timeoutMs: 5000 });
    expect(r.data).toEqual(GOOD_STORY);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
  });

  it('an answer that is not JSON is still billed and comes back without data', async () => {
    const api = fakeClaude([claudeMessage('Sorry, here is a story: ...')]);
    const m = createClaudeStoryModel({ apiKey: 'k', model: DEFAULT_CLAUDE_TEXT_MODEL, fetch: api.fetch });
    const r = await m.call({ system: 'S', user: 'U', schema: { type: 'object' }, maxOutputTokens: 100, timeoutMs: 5000 });
    expect(r.data).toBeUndefined();
    expect(r.costUsd).toBeGreaterThan(0);
    expect(api.sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The edge function (createStoryFunction) with a mocked model
// ---------------------------------------------------------------------------

describe('ai-story edge function', () => {
  const env = (k: string) => ({ ALLOWED_ORIGINS: 'https://app.example' })[k];
  function handler(opts: { budget?: MemoryTextBudgetStore; answers?: unknown[] } = {}) {
    const fm = fakeModel(opts.answers ?? [GOOD_STORY]);
    const store = new MemoryStoryStore(() => '2026-11-02');
    const h = createStoryFunction(env, {
      store,
      model: () => fm.model,
      budget: opts.budget ? { store: opts.budget, capUsd: 10 } : null,
      authenticate: async (req) => {
        if (req.headers.get('authorization') !== 'Bearer good')
          throw new ApiError('unauthorized', 'A signed-in account is required');
        return 'user-1';
      },
    });
    return { h, calls: fm.calls };
  }
  const post = (body: unknown, token = 'good') =>
    new Request('https://fn.example/functions/v1/ai-story', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, origin: 'https://app.example', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers a signed-in user with the story contract', async () => {
    const { h } = handler();
    const res = await h(post(STORY_REQUEST));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const json = storyResponse.parse(await res.json());
    expect(json.story.used_lemmas).toEqual(STORY_TARGETS);
  });

  it('needs a signed-in account; a guest gets 401 and no model call', async () => {
    const { h, calls } = handler();
    const res = await h(post(STORY_REQUEST, 'anon'));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect(calls).toHaveLength(0);
  });

  it('second story of the day: 429 daily_limit', async () => {
    const { h } = handler();
    expect((await h(post(STORY_REQUEST))).status).toBe(200);
    const res = await h(post(STORY_REQUEST));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('daily_limit');
  });

  it('used-up budget: 503 budget_exhausted', async () => {
    const budget = new MemoryTextBudgetStore();
    budget.spent = 10;
    const { h, calls } = handler({ budget });
    const res = await h(post(STORY_REQUEST));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('budget_exhausted');
    expect(calls).toHaveLength(0);
  });

  it('a request with anything beyond the allowed fields: 400', async () => {
    const { h, calls } = handler();
    const res = await h(post({ ...STORY_REQUEST, text: 'my own diary entry' }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
