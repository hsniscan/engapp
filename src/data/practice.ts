// Practice rounds ("Pratik turu"), data side. Selection reads cards, notes, review_logs and
// practice_logs; answering writes ONLY a practice_logs row (plus its outbox row and the
// clock). Cards, review_logs and daily_activity are never written here (plan rule 1).
import {
  countPracticeSources,
  HARD_WINDOW_MS,
  isPracticable,
  type PracticeCandidate,
  type PracticeFilter,
  selectPracticeCards,
} from '../domain/practice';
import { effectiveLogs } from '../domain/recompute';
import {
  type Card,
  type Id,
  type Millis,
  type PracticeLog,
  type PracticeResult,
  Rating,
} from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { deckNoteIds } from '../domain/deckFilter';
import { deckContext, getDeckNoteIds, listDecks, loadDeckFacts } from './decks';
import { dueStudiedCards, logsByCard } from './history';
import { getTopicProfile } from './profile';
import { writeTx } from './writer';

export const MAX_PRACTICE_DURATION_MS = 60_000;

/** "İlgi alanlarımdan" draws from texts about this many of the user's heaviest topics. */
export const INTEREST_TOPIC_COUNT = 3;

/**
 * Notes for "İlgi alanlarımdan" (İP7): live notes with a live sense from a live text whose
 * topics include one of the user's top INTEREST_TOPIC_COUNT topics (profile weights, muted
 * topics excluded). Uses the sources `*topics` index (Dexie v7).
 */
export async function getInterestNoteIds(now: Millis = Date.now()): Promise<Set<Id>> {
  const top = (await getTopicProfile(now)).ranked.slice(0, INTEREST_TOPIC_COUNT);
  if (top.length === 0) return new Set();
  const sources = await db.sources.where('topics').anyOf(top).toArray();
  const sourceIds = new Set(sources.filter((x) => x.deleted_at === null).map((x) => x.id));
  if (sourceIds.size === 0) return new Set();
  const senses = await db.senses
    .filter((x) => x.deleted_at === null && !!x.source_id && sourceIds.has(x.source_id))
    .toArray();
  const noteIds = [...new Set(senses.map((x) => x.note_id))];
  const notes = await db.notes.bulkGet(noteIds);
  return new Set(notes.filter((n) => n && n.deleted_at === null).map((n) => n!.id));
}

/** Every practicable card with the facts the selector needs (see PracticeCandidate). */
export async function loadPracticeCandidates(
  now: Millis = Date.now(),
): Promise<PracticeCandidate[]> {
  return db.transaction('r', [db.cards, db.notes, db.review_logs, db.practice_logs], async () => {
    const cards = (await dueStudiedCards(Infinity)).filter(isPracticable);
    if (cards.length === 0) return [];
    const since = now - HARD_WINDOW_MS;
    const [notes, recentLogs, misses] = await Promise.all([
      db.notes.bulkGet([...new Set(cards.map((c) => c.note_id))]),
      db.review_logs.where('reviewed_at').aboveOrEqual(since).toArray(),
      db.practice_logs
        .where('practiced_at')
        .aboveOrEqual(since)
        .filter((p) => p.result === 'unknown')
        .toArray(),
    ]);
    const tags = new Map<Id, string[]>();
    for (const n of notes) if (n && n.deleted_at === null) tags.set(n.id, n.tags);

    // A card answered in the window: its first answer and latest Again, from all its logs
    // (an undo row cancels an older answer, so the window alone is not enough).
    const touched = await logsByCard(recentLogs.map((l) => l.card_id));
    const first = new Map<Id, Millis>();
    const lastAgain = new Map<Id, Millis>();
    for (const [cardId, logs] of touched) {
      const eff = effectiveLogs(logs);
      if (eff[0] && eff[0].reviewed_at >= since) first.set(cardId, eff[0].reviewed_at);
      for (const l of eff)
        if (l.rating === Rating.Again && l.reviewed_at >= since)
          lastAgain.set(cardId, l.reviewed_at);
    }
    const lastMiss = new Map<Id, Millis>();
    for (const p of misses)
      lastMiss.set(p.card_id, Math.max(lastMiss.get(p.card_id) ?? 0, p.practiced_at));

    return cards
      .filter((c) => tags.has(c.note_id))
      .map((card: Card) => ({
        card,
        firstReviewAt: first.get(card.id) ?? null,
        lastAgainAt: lastAgain.get(card.id) ?? null,
        lastPracticeMissAt: lastMiss.get(card.id) ?? null,
        tags: tags.get(card.note_id) ?? [],
      }));
  });
}

export interface PracticeSourceCounts {
  hard: number;
  recent: number;
  /** Tags of practicable notes with their note counts, most used first. */
  tags: { tag: string; count: number }[];
  /** Smart decks (in deck order) with their practicable notes; decks with none are left out. */
  decks: { id: Id; name: string; count: number }[];
  /** Practicable notes for "İlgi alanlarımdan" (getInterestNoteIds). */
  interests: number;
}

/** Cards the "Zorlandıklarım" practice would ask now (İlerleme: no link when there are none). */
export async function getHardPracticeCount(now: Millis = Date.now()): Promise<number> {
  return countPracticeSources(await loadPracticeCandidates(now), now).hard;
}

export async function getPracticeSourceCounts(
  now: Millis = Date.now(),
): Promise<PracticeSourceCounts> {
  const candidates = await loadPracticeCandidates(now);
  const c = countPracticeSources(candidates, now);
  const tags = [...c.tags]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'));
  const practicable = new Set(candidates.map((x) => x.card.note_id));
  const decks: PracticeSourceCounts['decks'] = [];
  const deckList = await listDecks();
  if (deckList.length) {
    const [facts, ctx] = await Promise.all([loadDeckFacts(now), deckContext(now)]);
    for (const deck of deckList) {
      const ids = deckNoteIds(deck.filter, facts, ctx);
      const count = ids ? [...ids].filter((id) => practicable.has(id)).length : 0;
      if (count > 0) decks.push({ id: deck.id, name: deck.name, count });
    }
  }
  const interestIds = await getInterestNoteIds(now);
  const interests = [...interestIds].filter((id) => practicable.has(id)).length;
  return { hard: c.hard, recent: c.recent, tags, decks, interests };
}

/** The card ids of a new round, in play order. `seed` (the session id) fixes the shuffle. */
export async function getPracticeCards(
  filter: PracticeFilter,
  opts: { size: number; seed: string },
  now: Millis = Date.now(),
): Promise<Id[]> {
  const resolved: PracticeFilter =
    filter.source === 'deck'
      ? { ...filter, noteIds: filter.deckId ? await getDeckNoteIds(filter.deckId, now) : null }
      : filter.source === 'interests'
        ? { ...filter, noteIds: await getInterestNoteIds(now) }
        : filter;
  return selectPracticeCards(await loadPracticeCandidates(now), resolved, {
    now,
    size: opts.size,
    seed: opts.seed,
  });
}

export interface PracticeAnswerInput {
  card_id: Id;
  result: PracticeResult;
  mode: string;
  session_id: Id;
  duration_ms: number;
}

/** Store one practice answer. Writes practice_logs only: the card's schedule never changes. */
export async function recordPractice(
  input: PracticeAnswerInput,
  now: Millis = Date.now(),
): Promise<PracticeLog> {
  if (input.result !== 'known' && input.result !== 'unknown')
    throw new ActionError('invalid_input', 'Invalid result');
  if (!input.mode || input.mode.length > 32) throw new ActionError('invalid_input', 'Invalid mode');
  return writeTx([db.practice_logs], now, async (w) => {
    const log: PracticeLog = {
      id: w.newId(),
      user_id: w.userId,
      card_id: input.card_id,
      practiced_at: now,
      result: input.result,
      mode: input.mode,
      session_id: input.session_id,
      duration_ms: Math.min(
        MAX_PRACTICE_DURATION_MS,
        Math.max(0, Math.round(input.duration_ms || 0)),
      ),
      device_id: w.deviceId,
      created_at: now,
      hlc: w.nextHlc(),
    };
    await w.insertPracticeLog(log);
    return log;
  });
}
