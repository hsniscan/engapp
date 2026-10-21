// Smart decks ("Akıllı desteler"): a saved filter over the user's notes. Pure: no Dexie, no
// React. The filter is stored as JSON in decks.filter (synced) with a schema version `v`.
//
// Semantics: criteria of different kinds are combined with AND; values of one kind with OR
// (tags: OR by default, AND with tagMode 'all'). An absent or empty criterion matches every
// note. A note's status is one of new / learning / learned / suspended (from its recognition
// card, "suspended" when every live card is suspended) plus the overlay "struggling"
// ("Zorlandıklarım", the practice rule of domain/practice.ts, at note level).
//
// Extensibility (docs/decisions/0016): `levels` (İP2) and `topics` (İP7) are part of
// version 1 already. They are evaluated only when the caller passes the matching resolver
// (`levelOf`, `topicsOf`); a deck that uses a key this client cannot evaluate, a key it does
// not know, or a newer `v` is "unsupported": it is listed, never evaluated with the key
// ignored (that would show the wrong words), and its raw JSON is kept untouched on rename.
import { z } from 'zod';
import { HARD_MIN_DIFFICULTY, HARD_MIN_LAPSES, HARD_WINDOW_MS } from './practice';
import { hasTag, tagKey } from './tags';
import { type Card, CardState, type CefrLevel, type Id, type Millis, type Note } from './types';

export const DECK_FILTER_VERSION = 1;

export const DECK_STATES = ['new', 'learning', 'learned', 'struggling', 'suspended'] as const;
export type DeckState = (typeof DECK_STATES)[number];

export const CEFR_ORDER: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const MAX_DECK_TAGS = 20;
export const MAX_DECK_TOPICS = 20;
export const MAX_DECK_NAME = 60;
export const MAX_ADDED_WITHIN_DAYS = 3650;
/** "Son N günde eklenenler" choices offered by the editor. */
export const ADDED_WITHIN_CHOICES = [7, 30] as const;

export interface DeckFilter {
  v: typeof DECK_FILTER_VERSION;
  states?: DeckState[];
  tags?: string[];
  tagMode?: 'any' | 'all';
  /** Reserved for İP2: the note's resolved CEFR level. */
  levels?: CefrLevel[];
  /** Reserved for İP7: topic keys of the note (domain/topics.ts). */
  topics?: string[];
  addedWithinDays?: number;
}

export type DeckFilterKey = Exclude<keyof DeckFilter, 'v'>;
const KNOWN_KEYS: readonly string[] = [
  'v',
  'states',
  'tags',
  'tagMode',
  'levels',
  'topics',
  'addedWithinDays',
] satisfies (keyof DeckFilter)[];

export const deckFilterSchema = z.object({
  v: z.literal(DECK_FILTER_VERSION),
  states: z.array(z.enum(DECK_STATES)).max(DECK_STATES.length).optional(),
  tags: z.array(z.string().min(1).max(100)).max(MAX_DECK_TAGS).optional(),
  tagMode: z.enum(['any', 'all']).optional(),
  levels: z
    .array(z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']))
    .max(6)
    .optional(),
  topics: z.array(z.string().min(1).max(64)).max(MAX_DECK_TOPICS).optional(),
  addedWithinDays: z.number().int().min(1).max(MAX_ADDED_WITHIN_DAYS).optional(),
});

export type ParsedDeckFilter =
  | { ok: true; filter: DeckFilter }
  /** newer: made by a newer app version (higher v or unknown key); invalid: unreadable. */
  | { ok: false; reason: 'newer' | 'invalid' };

/** Read a stored filter. Never throws. */
export function parseDeckFilter(raw: unknown): ParsedDeckFilter {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, reason: 'invalid' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.v === 'number' && obj.v > DECK_FILTER_VERSION)
    return { ok: false, reason: 'newer' };
  if (Object.keys(obj).some((k) => !KNOWN_KEYS.includes(k))) return { ok: false, reason: 'newer' };
  const p = deckFilterSchema.safeParse(obj);
  return p.success
    ? { ok: true, filter: normalizeDeckFilter(p.data) }
    : { ok: false, reason: 'invalid' };
}

function uniqueBy<T>(items: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Canonical form: empty criteria removed, duplicates dropped (tags case-insensitively),
 * states and levels in their fixed order, tagMode only with two or more tags.
 */
export function normalizeDeckFilter(f: Omit<DeckFilter, 'v'> & { v?: number }): DeckFilter {
  const out: DeckFilter = { v: DECK_FILTER_VERSION };
  const states = DECK_STATES.filter((s) => f.states?.includes(s));
  if (states.length) out.states = states;
  const tags = uniqueBy(
    (f.tags ?? []).map((t) => t.normalize('NFC').trim()).filter(Boolean),
    tagKey,
  ).slice(0, MAX_DECK_TAGS);
  if (tags.length) out.tags = tags;
  if (tags.length > 1 && f.tagMode === 'all') out.tagMode = 'all';
  const levels = CEFR_ORDER.filter((l) => f.levels?.includes(l));
  if (levels.length) out.levels = levels;
  const topics = [...new Set((f.topics ?? []).filter(Boolean))].slice(0, MAX_DECK_TOPICS);
  if (topics.length) out.topics = topics;
  if (
    f.addedWithinDays !== undefined &&
    Number.isInteger(f.addedWithinDays) &&
    f.addedWithinDays >= 1 &&
    f.addedWithinDays <= MAX_ADDED_WITHIN_DAYS
  )
    out.addedWithinDays = f.addedWithinDays;
  return out;
}

/** Number of criteria kinds in use (0 = every note). */
export function criteriaCount(f: DeckFilter): number {
  return (
    (f.states?.length ? 1 : 0) +
    (f.tags?.length ? 1 : 0) +
    (f.levels?.length ? 1 : 0) +
    (f.topics?.length ? 1 : 0) +
    (f.addedWithinDays ? 1 : 0)
  );
}

// ------------------------------------------------------------------ evaluation

export type DeckCard = Pick<
  Card,
  'id' | 'card_type' | 'state' | 'suspended' | 'deleted_at' | 'lapses' | 'difficulty' | 'reps'
>;

/** What the evaluator needs about one live note, gathered by the data layer. */
export interface DeckNoteFacts {
  note: Pick<Note, 'id' | 'tags' | 'created_at'>;
  /** Live cards of the note. */
  cards: readonly DeckCard[];
  /** Latest Again (not undone) on any card of the note; null when none. */
  lastAgainAt: Millis | null;
  /** Latest "Bilemedim" in a practice round on any card of the note. */
  lastPracticeMissAt: Millis | null;
}

export interface DeckContext {
  now: Millis;
  /** İP2: the note's resolved level. Without it `levels` cannot be evaluated. */
  levelOf?: (noteId: Id) => CefrLevel | null;
  /** İP7: the note's topic keys. Without it `topics` cannot be evaluated. */
  topicsOf?: (noteId: Id) => readonly string[];
}

/** Keys the filter uses that this context cannot evaluate (empty = evaluable). */
export function unsupportedKeys(
  f: DeckFilter,
  ctx: Pick<DeckContext, 'levelOf' | 'topicsOf'>,
): DeckFilterKey[] {
  const out: DeckFilterKey[] = [];
  if (f.levels?.length && !ctx.levelOf) out.push('levels');
  if (f.topics?.length && !ctx.topicsOf) out.push('topics');
  return out;
}

export type NoteStatus = 'new' | 'learning' | 'learned' | 'suspended';

/** Primary status of a note: suspended when every live card is, else its recognition card's. */
export function noteStatus(facts: Pick<DeckNoteFacts, 'cards'>): NoteStatus | null {
  const live = facts.cards.filter((c) => c.deleted_at === null);
  if (live.length === 0) return null;
  if (live.every((c) => c.suspended)) return 'suspended';
  const main =
    live.find((c) => c.card_type === 'recognition' && !c.suspended) ??
    live.find((c) => !c.suspended)!;
  switch (main.state) {
    case CardState.New:
      return 'new';
    case CardState.Review:
      return 'learned';
    default:
      return 'learning';
  }
}

/** "Zorlandıklarım" at note level: the practice 'hard' rule on any studied, unsuspended card. */
export function isStruggling(facts: DeckNoteFacts, now: Millis): boolean {
  const since = now - HARD_WINDOW_MS;
  const studied = facts.cards.some(
    (c) => c.deleted_at === null && !c.suspended && c.state !== CardState.New && c.reps > 0,
  );
  if (!studied) return false;
  if (
    facts.cards.some(
      (c) =>
        c.deleted_at === null &&
        !c.suspended &&
        c.state !== CardState.New &&
        (c.lapses >= HARD_MIN_LAPSES || c.difficulty >= HARD_MIN_DIFFICULTY),
    )
  )
    return true;
  return (
    (facts.lastAgainAt !== null && facts.lastAgainAt >= since) ||
    (facts.lastPracticeMissAt !== null && facts.lastPracticeMissAt >= since)
  );
}

const DAY = 86_400_000;

/**
 * Does the note belong to the deck? Callers check unsupportedKeys first; a key without its
 * resolver here matches nothing (never everything).
 */
export function matchesDeck(f: DeckFilter, facts: DeckNoteFacts, ctx: DeckContext): boolean {
  if (f.addedWithinDays && facts.note.created_at < ctx.now - f.addedWithinDays * DAY) return false;
  if (f.tags?.length) {
    const tags = facts.note.tags;
    const ok =
      f.tagMode === 'all'
        ? f.tags.every((t) => hasTag(tags, t))
        : f.tags.some((t) => hasTag(tags, t));
    if (!ok) return false;
  }
  if (f.levels?.length) {
    const level = ctx.levelOf?.(facts.note.id) ?? null;
    if (!level || !f.levels.includes(level)) return false;
  }
  if (f.topics?.length) {
    const topics = ctx.topicsOf?.(facts.note.id) ?? [];
    if (!f.topics.some((t) => topics.includes(t))) return false;
  }
  if (f.states?.length) {
    const status = noteStatus(facts);
    const ok =
      (status !== null && (f.states as readonly string[]).includes(status)) ||
      (f.states.includes('struggling') && status !== 'suspended' && isStruggling(facts, ctx.now));
    if (!ok) return false;
  }
  return true;
}

/** Ids of the matching notes, or null when the deck cannot be evaluated here. */
export function deckNoteIds(
  raw: unknown,
  notes: Iterable<DeckNoteFacts>,
  ctx: DeckContext,
): Set<Id> | null {
  const parsed = parseDeckFilter(raw);
  if (!parsed.ok || unsupportedKeys(parsed.filter, ctx).length) return null;
  const out = new Set<Id>();
  for (const n of notes) if (matchesDeck(parsed.filter, n, ctx)) out.add(n.note.id);
  return out;
}

// ------------------------------------------------------------------ decks

export interface DeckLike {
  id: Id;
  sort: number;
  created_at: Millis;
  deleted_at: Millis | null;
}

/** Live decks in display order (sort, then creation). */
export function orderDecks<T extends DeckLike>(decks: readonly T[]): T[] {
  return decks
    .filter((d) => d.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
}

/** Deck names are trimmed, single-spaced and NFC; at most MAX_DECK_NAME code points. */
export function cleanDeckName(raw: string): string {
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_DECK_NAME).join('').trim();
}
