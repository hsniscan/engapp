// Contracts of the ai-report edge function (v0.3 İP7, docs/decisions/0027). Imported by the
// function (Deno) and by the web client (src/ai/, src/domain/), so both sides share the
// request/response schemas, the fixed vocabularies and the number check.
//
// Privacy: the request holds ONLY summary numbers, group names from fixed lists and a focus
// key. No word, sentence, source title or other user text can be put into it: every string is
// an enum value, so a free text fails validation.

import { z } from 'zod';
import { usageInfo } from './contracts.ts';
import { EXTRACT_TOPIC_KEYS } from './topics-contract.ts';

/** Version of the report prompt and response schema. Bump with every change (report-prompt.ts). */
export const REPORT_PROMPT_VERSION = 'report-v1';

/**
 * The fixed list of focus keys. The device picks one by a fixed rule (src/domain/weeklyReport.ts)
 * and shows the fixed action button for it; the model only gets the key to talk about.
 */
export const REPORT_FOCUS_KEYS = [
  'lower_new_limit', // the forecast exceeds the daily capacity: lower the new-card limit
  'come_back', // few active days: pick the habit up again today
  'practice_weakest', // practise the missed words of the weakest category
  'practice_gap', // practise words remembered from English but not into English
  'mnemonic_hard', // find a mnemonic for the words forgotten most often
  'add_words', // no new cards are waiting: add words
  'keep_going', // everything is on track: keep the rhythm
] as const;
export type ReportFocusKey = (typeof REPORT_FOCUS_KEYS)[number];

/** Category dimensions (src/domain/retention.ts RETENTION_DIMENSIONS, same order). */
export const REPORT_DIMENSIONS = [
  'term_type',
  'level',
  'topic',
  'source',
  'pos',
  'card_type',
] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

/** Group keys that may be named per dimension. Sources have user titles: never named. */
export const REPORT_GROUP_KEYS = {
  term_type: ['word', 'phrase', 'pattern', 'affix'],
  level: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  topic: EXTRACT_TOPIC_KEYS,
  source: [],
  pos: [
    'noun',
    'verb',
    'adjective',
    'adverb',
    'phrasal verb',
    'idiom',
    'preposition',
    'conjunction',
    'pronoun',
    'interjection',
    'phrase',
    'determiner',
    'root',
    'prefix',
    'suffix',
  ],
  card_type: ['recognition', 'production', 'cloze'],
} as const satisfies Record<ReportDimension, readonly string[]>;

/** The Turkish name of a group, as the app shows it (the model writes about it in Turkish). */
export const REPORT_GROUP_NAMES_TR: Record<string, string> = {
  'term_type:word': 'tek kelimeler',
  'term_type:phrase': 'söz öbekleri',
  'term_type:pattern': 'kalıplar',
  'term_type:affix': 'kökler ve ekler',
  'card_type:recognition': 'İngilizceden Türkçeye kartlar',
  'card_type:production': 'Türkçeden İngilizceye kartlar',
  'card_type:cloze': 'boşluk doldurma kartları',
  'topic:daily_life': 'gündelik hayat konulu kelimeler',
  'topic:technology': 'teknoloji konulu kelimeler',
  'topic:science': 'bilim konulu kelimeler',
  'topic:business': 'iş ve finans konulu kelimeler',
  'topic:health': 'sağlık konulu kelimeler',
  'topic:education': 'eğitim konulu kelimeler',
  'topic:travel': 'seyahat konulu kelimeler',
  'topic:food': 'yemek konulu kelimeler',
  'topic:sports': 'spor konulu kelimeler',
  'topic:nature': 'doğa ve çevre konulu kelimeler',
  'topic:arts': 'sanat ve kültür konulu kelimeler',
  'topic:literature': 'kitap ve edebiyat konulu kelimeler',
  'topic:film': 'film ve dizi konulu kelimeler',
  'topic:games': 'oyun konulu kelimeler',
  'topic:politics': 'siyaset ve toplum konulu kelimeler',
  'topic:law': 'hukuk konulu kelimeler',
  'pos:noun': 'isimler',
  'pos:verb': 'fiiller',
  'pos:adjective': 'sıfatlar',
  'pos:adverb': 'zarflar',
  'pos:phrasal verb': 'öbek fiiller',
  'pos:idiom': 'deyimler',
  'pos:preposition': 'edatlar',
  'pos:conjunction': 'bağlaçlar',
  'pos:pronoun': 'zamirler',
  'pos:interjection': 'ünlemler',
  'pos:phrase': 'kalıp ifadeler',
  'pos:determiner': 'belirteçler',
  'pos:root': 'kökler',
  'pos:prefix': 'ön ekler',
  'pos:suffix': 'son ekler',
};

/** Turkish name of a group for the prompt; null key = a group that may not be named. */
export function groupNameTr(dimension: ReportDimension, key: string | null): string {
  if (key === null) return dimension === 'source' ? 'kaynaklarından biri' : 'bir kategori';
  if (dimension === 'level') return `${key} seviyesindeki kelimeler`;
  return REPORT_GROUP_NAMES_TR[`${dimension}:${key}`] ?? 'bir kategori';
}

/** Is `key` a nameable key of `dimension`? */
export function isNameableGroupKey(dimension: ReportDimension, key: string): boolean {
  return (REPORT_GROUP_KEYS[dimension] as readonly string[]).includes(key);
}

export const REPORT_GOAL_KEYS = ['week_active_days', 'week_minutes', 'month_new_terms'] as const;
export type ReportGoalKey = (typeof REPORT_GOAL_KEYS)[number];

const count = z.number().int().min(0).max(1_000_000);
const pct = z.number().int().min(0).max(100);

export const reportGroup = z
  .object({
    dimension: z.enum(REPORT_DIMENSIONS),
    /** A key from REPORT_GROUP_KEYS[dimension]; null = not named (sources). */
    key: z.string().max(40).nullable(),
    /** Retention of the group, whole percent. */
    rate_pct: pct,
  })
  .refine((g) => g.key === null || isNameableGroupKey(g.dimension, g.key), {
    message: 'group key is not from the fixed list',
    path: ['key'],
  });
export type ReportGroupInput = z.infer<typeof reportGroup>;

export const reportRequest = z.object({
  /** Monday of the reported week (local day). */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active_days: z.number().int().min(0).max(7),
  reviews: count,
  minutes: count,
  new_learned: count,
  /** Week's retention in whole percent; null with fewer than 20 counted answers. */
  retention_pct: pct.nullable(),
  /** Days the categories were compared over (the week, or 28 days when the week had too few answers). */
  groups_days: z.union([z.literal(7), z.literal(28)]),
  strongest: reportGroup.nullable(),
  weakest: reportGroup.nullable(),
  streak_days: count,
  goals: z
    .array(z.object({ key: z.enum(REPORT_GOAL_KEYS), target: count, value: count }))
    .max(REPORT_GOAL_KEYS.length),
  focus: z.enum(REPORT_FOCUS_KEYS),
});
export type ReportRequest = z.infer<typeof reportRequest>;

/** Sentences of a comment. */
export const MIN_REPORT_SENTENCES = 2;
export const MAX_REPORT_SENTENCES = 4;
export const MAX_REPORT_SENTENCE_CHARS = 240;
export const MAX_REPORT_COMMENT_CHARS = MAX_REPORT_SENTENCES * MAX_REPORT_SENTENCE_CHARS;

export const reportResponse = z.object({
  prompt_version: z.string(),
  model: z.string().nullable(),
  /** 2–4 Turkish sentences, every number in them taken from the request. */
  comment: z.string().min(1).max(MAX_REPORT_COMMENT_CHARS),
  counts: z.object({
    sentences: z.number(),
    /** sentences the server discarded, by reason */
    dropped: z.record(z.string(), z.number()),
  }),
  usage: usageInfo.nullable(),
});
export type ReportResponse = z.infer<typeof reportResponse>;

// ---------------------------------------------------------------------------
// Numbers in the comment (used by the server, and again by the client before it stores one)
// ---------------------------------------------------------------------------

/** The numbers the comment may contain: the request's own values (and percentages as such). */
export function allowedNumbers(req: ReportRequest): Set<number> {
  const out = new Set<number>([
    req.active_days,
    req.reviews,
    req.minutes,
    req.new_learned,
    req.streak_days,
    req.groups_days,
  ]);
  if (req.retention_pct !== null) out.add(req.retention_pct);
  for (const g of [req.strongest, req.weakest]) if (g) out.add(g.rate_pct);
  for (const g of req.goals) {
    out.add(g.target);
    out.add(g.value);
  }
  return out;
}

/** Turkish number words (except "bir", which is also the article "a"). */
const NUMBER_WORDS: Record<string, number> = {
  iki: 2,
  üç: 3,
  dört: 4,
  beş: 5,
  altı: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  yirmi: 20,
  otuz: 30,
  kırk: 40,
  elli: 50,
  altmış: 60,
  yetmiş: 70,
  seksen: 80,
  doksan: 90,
  yüz: 100,
  bin: 1000,
};

/**
 * Numbers written in a sentence: digit groups ("1.250", "%80", "80'den", "3,5") and Turkish
 * number words ("beş", "yirmi üç" = 20 and 3 counted separately). A decimal is returned as is,
 * so it never matches a whole input number.
 */
export function numbersIn(sentence: string): number[] {
  const out: number[] = [];
  for (const m of sentence.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0];
    // "1.250" (thousands) vs "3,5" / "3.5" (decimals)
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) out.push(Number(raw.replace(/\./g, '')));
    else out.push(Number(raw.replace(',', '.')));
  }
  const words = sentence
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
  for (const w of words) if (w in NUMBER_WORDS) out.push(NUMBER_WORDS[w]!);
  return out;
}

/** Every number of the sentence is one of the request's numbers. */
export function numbersMatch(sentence: string, allowed: ReadonlySet<number>): boolean {
  return numbersIn(sentence).every((n) => allowed.has(n));
}

/** Split a comment into sentences (". ", "! ", "? " followed by a capital or the end). */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ"“])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The comment without sentences whose numbers are not the request's (the device runs this on
 * the server's answer too: the AI never produces a number the app did not compute). Null when
 * fewer than MIN_REPORT_SENTENCES sentences remain.
 */
export function keepMatchingSentences(text: string, req: ReportRequest): string | null {
  const allowed = allowedNumbers(req);
  const kept = splitSentences(text)
    .filter((s) => numbersMatch(s, allowed))
    .slice(0, MAX_REPORT_SENTENCES);
  return kept.length >= MIN_REPORT_SENTENCES ? kept.join(' ') : null;
}
