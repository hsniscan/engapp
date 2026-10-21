// Request/response contract of ai-themes ("Kelimelerimi temalara ayır", v0.2 İP8). Imported
// by the function (Deno) and by the web client (src/ai/client.ts). Kept apart from
// contracts.ts so the theme grouping can change without touching the other functions.

import { z } from 'zod';
import { usageInfo } from './contracts.ts';

export const THEMES_PROMPT_VERSION = 'themes-v1';
/** Words per request (one model call). The client splits larger sets. */
export const MAX_THEME_WORDS = 200;
export const MAX_THEME_GROUPS = 12;
export const MIN_THEME_GROUP_SIZE = 2;
/** Longest group name (characters) the server returns; it becomes a tag on the client. */
export const MAX_THEME_NAME = 40;

export const themeWord = z.object({
  /** Short opaque reference chosen by the client ("w1" … "w200"); never a database id. */
  ref: z.string().regex(/^w\d{1,3}$/),
  /** The word or expression (dictionary form). */
  lemma: z.string().trim().min(1).max(80),
  /** Short English definition from the shared lexicon, if any. Never a user sentence. */
  gloss_en: z.string().trim().max(200).nullable().default(null),
});
export type ThemeWord = z.input<typeof themeWord>;

export const themesRequest = z.object({
  words: z
    .array(themeWord)
    .min(1)
    .max(MAX_THEME_WORDS)
    .refine((ws) => new Set(ws.map((w) => w.ref)).size === ws.length, 'refs must be unique'),
});
export type ThemesRequest = z.input<typeof themesRequest>;

export const themeGroup = z.object({
  name_tr: z.string().min(1).max(MAX_THEME_NAME),
  refs: z.array(z.string()).min(MIN_THEME_GROUP_SIZE),
});
export type ThemeGroup = z.infer<typeof themeGroup>;

export const themesResponse = z.object({
  prompt_version: z.string(),
  model: z.string().nullable(),
  /** Each ref appears in at most one group; groups are ordered largest first. */
  groups: z.array(themeGroup).max(MAX_THEME_GROUPS),
  usage: usageInfo.nullable(),
});
export type ThemesResponse = z.infer<typeof themesResponse>;
