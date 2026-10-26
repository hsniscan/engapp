// Read-only view models for the redesigned home screen ("Bugün", boards Main / HomeDone).
// Each function feeds one section, so a change in one table re-runs only what depends on it.
import {
  db,
  getMoreStudyOverview,
  getReportNotice,
  getSettings,
  stageRuleNoticePending,
  type MoreStudyOverview,
} from '@/data';
import { STAGE_RULE_NOTICE_KEY } from '@/data/db';
import { logsByCard } from '@/data/history';
import { addDays, dayBounds, type DayKey } from '@/domain/day';
import { CEFR_ORDER } from '@/domain/deckFilter';
import { dayMinutesGoal, targetLevel } from '@/domain/goals';
import type { CardType, CefrLevel, LevelSourceKind, Millis } from '@/domain/types';
import { mondayOf } from '@/domain/weeklyReport';
import type { StudyMode } from '@/features/review/studyModes';
import { cfgOf } from './queries';
import { scanCount, scanWhere } from '@/data/scan';

// ------------------------------------------------------------------ the week and today

export interface WeekDot {
  date: DayKey;
  /** At least one answer that day. */
  active: boolean;
  today: boolean;
  future: boolean;
}

export interface TodayActivity {
  today: DayKey;
  /** Monday to Sunday of this week. */
  week: WeekDot[];
  /** Minutes studied today (all study types). */
  minutes: number;
  /** Minutes studied this week, Monday to today. */
  weekMinutes: number;
  /** Answers given today per study type, undone answers left out. */
  answers: Record<StudyMode, number>;
  /** Word study today: cards seen again, and new words met for the first time. */
  word: { reviewed: number; fresh: number };
}

const MODE_OF: Record<CardType, StudyMode> = {
  recognition: 'word',
  production: 'production',
  image: 'production',
  cloze: 'cloze',
  dictation: 'dictation',
};

/** Monday-to-Sunday dots of the week `today` falls in. */
export function weekDots(today: DayKey, activeDays: ReadonlySet<DayKey>): WeekDot[] {
  const monday = mondayOf(today);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, active: activeDays.has(date), today: date === today, future: date > today };
  });
}

export async function getTodayActivity(now: Millis = Date.now()): Promise<TodayActivity> {
  const settings = await getSettings(now);
  const cfg = cfgOf(settings);
  const bounds = dayBounds(now, cfg);
  const monday = mondayOf(bounds.key);
  const [days, logs] = await Promise.all([
    db.daily_activity.where('date').between(monday, addDays(monday, 6), true, true).toArray(),
    db.review_logs.where('reviewed_at').between(bounds.start, bounds.end, true, false).toArray(),
  ]);
  const active = new Set(days.filter((d) => d.reviews > 0).map((d) => d.date));
  const minutes = Math.round((days.find((d) => d.date === bounds.key)?.time_ms ?? 0) / 60_000);
  const weekMinutes = Math.round(days.reduce((a, d) => a + d.time_ms, 0) / 60_000);

  // An undo is a row of its own that cancels an earlier one (review_logs are insert-only).
  const undone = new Set(logs.flatMap((l) => (l.undo_of ? [l.undo_of] : [])));
  const kept = logs.filter((l) => !l.undo_of && !undone.has(l.id));
  const cardIds = [...new Set(kept.map((l) => l.card_id))];
  const cards = cardIds.length ? await db.cards.bulkGet(cardIds) : [];
  const typeOf = new Map(cards.flatMap((c) => (c ? [[c.id, c.card_type] as const] : [])));

  const answers: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
  const wordCards = new Set<string>();
  for (const l of kept) {
    const type = typeOf.get(l.card_id);
    if (!type) continue;
    answers[MODE_OF[type]]++;
    if (type === 'recognition') wordCards.add(l.card_id);
  }
  // A word card met before today is a review; one without earlier answers is a new word.
  const seenBefore = wordCards.size
    ? new Set(
        [...(await logsByCard(wordCards)).values()]
          .flat()
          .filter((l) => l.reviewed_at < bounds.start && !l.undo_of)
          .map((l) => l.card_id),
      )
    : new Set<string>();
  const reviewed = [...wordCards].filter((id) => seenBefore.has(id)).length;

  return {
    today: bounds.key,
    week: weekDots(bounds.key, active),
    minutes,
    weekMinutes,
    answers,
    word: { reviewed, fresh: wordCards.size - reviewed },
  };
}

// ------------------------------------------------------------------ goals and level

export interface HomeGoals {
  /** Today's minutes against the daily goal (null: no daily goal). */
  dayTarget: number | null;
  level: CefrLevel;
  levelSource: LevelSourceKind;
  target: CefrLevel;
  /** Hatırlama hedefi (FSRS request_retention). */
  retentionGoal: number;
}

/** Levels shown on the path: A1 up to the target (or the current level when it is higher). */
export function levelPath(level: CefrLevel, target: CefrLevel): CefrLevel[] {
  const last = Math.max(CEFR_ORDER.indexOf(level), CEFR_ORDER.indexOf(target));
  return CEFR_ORDER.slice(0, last + 1);
}

export async function getHomeGoals(now: Millis = Date.now()): Promise<HomeGoals> {
  const s = await getSettings(now);
  return {
    dayTarget: dayMinutesGoal(s.goals),
    level: s.level,
    levelSource: s.level_source,
    target: targetLevel(s.goals, s.level),
    retentionGoal: s.request_retention,
  };
}

// ------------------------------------------------------------------ words

/** Live words that count for "Öğrendiğin kelime" (affixes and contrast pairs left out). */
export function countWords(): Promise<number> {
  return scanCount(db.notes, (n) => n.deleted_at === null && n.term_type !== 'affix' && n.term_type !== 'contrast');
}

/**
 * The one-time note about the stricter "öğrenildi" rule (docs/plan "Öğrenme modeli" 6).
 * Device-local meta, armed by the Dexie v26 upgrade for devices that already had data; a fresh
 * install never needs it.
 */
export const STAGE_RULE_NOTE_KEY = STAGE_RULE_NOTICE_KEY;

export function stageRuleNoteVisible(): Promise<boolean> {
  return stageRuleNoticePending();
}

// ------------------------------------------------------------------ shortcuts

export interface Shortcuts {
  /** null when the overview could not be read (the home screen then leaves its parts out). */
  more: MoreStudyOverview | null;
  /** The latest weekly report, until it is opened or closed. */
  report: { week: DayKey; activeDays: number; newCards: number } | null;
}

/** The extra-study overview, or the error that kept it from being read. */
export type MoreOverviewResult =
  { ok: true; more: MoreStudyOverview } | { ok: false; error: unknown };

/**
 * getMoreStudyOverview for the home screen, in its own live query: it builds several queues
 * (and the practice counts) and can fail where today's word queue does not (seen offline with
 * picture cards: a PrematureCommitError). The home screen must never fall over because of it.
 */
export async function getMoreOverview(now: Millis = Date.now()): Promise<MoreOverviewResult> {
  try {
    return { ok: true, more: await getMoreStudyOverview(now) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** The latest weekly report for the "Kısa yollar" row, until it is opened. */
export async function getReportShortcut(now: Millis = Date.now()): Promise<Shortcuts['report']> {
  const notice = await getReportNotice(now);
  if (!notice) return null;
  const final = await db.weekly_reports.where('week').equals(notice.week).first();
  const summary = final?.summary ?? (await db.report_drafts.get(notice.week))?.report.summary;
  return {
    week: notice.week,
    activeDays: summary?.active_days ?? 0,
    newCards: summary?.new_cards ?? 0,
  };
}

// ------------------------------------------------------------------ decks for you

const CONTENT_POS = new Set(['noun', 'verb', 'adjective', 'adverb']);
/** Size of the "most common words" deck on the home screen. */
export const HOME_FREQ_SIZE = 500;

export interface HomeDeck {
  /** /decks/suggested/:key — "freq-500", "cefr-b1-verb". */
  key: string;
  kind: 'freq' | 'level';
  level?: CefrLevel;
  size: number | null;
  /** Words of the deck already in the collection or marked as known (null: bank not on device). */
  have: number | null;
}

/**
 * Two ready-made decks for this user: the most common words and their level's verbs. Counts
 * come from the word bank on this device; before it is downloaded the decks show no numbers.
 */
export async function getHomeDecks(now: Millis = Date.now()): Promise<HomeDeck[]> {
  const settings = await getSettings(now);
  const level = settings.level;
  const levelKey = `cefr-${level.toLowerCase()}-verb`;
  const bank = await db.word_bank.toArray();
  if (bank.length === 0)
    return [
      { key: `freq-${HOME_FREQ_SIZE}`, kind: 'freq', size: HOME_FREQ_SIZE, have: null },
      { key: levelKey, kind: 'level', level, size: null, have: null },
    ];

  const [notes, known] = await Promise.all([
    scanWhere(db.notes, (n) => n.deleted_at === null),
    scanWhere(db.known_terms, (k) => k.deleted_at === null),
  ]);
  const mine = new Set([...notes.map((n) => n.term_norm), ...known.map((k) => k.term_norm)]);

  const seen = new Set<string>();
  const frequent: string[] = [];
  for (const e of bank
    .filter((e) => CONTENT_POS.has(e.pos) && e.zipf !== null)
    .sort((a, b) => (b.zipf ?? 0) - (a.zipf ?? 0))) {
    if (seen.has(e.lemma_norm)) continue;
    seen.add(e.lemma_norm);
    frequent.push(e.lemma_norm);
    if (frequent.length === HOME_FREQ_SIZE) break;
  }
  const verbs = [
    ...new Set(bank.filter((e) => e.cefr === level && e.pos === 'verb').map((e) => e.lemma_norm)),
  ];
  const have = (words: string[]) => words.filter((w) => mine.has(w)).length;
  return [
    {
      key: `freq-${HOME_FREQ_SIZE}`,
      kind: 'freq',
      size: frequent.length,
      have: have(frequent),
    },
    { key: levelKey, kind: 'level', level, size: verbs.length, have: have(verbs) },
  ];
}
