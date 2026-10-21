// daily_activity cache: updated incrementally with each answer, refreshed per day on undo,
// rebuilt from review_logs after sync and restore.
import { type DayConfig, type DayKey, dayEndMs, dayStartMs } from '../domain/day';
import type { Scheduler } from '../domain/fsrs';
import { isDayComplete } from '../domain/queue';
import { replayCard } from '../domain/recompute';
import { addAnswerToDay, buildDailyActivity, type CardHistory, emptyDay } from '../domain/streak';
import type { Card, DailyActivity, Millis } from '../domain/types';
import { db } from './db';
import { dueStudiedCards, groupLogs, loadTodayFacts, logsByCard } from './history';
import { dayConfig, getSettings, schedulerFor } from './settings';

/** Live check used on the current day: nothing studied is left due before the day ends. */
export async function isTodayComplete(cfg: DayConfig, now: Millis): Promise<boolean> {
  const facts = await loadTodayFacts(cfg, now);
  const due = await dueStudiedCards(facts.bounds.end);
  return isDayComplete(due, {
    dayEnd: facts.bounds.end,
    reviewedTodayCardIds: facts.reviewedCardIds,
    reviewedTodayNoteIds: facts.reviewedNoteIds,
  });
}

/**
 * Recount one day from the logs (call inside a transaction covering cards, review_logs,
 * daily_activity). `completed` is re-checked live for today and kept for past days.
 */
export async function refreshDay(key: DayKey, cfg: DayConfig, scheduler: Scheduler, now: Millis): Promise<DailyActivity | null> {
  const start = dayStartMs(key, cfg);
  const end = dayEndMs(key, cfg);
  const dayLogs = await db.review_logs.where('reviewed_at').between(start, end, true, false).toArray();
  const cardIds = new Set(dayLogs.map((l) => l.card_id));
  const logs = await logsByCard(cardIds);
  const cards = await db.cards.bulkGet([...cardIds]);
  const row = emptyDay(key);
  for (const card of cards) {
    if (!card) continue;
    for (const s of replayCard(scheduler, card, logs.get(card.id) ?? []).steps) {
      if (s.log.reviewed_at >= start && s.log.reviewed_at < end) {
        addAnswerToDay(row, { before_state: s.before.state, rating: s.log.rating, duration_ms: s.log.duration_ms });
      }
    }
  }
  if (row.reviews === 0) {
    await db.daily_activity.delete(key);
    return null;
  }
  const isToday = now >= start && now < end;
  row.completed = isToday ? await isTodayComplete(cfg, now) : ((await db.daily_activity.get(key))?.completed ?? false);
  await db.daily_activity.put(row);
  return row;
}

/** Histories of every card, for full rebuilds. */
export async function loadAllHistories(scheduler: Scheduler): Promise<{ cards: Card[]; histories: CardHistory[] }> {
  const cards = await db.cards.toArray();
  const byCard = groupLogs(await db.review_logs.toArray());
  const histories = cards.map((card) => ({ card, steps: replayCard(scheduler, card, byCard.get(card.id) ?? []).steps }));
  return { cards, histories };
}

/** Throw away the cache and rebuild it from review_logs. */
export async function rebuildDailyActivity(now: Millis = Date.now()): Promise<DailyActivity[]> {
  return db.transaction('rw', [db.cards, db.review_logs, db.settings, db.daily_activity], async () => {
    const settings = await getSettings(now);
    const { histories } = await loadAllHistories(schedulerFor(settings));
    const rows = buildDailyActivity(histories, dayConfig(settings));
    await db.daily_activity.clear();
    await db.daily_activity.bulkPut(rows);
    return rows;
  });
}

export function listDailyActivity(): Promise<DailyActivity[]> {
  return db.daily_activity.orderBy('date').toArray();
}
