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
import { type Card, type Id, type Millis, type PracticeLog, type PracticeResult, Rating } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { dueStudiedCards, logsByCard } from './history';
import { writeTx } from './writer';

export const MAX_PRACTICE_DURATION_MS = 60_000;

/** Every practicable card with the facts the selector needs (see PracticeCandidate). */
export async function loadPracticeCandidates(now: Millis = Date.now()): Promise<PracticeCandidate[]> {
  return db.transaction('r', [db.cards, db.notes, db.review_logs, db.practice_logs], async () => {
    const cards = (await dueStudiedCards(Infinity)).filter(isPracticable);
    if (cards.length === 0) return [];
    const since = now - HARD_WINDOW_MS;
    const [notes, recentLogs, misses] = await Promise.all([
      db.notes.bulkGet([...new Set(cards.map((c) => c.note_id))]),
      db.review_logs.where('reviewed_at').aboveOrEqual(since).toArray(),
      db.practice_logs.where('practiced_at').aboveOrEqual(since).filter((p) => p.result === 'unknown').toArray(),
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
      for (const l of eff) if (l.rating === Rating.Again && l.reviewed_at >= since) lastAgain.set(cardId, l.reviewed_at);
    }
    const lastMiss = new Map<Id, Millis>();
    for (const p of misses) lastMiss.set(p.card_id, Math.max(lastMiss.get(p.card_id) ?? 0, p.practiced_at));

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
}

export async function getPracticeSourceCounts(now: Millis = Date.now()): Promise<PracticeSourceCounts> {
  const c = countPracticeSources(await loadPracticeCandidates(now), now);
  const tags = [...c.tags]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'));
  return { hard: c.hard, recent: c.recent, tags };
}

/** The card ids of a new round, in play order. `seed` (the session id) fixes the shuffle. */
export async function getPracticeCards(
  filter: PracticeFilter,
  opts: { size: number; seed: string },
  now: Millis = Date.now(),
): Promise<Id[]> {
  return selectPracticeCards(await loadPracticeCandidates(now), filter, { now, size: opts.size, seed: opts.seed });
}

export interface PracticeAnswerInput {
  card_id: Id;
  result: PracticeResult;
  mode: string;
  session_id: Id;
  duration_ms: number;
}

/** Store one practice answer. Writes practice_logs only: the card's schedule never changes. */
export async function recordPractice(input: PracticeAnswerInput, now: Millis = Date.now()): Promise<PracticeLog> {
  if (input.result !== 'known' && input.result !== 'unknown') throw new ActionError('invalid_input', 'Invalid result');
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
      duration_ms: Math.min(MAX_PRACTICE_DURATION_MS, Math.max(0, Math.round(input.duration_ms || 0))),
      device_id: w.deviceId,
      created_at: now,
      hlc: w.nextHlc(),
    };
    await w.insertPracticeLog(log);
    return log;
  });
}
