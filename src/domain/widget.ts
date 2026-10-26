// Home-screen widget of the Android app (docs/decisions/0048-widget-notification-answers.md). Pure.
//
// The web app computes everything the widget shows and writes it as one JSON value
// (`widget_state` in @capacitor/preferences, SharedPreferences group "CapacitorStorage"); the
// widget (Jetpack Glance, android/app/src/main/java/.../widget) only reads it. So the widget
// works offline and never needs the database. To stay correct while the app is closed
// (criterion 9: the due count at most 30 minutes late) the state also carries the next day: the
// widget switches to `next` by itself once `day_end` has passed (it re-reads every 30 minutes).
import { senseMeaning } from './backup';
import type { DayKey } from './day';
import type { WordStage } from './stages';
import type { Id, Millis, Sense } from './types';

export const WIDGET_STATE_KEY = 'widget_state';
export const WIDGET_STATE_VERSION = 1;
/** Meaning shown on the widget: at most this many senses, then cut to MAX_TR chars. */
const MAX_SENSES = 2;
const MAX_TR = 80;
const MAX_EN = 60;

export interface WidgetWord {
  /** Turkish meaning: shown first (the cue). */
  tr: string;
  /** English term: shown after a tap. */
  en: string;
  note_id: Id;
}

export interface WidgetDay {
  day: DayKey;
  /** Learning steps and reviews of "Kelime çalışma" due that day. */
  due: number;
  /** First-time words the daily limit allows that day. */
  new_count: number;
  /** End of that user day (day_start_hour local time of the next calendar day). */
  day_end: Millis;
  word: WidgetWord | null;
}

export interface WidgetState extends WidgetDay {
  v: typeof WIDGET_STATE_VERSION;
  /** The next user day, so a closed app still shows the right count after midnight. */
  next: WidgetDay | null;
  updated_at: Millis;
}

/** A word that may be the word of the day. */
export interface WordCandidate {
  note_id: Id;
  term: string;
  stage: WordStage;
  senses: readonly Pick<Sense, 'sense_no' | 'meaning_tr' | 'meaning_tr_override'>[];
}

/** Only words being learned: new words are not known yet, learned ones need no cue. */
export const WORD_OF_DAY_STAGES: readonly WordStage[] = ['learning', 'consolidating'];

/** 32-bit FNV-1a: small, stable across engines, good enough to spread days over words. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The word of the day: the candidate with the highest hash of (day, note id) among the words
 * being learned (rendezvous hashing). Deterministic per day and stable when other words are
 * added or leave the set. `keep` (the word already shown today) wins while it still exists, so
 * the word does not change mid-day when it moves to Öğrenildi.
 */
export function pickWordOfDay<T extends WordCandidate>(
  candidates: readonly T[],
  day: DayKey,
  keep: { day: DayKey; note_id: Id } | null = null,
): T | null {
  if (keep && keep.day === day) {
    const kept = candidates.find((c) => c.note_id === keep.note_id);
    if (kept) return kept;
  }
  let best: T | null = null;
  let bestHash = -1;
  for (const c of candidates) {
    if (!WORD_OF_DAY_STAGES.includes(c.stage)) continue;
    if (!c.term.trim() || !meaningOf(c.senses)) continue;
    const h = fnv1a(`${day}|${c.note_id}`);
    if (h > bestHash || (h === bestHash && best !== null && c.note_id < best.note_id)) {
      best = c;
      bestHash = h;
    }
  }
  return best;
}

function cut(s: string, max: number): string {
  const chars = [...s.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** "banka; kıyı": the first senses in order, the user's correction winning. */
export function meaningOf(senses: WordCandidate['senses']): string {
  const parts: string[] = [];
  for (const s of [...senses].sort((a, b) => a.sense_no - b.sense_no)) {
    const m = senseMeaning(s).trim();
    if (m && !parts.includes(m)) parts.push(m);
    if (parts.length === MAX_SENSES) break;
  }
  return cut(parts.join('; '), MAX_TR);
}

export function widgetWord(c: WordCandidate | null): WidgetWord | null {
  if (!c) return null;
  const tr = meaningOf(c.senses);
  if (!tr) return null;
  return { tr, en: cut(c.term, MAX_EN), note_id: c.note_id };
}

export interface WidgetStateInput {
  today: Omit<WidgetDay, 'word'>;
  tomorrow: Omit<WidgetDay, 'word'> | null;
  candidates: readonly WordCandidate[];
  /** The state written before (to keep today's word). */
  previous: WidgetState | null;
  now: Millis;
}

/** The JSON the widget reads. */
export function buildWidgetState(input: WidgetStateInput): WidgetState {
  const keep = input.previous?.word
    ? { day: input.previous.day, note_id: input.previous.word.note_id }
    : null;
  const word = widgetWord(pickWordOfDay(input.candidates, input.today.day, keep));
  const count = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return {
    v: WIDGET_STATE_VERSION,
    day: input.today.day,
    due: count(input.today.due),
    new_count: count(input.today.new_count),
    day_end: input.today.day_end,
    word,
    next: input.tomorrow
      ? {
          day: input.tomorrow.day,
          due: count(input.tomorrow.due),
          new_count: count(input.tomorrow.new_count),
          day_end: input.tomorrow.day_end,
          word: widgetWord(pickWordOfDay(input.candidates, input.tomorrow.day)),
        }
      : null,
    updated_at: input.now,
  };
}

/** Reads a stored state back; null for anything that is not a state this version wrote. */
export function parseWidgetState(raw: string | null | undefined): WidgetState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WidgetState> | null;
    if (!v || v.v !== WIDGET_STATE_VERSION || typeof v.day !== 'string') return null;
    return v as WidgetState;
  } catch {
    return null;
  }
}

/** Same content apart from the write time: no need to write or redraw. */
export function sameWidgetContent(a: WidgetState | null, b: WidgetState): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, updated_at: 0 }) === JSON.stringify({ ...b, updated_at: 0 });
}
