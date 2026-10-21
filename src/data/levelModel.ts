// The user's level, data side (v0.2 İP3 + the İP8 counter): saving level tests, the weekly
// update, the vocabulary counter and the level settings. Rules live in domain/levelTest.ts,
// domain/levelUpdate.ts and domain/vocabSize.ts; this module only reads and writes Dexie.
import bandSizesJson from '../../data/level-test/band-sizes.json';
import { type DayConfig } from '../domain/day';
import { type LevelData, noteLevel } from '../domain/level';
import { LEVELS } from '../domain/levelTest';
import {
  type BandEstimate,
  type EvidenceKnownTerm,
  type EvidenceNote,
  type LevelTestRecord,
  type ModelInput,
  ratiosAt,
  weeklyLevelUpdate,
  type WeeklyOutcome,
  weekStartMs,
} from '../domain/levelUpdate';
import { type VocabSize, vocabSize } from '../domain/vocabSize';
import {
  CardState,
  type CefrLevel,
  type Id,
  type LevelTest,
  type LevelTestItem,
  type Millis,
  type PracticeLog,
  type ReviewLog,
  type Settings,
} from '../domain/types';
import { db } from './db';
import { markKnownIn } from './knownTerms';
import { levelDataNow, loadLevelData } from './levelData';
import { getCurrentUserId, getMeta, setMeta } from './meta';
import { dayConfig, defaultSettings, getSettings, SETTINGS_ID } from './settings';
import { writeTx } from './writer';

/** Lemmas per level in the word list (data/level-test/band-sizes.json, built with the bank). */
export const BAND_SIZES = bandSizesJson as Record<CefrLevel, number>;

const MAX_TEST_DURATION_MS = 60 * 60_000;

async function levelDataOrNull(): Promise<LevelData | null> {
  try {
    return levelDataNow() ?? (await loadLevelData());
  } catch {
    // Offline before the file was ever loaded: levels stored with the lexicon still count.
    return null;
  }
}

const tested = (items: readonly LevelTestItem[]): CefrLevel[] =>
  LEVELS.filter((b) => items.some((i) => !i.pseudo && i.band === b));

export const testRecord = (t: LevelTest): LevelTestRecord => ({
  taken_at: t.taken_at,
  ratios: t.ratios,
  tested: tested(t.items),
  reliable: t.reliable,
});

interface LoadedModel {
  settings: Settings;
  input: ModelInput;
  /** Words outside the word list that the user learned (card in Review) or marked known. */
  outside: number;
  tests: LevelTest[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Everything the level model needs, read in one transaction. */
async function loadModel(now: Millis): Promise<LoadedModel> {
  const data = await levelDataOrNull();
  return db.transaction(
    'r',
    [
      db.settings,
      db.notes,
      db.senses,
      db.cards,
      db.review_logs,
      db.practice_logs,
      db.known_terms,
      db.level_tests,
      db.lexicon_cache,
    ],
    async () => {
      const settings = await getSettings(now);
      const [notes, senses, cards, tests, known] = await Promise.all([
        db.notes.filter((n) => n.deleted_at === null).toArray(),
        db.senses.filter((s) => s.deleted_at === null).toArray(),
        db.cards.filter((c) => c.deleted_at === null).toArray(),
        db.level_tests.toArray(),
        db.known_terms.filter((k) => k.deleted_at === null).toArray(),
      ]);
      const lexIds = [
        ...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x)),
      ];
      const lex = new Map(
        (await db.lexicon_cache.bulkGet(lexIds)).filter((x) => !!x).map((x) => [x!.id, x!]),
      );
      const sensesByNote = new Map<Id, typeof senses>();
      for (const s of senses) push(sensesByNote, s.note_id, s);
      const recognition = new Map<Id, (typeof cards)[number]>();
      const noteOfCard = new Map<Id, Id>();
      for (const c of cards) {
        noteOfCard.set(c.id, c.note_id);
        if (c.card_type === 'recognition') recognition.set(c.note_id, c);
      }
      const recIds = [...recognition.values()].map((c) => c.id);
      const logs = recIds.length
        ? await db.review_logs.where('card_id').anyOf(recIds).toArray()
        : [];
      const logsByCard = new Map<Id, ReviewLog[]>();
      for (const l of logs) push(logsByCard, l.card_id, l);
      const practiceByNote = new Map<Id, PracticeLog[]>();
      for (const p of await db.practice_logs.toArray()) {
        const noteId = noteOfCard.get(p.card_id);
        if (noteId) push(practiceByNote, noteId, p);
      }

      const inList = (term: string) => !!data?.lookup(term)?.refs.length;
      let outside = 0;
      const noteTerms = new Set<string>();
      const evidenceNotes: EvidenceNote[] = notes.map((n) => {
        noteTerms.add(n.term_norm);
        const rec = recognition.get(n.id);
        const own = (sensesByNote.get(n.id) ?? []).sort((a, b) => a.sense_no - b.sense_no);
        const level = noteLevel(n, own, (id) => lex.get(id), data);
        if (
          data &&
          !inList(n.term_norm) &&
          rec &&
          (rec.state === CardState.Review || rec.state === CardState.Relearning)
        )
          outside++;
        return {
          id: n.id,
          term_norm: n.term_norm,
          band: level?.cefr ?? null,
          logs: rec ? (logsByCard.get(rec.id) ?? []) : [],
          practice: practiceByNote.get(n.id) ?? [],
        };
      });
      const knownTerms: EvidenceKnownTerm[] = [];
      const seenKnown = new Set<string>();
      for (const k of known) {
        if (seenKnown.has(k.term_norm)) continue;
        seenKnown.add(k.term_norm);
        let band = k.cefr_at_mark;
        if (!band && data) {
          const type = k.term_norm.includes(' ') ? 'phrase' : 'word';
          band =
            noteLevel(
              { term_norm: k.term_norm, term_type: type, level_override: null },
              [],
              () => undefined,
              data,
            )?.cefr ?? null;
        }
        if (data && !inList(k.term_norm) && !noteTerms.has(k.term_norm)) outside++;
        knownTerms.push({
          term_norm: k.term_norm,
          source: k.source,
          created_at: k.created_at,
          band,
        });
      }
      return {
        settings,
        input: {
          level: settings.level,
          tests: tests.map(testRecord),
          notes: evidenceNotes,
          knownTerms,
        },
        outside,
        tests: tests.sort((a, b) => b.taken_at - a.taken_at),
      };
    },
  );
}

// ------------------------------------------------------------------ overview (home, stats, settings)

export interface LevelOverview {
  level: CefrLevel;
  source: Settings['level_source'];
  locked: boolean;
  updatedAt: Millis | null;
  change: Settings['level_change'];
  /** Latest test (reliable or not). */
  lastTest: LevelTest | null;
  testCount: number;
  /** A level test or a level chosen by hand: the counter has a real starting point. */
  hasBasis: boolean;
  ratios: Record<CefrLevel, BandEstimate>;
  vocab: VocabSize;
}

export async function getLevelOverview(now: Millis = Date.now()): Promise<LevelOverview> {
  const m = await loadModel(now);
  const ratios = ratiosAt(m.input, now);
  const flat = Object.fromEntries(LEVELS.map((b) => [b, ratios[b].ratio])) as Record<
    CefrLevel,
    number
  >;
  return {
    level: m.settings.level,
    source: m.settings.level_source,
    locked: m.settings.level_locked,
    updatedAt: m.settings.level_updated_at,
    change: m.settings.level_change,
    lastTest: m.tests[0] ?? null,
    testCount: m.tests.length,
    hasBasis: m.tests.some((t) => t.reliable) || m.settings.level_source !== 'default',
    ratios,
    vocab: vocabSize(m.settings.level, flat, BAND_SIZES, m.outside),
  };
}

/** Learned or known words outside the list (added to a test's vocabulary estimate). */
export async function countOutsideWords(now: Millis = Date.now()): Promise<number> {
  return (await loadModel(now)).outside;
}

// ------------------------------------------------------------------ level tests

export interface SaveLevelTestInput {
  items: LevelTestItem[];
  level: CefrLevel;
  ratios: Record<CefrLevel, number>;
  reliable: boolean;
  falseAlarm: number;
  vocabEstimate: number;
  bankVersion: string;
  durationMs: number;
}

/**
 * Store a finished test (insert-only). A reliable result becomes the user's level (source
 * 'test'; a lock only stops the weekly update, a test the user took is applied anyway) and its
 * "Biliyorum" words that were not caught by a meaning question become known terms (source
 * 'test'). An unreliable result changes nothing but is kept in the history.
 */
export async function saveLevelTest(
  input: SaveLevelTestInput,
  now: Millis = Date.now(),
): Promise<LevelTest> {
  return writeTx([db.level_tests, db.settings, db.known_terms, db.notes], now, async (w) => {
    const test: LevelTest = {
      id: w.newId(),
      user_id: w.userId,
      taken_at: now,
      result_level: input.level,
      vocab_estimate: Math.max(0, Math.round(input.vocabEstimate)),
      reliable: input.reliable,
      false_alarm_rate: Math.max(0, Math.min(1, input.falseAlarm)),
      ratios: input.ratios,
      items: input.items,
      bank_version: input.bankVersion,
      applied: input.reliable,
      duration_ms: Math.max(0, Math.min(MAX_TEST_DURATION_MS, Math.round(input.durationMs))),
      device_id: w.deviceId,
      created_at: now,
      hlc: w.nextHlc(),
    };
    await w.insertLevelTest(test);
    if (!input.reliable) return test;
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    await w.put('settings', {
      ...current,
      level: input.level,
      level_source: 'test',
      level_updated_at: now,
      level_change: null,
    });
    const noteTerms = new Set(
      (await db.notes.toArray()).filter((n) => n.deleted_at === null).map((n) => n.term_norm),
    );
    for (const item of input.items) {
      if (item.pseudo || item.answer !== 'yes' || item.mc_ok === false) continue;
      if (noteTerms.has(item.w)) continue;
      await markKnownIn(w, item.w, 'test', item.band);
    }
    return test;
  });
}

/** "Sonucu yine de kullan": make an unreliable result the level anyway (not a prior). */
export async function applyTestLevel(
  level: CefrLevel,
  now: Millis = Date.now(),
): Promise<Settings> {
  return writeTx([db.settings], now, async (w) => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? defaultSettings(now, w.userId);
    return w.put('settings', {
      ...current,
      level,
      level_source: 'test',
      level_updated_at: now,
      level_change: null,
    });
  });
}

export async function listLevelTests(): Promise<LevelTest[]> {
  return (await db.level_tests.toArray()).sort((a, b) => b.taken_at - a.taken_at);
}

// ------------------------------------------------------------------ weekly update

const weekKey = async () => `level_week:${(await getCurrentUserId()) ?? 'guest'}`;

/**
 * Run the weekly update once per local week and device (first call after Monday's day start).
 * Returns null when this week was already looked at. The rule is deterministic over synced
 * data, so two devices reach the same decision; the settings row's level_updated_at stops a
 * second step in the same week.
 */
export async function runWeeklyLevelUpdate(
  now: Millis = Date.now(),
  force = false,
): Promise<WeeklyOutcome | null> {
  const settings = await getSettings(now);
  const cfg: DayConfig = dayConfig(settings);
  const week = weekStartMs(now, cfg);
  const key = await weekKey();
  if (!force && (await getMeta<number>(key)) === week) return null;
  const m = await loadModel(now);
  const outcome = weeklyLevelUpdate({
    ...m.input,
    locked: m.settings.level_locked,
    source: m.settings.level_source,
    updatedAt: m.settings.level_updated_at,
    now,
    cfg,
  });
  await writeTx([db.settings], now, async (w) => {
    if (outcome.status === 'changed') {
      const current = (await db.settings.get(SETTINGS_ID)) ?? m.settings;
      // Another device (or tab) may have changed the level meanwhile: then leave it.
      if (
        current.level === outcome.change.from &&
        current.level_updated_at === m.settings.level_updated_at
      ) {
        await w.put('settings', {
          ...current,
          level: outcome.change.to,
          level_source: 'auto',
          level_updated_at: now,
          level_change: { ...outcome.change, dismissed: false },
        });
      }
    }
    await setMeta(key, week);
  });
  return outcome;
}

/** Close the "Seviyen B1 → B2 oldu" note (synced, so it closes on every device). */
export async function dismissLevelChange(now: Millis = Date.now()): Promise<void> {
  await writeTx([db.settings], now, async (w) => {
    const current = await db.settings.get(SETTINGS_ID);
    if (!current?.level_change || current.level_change.dismissed) return;
    await w.put('settings', {
      ...current,
      level_change: { ...current.level_change, dismissed: true },
    });
  });
}

/** "Geri al": back to the level before the automatic change, chosen by hand. */
export async function undoLevelChange(now: Millis = Date.now()): Promise<void> {
  await writeTx([db.settings], now, async (w) => {
    const current = await db.settings.get(SETTINGS_ID);
    const change = current?.level_change;
    if (!current || !change || current.level !== change.to) return;
    await w.put('settings', {
      ...current,
      level: change.from,
      level_source: 'manual',
      level_updated_at: now,
      level_change: null,
    });
  });
}
