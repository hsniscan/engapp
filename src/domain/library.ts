// The graded reading library on the device (v0.5 İP5, decision 0047). Pure: no React, Dexie or
// network. The catalogue (metadata of every approved text, with its lemma profile) is pulled
// into Dexie `graded_catalog`; a text's sentences are fetched when it is first opened and kept
// in `graded_bodies`, so it reads offline after that.
//
// Suggestions ("Sana uygun"): every text's lemma profile is measured against what the user
// knows (coverage.ts measureCoverage, the reader's knowledge model) and placed against the
// chosen reading difficulty (bandFit). Only texts inside the band are suggested; when none
// is, the closest easier ones are (never a harder one, never one over the 10 % cap).
import { bandFit, measureCoverage } from './coverage';
import { DIFFICULTY_BANDS, type ReadingDifficulty } from './texts';

export interface GradedCatalogEntry {
  id: string;
  level: string;
  topic: string;
  title: string;
  /** Running words. */
  words: number;
  /** Counted tokens of the lemma profile. */
  tokens: number;
  /** Share of tokens at or below the text's level (word lists). */
  cov_level: number;
  /** Running-word counts per lemma. */
  lemma_profile: Record<string, number>;
  target_lemmas: string[];
  server_seq: number;
}

export interface GradedSentenceRow {
  en: string;
  tr: string;
  /** en-US clip in the public `tts` bucket (tts-contract.ts), null when there is none. */
  audio_key: string | null;
  /** Paragraph index. */
  p: number;
}

/** A text's body as cached on the device. */
export interface GradedBody {
  id: string;
  title: string;
  sentences: GradedSentenceRow[];
  glosses: { word: string; tr: string }[];
  fetched_at: number;
}

export interface ScoredGradedText {
  entry: GradedCatalogEntry;
  /** Expected share of unknown running words for this user. */
  unknownRate: number;
  /** -1 easier than the band, 0 inside it, 1 harder (or over the cap). */
  fit: -1 | 0 | 1;
  /** The topic matches one of the user's interests. */
  interest: boolean;
}

export interface ScoreOptions {
  pKnown: (lemma: string) => number;
  difficulty: ReadingDifficulty;
  /** Profile interests (settings.interests). */
  interests?: ReadonlySet<string>;
  /** Library topic → the profile interests it suits (graded-contract.ts topicInterests). */
  topicInterests?: (topic: string) => readonly string[];
}

export function scoreGradedText(entry: GradedCatalogEntry, opts: ScoreOptions): ScoredGradedText {
  const counts = new Map(Object.entries(entry.lemma_profile));
  const { unknownRate } = measureCoverage(counts, opts.pKnown);
  const interest =
    !!opts.interests &&
    opts.interests.size > 0 &&
    (opts.topicInterests?.(entry.topic) ?? [entry.topic]).some((t) => opts.interests!.has(t));
  return { entry, unknownRate, fit: bandFit(unknownRate, opts.difficulty), interest };
}

const bandCentre = (d: ReadingDifficulty) => (DIFFICULTY_BANDS[d].min + DIFFICULTY_BANDS[d].max) / 2;

/**
 * Best first: inside the band; the user's interests first; then nearest the band's centre; a
 * text the user already finished last; then title (stable).
 */
export function compareSuggestions(
  difficulty: ReadingDifficulty,
  finished: ReadonlySet<string> = new Set(),
): (a: ScoredGradedText, b: ScoredGradedText) => number {
  const c = bandCentre(difficulty);
  return (a, b) =>
    Number(finished.has(a.entry.id)) - Number(finished.has(b.entry.id)) ||
    Number(b.interest) - Number(a.interest) ||
    Math.abs(a.unknownRate - c) - Math.abs(b.unknownRate - c) ||
    a.entry.title.localeCompare(b.entry.title, 'en') ||
    a.entry.id.localeCompare(b.entry.id);
}

/**
 * The suggestions: texts inside the band, best first. When no text is inside the band, the
 * easier texts closest to it; a text harder than the band is never suggested.
 */
export function suggestTexts(
  scored: readonly ScoredGradedText[],
  difficulty: ReadingDifficulty,
  limit: number,
  finished: ReadonlySet<string> = new Set(),
): ScoredGradedText[] {
  if (limit <= 0) return [];
  const inBand = scored.filter((s) => s.fit === 0).sort(compareSuggestions(difficulty, finished));
  if (inBand.length > 0) return inBand.slice(0, limit);
  return scored
    .filter((s) => s.fit === -1)
    .sort(
      (a, b) =>
        Number(finished.has(a.entry.id)) - Number(finished.has(b.entry.id)) ||
        b.unknownRate - a.unknownRate ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .slice(0, limit);
}

export interface LibraryFilter {
  level: string | null;
  topic: string | null;
}

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** The list under the suggestions: filtered, by level, then easiest for this user first. */
export function filterLibrary(scored: readonly ScoredGradedText[], f: LibraryFilter): ScoredGradedText[] {
  return scored
    .filter((s) => (f.level === null || s.entry.level === f.level) && (f.topic === null || s.entry.topic === f.topic))
    .sort(
      (a, b) =>
        LEVEL_ORDER.indexOf(a.entry.level) - LEVEL_ORDER.indexOf(b.entry.level) ||
        a.unknownRate - b.unknownRate ||
        a.entry.title.localeCompare(b.entry.title, 'en') ||
        a.entry.id.localeCompare(b.entry.id),
    );
}

/** Share of running words the user is expected to understand, as a whole percent (floored). */
export function understoodPercent(unknownRate: number): number {
  return Math.max(0, Math.min(100, Math.floor((1 - unknownRate) * 100 + 1e-9)));
}

/** Estimated reading minutes (about 120 words a minute for a learner; at least 1). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 120));
}
