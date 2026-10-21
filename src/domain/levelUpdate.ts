// The user's level after the test: evidence from studying, and the weekly update
// (v0.2 İP3, plan Ek A.5 "Weekly update", docs/decisions/0017-level-test.md). Pure.
//
// Per level b the model keeps a share of known words:
//   ratio_b = (w·prior_b + known_b) / (w + known_b + unknown_b)
// prior: the last level test's ratio (w = 20); without a test 0.9 for levels up to the
// current one and 0.3 above (w = 10). Evidence since the prior, each word counted once in
// its own level:
//   known   (+1)   the first answer on the word's recognition card was "Kolay", or its first
//                  three answers had no "Tekrar" (the card was learned without a lapse);
//                  a word marked "Biliyorum" in a preview or by hand (known_terms)
//   unknown (+1)   two or more "Tekrar" within the first three answers
//   practice (0.5) the last practice answer on the word, either way, when nothing above applies
//
// Weekly update (first app open after the week starts: Monday at day_start_hour): one level
// up when the next level's ratio is ≥ 0.80 at this week's start AND at last week's; one
// down when the own level's ratio is < 0.60 at both. At most one step per week, never while
// the level is locked, and both instants must come after the last change of the level.
import { addDays, type DayConfig, dayKeyOf, dayStartMs, weekdayMon0 } from './day';
import { effectiveLogs } from './recompute';
import { type CefrLevel, type Id, type LevelSourceKind, type Millis, Rating, type ReviewLog } from './types';
import { LEVELS, levelIndex } from './levelTest';

export const PRIOR_WEIGHT_TEST = 20;
export const PRIOR_WEIGHT_DEFAULT = 10;
export const DEFAULT_PRIOR_KNOWN = 0.9;
export const DEFAULT_PRIOR_ABOVE = 0.3;
export const UP_RATIO = 0.8;
export const DOWN_RATIO = 0.6;
export const PRACTICE_WEIGHT = 0.5;

export interface BandPrior {
  ratio: number;
  weight: number;
}

/** What the model starts from: a level test's ratios, or the default for the current level. */
export function priorFor(
  test: { ratios: Partial<Record<CefrLevel, number>>; tested?: readonly CefrLevel[] } | null,
  level: CefrLevel,
): Record<CefrLevel, BandPrior> {
  const out = {} as Record<CefrLevel, BandPrior>;
  for (const b of LEVELS) {
    const fromTest = test?.ratios[b];
    if (test && typeof fromTest === 'number') {
      // Levels the test only inferred (not shown) weigh as much as the default.
      const shown = !test.tested || test.tested.includes(b);
      out[b] = { ratio: fromTest, weight: shown ? PRIOR_WEIGHT_TEST : PRIOR_WEIGHT_DEFAULT };
    } else {
      out[b] = {
        ratio: levelIndex(b) <= levelIndex(level) ? DEFAULT_PRIOR_KNOWN : DEFAULT_PRIOR_ABOVE,
        weight: PRIOR_WEIGHT_DEFAULT,
      };
    }
  }
  return out;
}

// ------------------------------------------------------------------ evidence

export interface EvidenceItem {
  /** Note id or known-term key: one item per word. */
  key: string;
  band: CefrLevel;
  known: number;
  unknown: number;
  at: Millis;
  kind: 'easy_first' | 'learned' | 'lapses' | 'marked' | 'practice';
}

export interface EvidenceNote {
  id: Id;
  term_norm: string;
  /** The word's level (resolved, or the user's own); null = unknown, ignored. */
  band: CefrLevel | null;
  /** Logs of the note's recognition card (undo rows included; they are applied here). */
  logs: readonly ReviewLog[];
  /** The note's practice answers, any card. */
  practice: readonly { practiced_at: Millis; result: 'known' | 'unknown' }[];
}

export interface EvidenceKnownTerm {
  term_norm: string;
  source: string;
  created_at: Millis;
  band: CefrLevel | null;
}

/** Card-based evidence of one note, with the moment it became true; null = none yet. */
export function cardEvidence(logs: readonly ReviewLog[]): Pick<EvidenceItem, 'known' | 'unknown' | 'at' | 'kind'> | null {
  const eff = effectiveLogs(logs);
  if (!eff.length) return null;
  const first3 = eff.slice(0, 3);
  const agains = first3.filter((l) => l.rating === Rating.Again);
  if (agains.length >= 2) return { known: 0, unknown: 1, at: agains[1]!.reviewed_at, kind: 'lapses' };
  if (eff[0]!.rating === Rating.Easy) return { known: 1, unknown: 0, at: eff[0]!.reviewed_at, kind: 'easy_first' };
  if (first3.length === 3 && agains.length === 0) return { known: 1, unknown: 0, at: first3[2]!.reviewed_at, kind: 'learned' };
  return null;
}

/**
 * Evidence that existed at `until` and arrived after `since` (the prior's time). Each word
 * counts once: card evidence first, then a "Biliyorum" mark, then the last practice answer.
 * Known terms from the level test itself are already in the prior and do not count.
 */
export function collectEvidence(
  notes: readonly EvidenceNote[],
  knownTerms: readonly EvidenceKnownTerm[],
  since: Millis,
  until: Millis,
): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const counted = new Set<string>();
  for (const n of notes) {
    if (!n.band) continue;
    const logs = n.logs.filter((l) => l.reviewed_at <= until);
    const card = cardEvidence(logs);
    if (card && card.at <= until) {
      counted.add(n.term_norm);
      if (card.at > since) out.push({ key: n.id, band: n.band, ...card });
      continue;
    }
    const last = [...n.practice].filter((p) => p.practiced_at <= until).sort((a, b) => b.practiced_at - a.practiced_at)[0];
    if (last && last.practiced_at > since) {
      counted.add(n.term_norm);
      const known = last.result === 'known';
      out.push({
        key: n.id,
        band: n.band,
        known: known ? PRACTICE_WEIGHT : 0,
        unknown: known ? 0 : PRACTICE_WEIGHT,
        at: last.practiced_at,
        kind: 'practice',
      });
    }
  }
  for (const k of knownTerms) {
    if (!k.band || k.source === 'test' || k.source === 'auto') continue;
    if (k.created_at <= since || k.created_at > until || counted.has(k.term_norm)) continue;
    counted.add(k.term_norm);
    out.push({ key: `known:${k.term_norm}`, band: k.band, known: 1, unknown: 0, at: k.created_at, kind: 'marked' });
  }
  return out;
}

export interface BandEstimate {
  ratio: number;
  known: number;
  unknown: number;
  prior: number;
}

export function bandRatios(prior: Record<CefrLevel, BandPrior>, evidence: readonly EvidenceItem[]): Record<CefrLevel, BandEstimate> {
  const out = {} as Record<CefrLevel, BandEstimate>;
  for (const b of LEVELS) {
    let known = 0;
    let unknown = 0;
    for (const e of evidence) {
      if (e.band !== b) continue;
      known += e.known;
      unknown += e.unknown;
    }
    const p = prior[b];
    out[b] = { ratio: (p.weight * p.ratio + known) / (p.weight + known + unknown), known, unknown, prior: p.ratio };
  }
  return out;
}

// ------------------------------------------------------------------ the model at a moment

export interface LevelTestRecord {
  taken_at: Millis;
  ratios: Partial<Record<CefrLevel, number>>;
  tested?: readonly CefrLevel[];
  /** Only reliable tests that were applied count as a prior. */
  reliable: boolean;
}

export interface ModelInput {
  level: CefrLevel;
  tests: readonly LevelTestRecord[];
  notes: readonly EvidenceNote[];
  knownTerms: readonly EvidenceKnownTerm[];
}

/** The latest reliable test taken at or before `at`. */
export function lastTestAt(tests: readonly LevelTestRecord[], at: Millis): LevelTestRecord | null {
  let best: LevelTestRecord | null = null;
  for (const t of tests) if (t.reliable && t.taken_at <= at && (!best || t.taken_at > best.taken_at)) best = t;
  return best;
}

/** Ratios per level as they stood at `at`. */
export function ratiosAt(input: ModelInput, at: Millis): Record<CefrLevel, BandEstimate> {
  const test = lastTestAt(input.tests, at);
  const evidence = collectEvidence(input.notes, input.knownTerms, test?.taken_at ?? -Infinity, at);
  return bandRatios(priorFor(test, input.level), evidence);
}

// ------------------------------------------------------------------ weekly update

/** Start of the local week containing `ms`: Monday at day_start_hour. */
export function weekStartMs(ms: Millis, cfg: DayConfig): Millis {
  const key = dayKeyOf(ms, cfg);
  return dayStartMs(addDays(key, -weekdayMon0(key)), cfg);
}

export interface LevelChange {
  from: CefrLevel;
  to: CefrLevel;
  /** The week start the decision was made for. */
  week: Millis;
  /** The level whose ratio decided: the next level (up) or the own level (down). */
  band: CefrLevel;
  ratio: number;
  ratio_prev: number;
  known: number;
  unknown: number;
}

export type WeeklyOutcome =
  | { status: 'locked' | 'too_soon' }
  | { status: 'kept'; week: Millis }
  | { status: 'changed'; week: Millis; change: LevelChange };

export interface WeeklyInput extends ModelInput {
  locked: boolean;
  source: LevelSourceKind;
  updatedAt: Millis | null;
  now: Millis;
  cfg: DayConfig;
}

export function weeklyLevelUpdate(input: WeeklyInput): WeeklyOutcome {
  if (input.locked) return { status: 'locked' };
  const t1 = weekStartMs(input.now, input.cfg);
  const t0 = weekStartMs(t1 - 1, input.cfg);
  if (input.updatedAt !== null && input.source !== 'default') {
    // A change made by the weekly update counts from its week; a test or a manual choice
    // from its moment. Both instants must come after it.
    const since = input.source === 'auto' ? weekStartMs(input.updatedAt, input.cfg) : input.updatedAt;
    if (since > t0) return { status: 'too_soon' };
  }
  const L = levelIndex(input.level);
  const now = ratiosAt(input, t1);
  const prev = ratiosAt(input, t0);
  const up = LEVELS[L + 1];
  if (up && now[up].ratio >= UP_RATIO && prev[up].ratio >= UP_RATIO) {
    return {
      status: 'changed',
      week: t1,
      change: { from: input.level, to: up, week: t1, band: up, ratio: now[up].ratio, ratio_prev: prev[up].ratio, known: now[up].known, unknown: now[up].unknown },
    };
  }
  const down = LEVELS[L - 1];
  const own = input.level;
  if (down && now[own].ratio < DOWN_RATIO && prev[own].ratio < DOWN_RATIO) {
    return {
      status: 'changed',
      week: t1,
      change: { from: own, to: down, week: t1, band: own, ratio: now[own].ratio, ratio_prev: prev[own].ratio, known: now[own].known, unknown: now[own].unknown },
    };
  }
  return { status: 'kept', week: t1 };
}
