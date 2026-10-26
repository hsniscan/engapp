// ai-story pipeline (v0.5 İP8, docs/decisions/0050-daily-story.md): "Bugünün hikâyesi", a
// 150–250 word English text around 5–8 of the user's own words, with three comprehension
// questions and the Turkish glosses of the words.
//
//   request (strict: target words, level, difficulty, topics, avoid list)
//   -> daily limit (one story per UTC day, one regeneration of it)
//   -> Claude Haiku under the monthly text budget (recordTextSpend per call)
//   -> validation (target words really used, length, questions, glosses), one more try
//   -> response; nothing is stored on the server (the device saves the story as its own text)
//
// A request that ends without a story gives its daily count back (story_refund), so a model
// failure or a used-up budget never costs the user the day's story.

import { AiError } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import { cleanExampleText, locateExampleTerm, wordCount } from './examples.ts';
import { reserveUsd, tokenBound } from './image-models.ts';
import {
  DEFAULT_STORY_DAILY_LIMIT,
  MIN_STORY_USED,
  STORY_PROMPT_VERSION,
  STORY_QUESTIONS,
  STORY_WORDS_ACCEPTED,
  storyRequest,
  type StoryContent,
  type StoryGloss,
  type StoryQuestion,
  type StoryResponse,
} from './story-contract.ts';
import {
  buildStoryUserPrompt,
  STORY_RESPONSE_SCHEMA,
  STORY_SYSTEM_PROMPT,
  storyModelGloss,
  storyModelOutput,
  storyModelQuestion,
} from './story-prompt.ts';
import { isCleanLexiconText } from './text.ts';
import { recordTextSpend, type TextBudget } from './text-budget.ts';

export const STORY_MAX_OUTPUT_TOKENS = 2048;
/** Head room Claude's adaptive thinking gets on top of the answer (as ai-claude-text.ts). */
export const STORY_THINKING_TOKENS = 2048;
export const STORY_TIMEOUT_MS = 12_000;
/** Model calls per request: the first answer and one more when it is not usable. */
export const STORY_ATTEMPTS = 2;
export const STORY_BUDGET_PURPOSE = 'story';

const MAX_TITLE_CHARS = 100;
const MAX_QUESTION_CHARS = 200;
const MAX_OPTION_CHARS = 120;
const MAX_GLOSS_CHARS = 60;
const MAX_EXTRA_GLOSSES = 12;

// ---------------------------------------------------------------------------
// Ports (Supabase and Claude in production, fakes in the tests)
// ---------------------------------------------------------------------------

export interface StoryUsage {
  allowed: boolean;
  used: number;
  limit: number;
}

/** The daily counter (story_consume / story_refund, migration 20261101000800). */
export interface StoryStore {
  consume(userId: string, retry: boolean, limit: number): Promise<StoryUsage>;
  refund(userId: string, retry: boolean): Promise<void>;
}

export interface StoryModelRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

/** One answered (billed) model call. `data` is undefined when the answer was not JSON. */
export interface StoryModelAnswer {
  data: unknown;
  costUsd: number;
  model: string;
}

/** One model call per `call`, no retries on a bad answer (the pipeline decides). */
export interface StoryModel {
  readonly model: string;
  /** Throws AiError when the call was not answered (network, rate limit, refusal). */
  call(req: StoryModelRequest): Promise<StoryModelAnswer>;
}

export interface StoryDeps {
  userId: string;
  store: StoryStore;
  /** Null when no model is configured (no ANTHROPIC_API_KEY). */
  model: (() => StoryModel) | null;
  /** The monthly text budget; absent only in tests and local runs. */
  budget?: TextBudget;
  dailyLimit: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Validation (pure; also used by the tests)
// ---------------------------------------------------------------------------

export type StoryDropReason =
  | 'not_json'
  | 'invalid_shape'
  | 'bad_title'
  | 'bad_text'
  | 'length'
  | 'targets_missing'
  | 'bad_questions'
  | 'glosses_missing';

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu;
// Story text: Latin letters, digits and ordinary punctuation, typographic quotes and dashes.
const STORY_TEXT = /^[\p{Script=Latin}\p{M}\p{N} '’‘“”",;:.…()\-–—/!?&%$£€]+$/u;

/** Whitespace collapsed, invisible characters removed; null when not clean story text. */
export function cleanStoryText(raw: string): string | null {
  const v = raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!v || !/\p{L}/u.test(v) || !STORY_TEXT.test(v) || !isCleanLexiconText(v, 'ipa')) return null;
  return v;
}

/** The target words that occur in the text, in any inflection (the model's claim is not trusted). */
export function usedTargets(paragraphs: readonly string[], targets: readonly string[]): string[] {
  return targets.filter((t) => paragraphs.some((p) => locateExampleTerm(p, t, '') !== null));
}

function cleanQuestion(raw: unknown): StoryQuestion | null {
  const p = storyModelQuestion.safeParse(raw);
  if (!p.success) return null;
  const q = cleanStoryText(p.data.question);
  if (!q || q.length > MAX_QUESTION_CHARS) return null;
  const options = p.data.options.map((o) => cleanStoryText(o));
  if (options.length < 2 || options.length > 4) return null;
  if (options.some((o) => !o || o.length > MAX_OPTION_CHARS)) return null;
  const keys = new Set(options.map((o) => o!.toLowerCase().replace(/[.!?]+$/, '')));
  if (keys.size !== options.length) return null;
  const answer = p.data.answer_index;
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return { q, options: options as string[], answer };
}

function cleanGloss(raw: unknown): StoryGloss | null {
  const p = storyModelGloss.safeParse(raw);
  if (!p.success) return null;
  const lemma = p.data.word.trim().toLowerCase();
  const tr = cleanExampleText(p.data.meaning_tr).replace(/[.]+$/, '').trim();
  if (!lemma || !tr || tr.length > MAX_GLOSS_CHARS || !isCleanLexiconText(tr, 'ipa')) return null;
  if (!/^[\p{Script=Latin}\p{M} ,()'-]+$/u.test(tr)) return null;
  // A gloss that only repeats the English word is no gloss.
  if (tr.toLowerCase() === lemma) return null;
  return { lemma, gloss_tr: tr.toLocaleLowerCase('tr') };
}

/**
 * Checks the model's answer against the request's target words. Returns the clean story, or
 * the first reason it is unusable. Never throws.
 */
export function validateStoryOutput(
  data: unknown,
  targets: readonly string[],
): StoryContent | StoryDropReason {
  const p = storyModelOutput.safeParse(data);
  if (!p.success) return 'invalid_shape';

  const title = cleanStoryText(cleanExampleText(p.data.title));
  if (!title || title.length > MAX_TITLE_CHARS) return 'bad_title';

  const raw = p.data.paragraphs.flatMap((x) => x.split(/\n\s*\n/)).filter((x) => x.trim());
  const paragraphs = raw.map(cleanStoryText);
  if (paragraphs.length === 0 || paragraphs.length > 8 || paragraphs.some((x) => x === null))
    return 'bad_text';
  const clean = paragraphs as string[];

  const words = clean.reduce((n, x) => n + wordCount(x), 0);
  if (words < STORY_WORDS_ACCEPTED.min || words > STORY_WORDS_ACCEPTED.max) return 'length';

  const used = usedTargets(clean, targets);
  if (used.length < Math.min(MIN_STORY_USED, targets.length)) return 'targets_missing';

  const questions = p.data.questions.map(cleanQuestion);
  if (questions.length !== STORY_QUESTIONS || questions.some((q) => q === null))
    return 'bad_questions';

  const byLemma = new Map<string, StoryGloss>();
  for (const g of p.data.glosses.map(cleanGloss)) {
    if (g && !byLemma.has(g.lemma)) byLemma.set(g.lemma, g);
  }
  const targetGlosses = used.map((t) => byLemma.get(t));
  if (targetGlosses.some((g) => !g)) return 'glosses_missing';
  // Other hard words: only ones that occur in the text, at most a dozen.
  const extra = [...byLemma.values()]
    .filter((g) => !targets.includes(g.lemma) && usedTargets(clean, [g.lemma]).length === 1)
    .slice(0, MAX_EXTRA_GLOSSES);

  return {
    title,
    paragraphs: clean,
    used_lemmas: used,
    questions: questions as StoryQuestion[],
    glosses: [...(targetGlosses as StoryGloss[]), ...extra],
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function storyDailyLimit(env: (k: string) => string | undefined): number {
  const n = Number(env('STORY_DAILY_LIMIT'));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_STORY_DAILY_LIMIT;
}

export async function runStory(body: unknown, deps: StoryDeps): Promise<StoryResponse> {
  const parsed = storyRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const req = parsed.data;
  const retry = req.avoid.length > 0;
  if (!deps.model) throw new ApiError('internal', 'The story model is not configured');

  const usage = await deps.store.consume(deps.userId, retry, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError(
      'daily_limit',
      retry
        ? 'Today’s story was already regenerated.'
        : `Today’s story is already made (${usage.used}/${usage.limit}).`,
    );

  let done = false;
  try {
    const model = deps.model();
    const system = STORY_SYSTEM_PROMPT;
    const user = buildStoryUserPrompt({
      level: req.level,
      difficulty: req.difficulty,
      interests: req.interests,
      targets: req.target_lemmas,
      avoid: req.avoid,
    });
    const boundUsd = reserveUsd(model.model, {
      inputTokens: tokenBound(system + user),
      maxTokens: STORY_MAX_OUTPUT_TOKENS + STORY_THINKING_TOKENS,
    });
    const call = async () => {
      const answer = await model.call({
        system,
        user,
        schema: STORY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        maxOutputTokens: STORY_MAX_OUTPUT_TOKENS,
        timeoutMs: STORY_TIMEOUT_MS,
      });
      return { value: answer, costUsd: answer.costUsd };
    };

    let last: StoryDropReason = 'not_json';
    for (let attempt = 1; attempt <= STORY_ATTEMPTS; attempt++) {
      let answer: StoryModelAnswer;
      if (deps.budget) {
        const spend = await recordTextSpend(
          deps.budget,
          { purpose: STORY_BUDGET_PURPOSE, boundUsd },
          call,
        );
        if (spend.kind === 'budget')
          throw new ApiError('budget_exhausted', 'This month’s text budget is used up.');
        answer = spend.value;
      } else {
        answer = (await call()).value;
      }
      const story =
        answer.data === undefined ? 'not_json' : validateStoryOutput(answer.data, req.target_lemmas);
      if (typeof story === 'string') {
        last = story;
        deps.log?.('ai-story unusable answer', { model: answer.model, attempt, reason: story });
        continue;
      }
      deps.log?.('ai-story model call', {
        model: answer.model,
        attempt,
        used: story.used_lemmas.length,
        targets: req.target_lemmas.length,
        retry,
      });
      done = true;
      return {
        prompt_version: STORY_PROMPT_VERSION,
        model: answer.model,
        story,
        usage: { used: usage.used, limit: usage.limit },
      };
    }
    throw new ApiError('ai_failed', `The model answer was not usable (${last}).`);
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  } finally {
    if (!done)
      await deps.store.refund(deps.userId, retry).catch((e: unknown) =>
        deps.log?.('ai-story refund failed', { error: String(e) }),
      );
  }
}
