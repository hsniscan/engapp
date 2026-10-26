// Contracts of the ai-story edge function (v0.5 İP8, docs/decisions/0050-daily-story.md).
// Imported by the function (Deno) and by the web client (src/ai/story.ts), so both sides
// share the request/response schemas and the limits.
//
// Privacy (plan criterion 10): the request is the whole of what leaves the device, and it is
// closed (`strict`): the target words (dictionary forms of the user's own cards), the level,
// the reading difficulty, at most three topic keys and, for a regeneration, the words to
// avoid (taken from the previous generated story, never from a text of the user).

import { z } from 'zod';
import { cefrLevel, usageInfo } from './contracts.ts';
import { EXTRACT_TOPIC_KEYS } from './topics-contract.ts';

/** Version of the story prompt and response schema. Bump with every change (story-prompt.ts). */
export const STORY_PROMPT_VERSION = 'story-v1';

/** Target words per story (plan: 5–8). */
export const MIN_STORY_TARGETS = 5;
export const MAX_STORY_TARGETS = 8;
/** At least this many target words must really occur in the story (criterion 7). */
export const MIN_STORY_USED = 5;
/** The story's length as asked (prompt) and as accepted (validation, with some slack). */
export const STORY_WORDS = { min: 150, max: 250 } as const;
export const STORY_WORDS_ACCEPTED = { min: 130, max: 280 } as const;
export const STORY_QUESTIONS = 3;
export const MAX_STORY_TOPICS = 3;
export const MAX_STORY_AVOID = 20;
/** Default stories per user and UTC day (STORY_DAILY_LIMIT); each may be regenerated once. */
export const DEFAULT_STORY_DAILY_LIMIT = 1;

/**
 * Reading difficulty, the same keys as src/domain/texts.ts (READING_DIFFICULTIES);
 * src/domain/story.test.ts keeps the two identical.
 */
export const STORY_DIFFICULTIES = ['rahat', 'dengeli', 'zorlayici'] as const;
export type StoryDifficulty = (typeof STORY_DIFFICULTIES)[number];

/** A dictionary form in lower case: a word or a short expression ("decide", "give up"). */
export const storyLemma = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z' -]{0,38}[a-z]$/, 'a lower-case English word or expression')
  .refine((s) => s.split(' ').length <= 3, 'at most three words');

const distinct = (list: string[]) => new Set(list).size === list.length;

export const storyRequest = z
  .object({
    level: cefrLevel,
    difficulty: z.enum(STORY_DIFFICULTIES),
    interests: z.array(z.enum(EXTRACT_TOPIC_KEYS)).max(MAX_STORY_TOPICS),
    target_lemmas: z
      .array(storyLemma)
      .min(MIN_STORY_TARGETS)
      .max(MAX_STORY_TARGETS)
      .refine(distinct, 'target words must differ'),
    /** A regeneration: words of the first story the user most likely does not know. */
    avoid: z.array(storyLemma).max(MAX_STORY_AVOID).default([]),
  })
  .strict();
export type StoryRequest = z.input<typeof storyRequest>;

export const storyQuestion = z.object({
  /** The question, in simple English. */
  q: z.string(),
  /** Three (at most four) short options. */
  options: z.array(z.string()).min(2).max(4),
  /** 0-based index of the correct option. */
  answer: z.number().int().min(0),
});
export type StoryQuestion = z.infer<typeof storyQuestion>;

export const storyGloss = z.object({
  /** A target word as requested, or the dictionary form of another hard word of the story. */
  lemma: z.string(),
  /** Its Turkish meaning in this story (1–4 words). */
  gloss_tr: z.string(),
});
export type StoryGloss = z.infer<typeof storyGloss>;

/** The checked story (the server verified every field, see story.ts validateStoryOutput). */
export const storyContent = z.object({
  title: z.string().min(1).max(120),
  paragraphs: z.array(z.string().min(1)).min(1).max(8),
  /** The target words that really occur in the text (checked in code, any inflection). */
  used_lemmas: z.array(z.string()),
  questions: z.array(storyQuestion).length(STORY_QUESTIONS),
  /** Glosses of every used target word, then of other hard words. */
  glosses: z.array(storyGloss),
});
export type StoryContent = z.infer<typeof storyContent>;

export const storyResponse = z.object({
  prompt_version: z.string(),
  model: z.string(),
  story: storyContent,
  /** Stories made today after this request, and the daily limit. */
  usage: usageInfo,
});
export type StoryResponse = z.infer<typeof storyResponse>;
