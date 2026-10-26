// What the user knows, per lemma (v0.5 contract, decision 0043). The rules are in
// domain/knowledgeModel.ts; this module gathers their inputs on the device: the stage of every
// word (domain/wordStages.ts), "Biliyorum" words, the weekly level model's share per band and
// the client level file (word lists + wordfreq). Nothing here needs the network once the level
// file is cached; without it the model falls back to a neutral estimate.
//
// loadKnowledge() is the contract the graded library (İP5) and the daily story (İP8) use;
// loadReaderKnowledge() adds what the reader needs to colour a text and count encounters.
import { buildKnowledge, type Knowledge, type KnowledgeModel } from '../domain/knowledgeModel';
import { LEVELS } from '../domain/levelTest';
import { priorFor } from '../domain/levelUpdate';
import type { WordStage } from '../domain/stages';
import type { CefrLevel, Id, Millis } from '../domain/types';
import { wordStagesByNote } from '../domain/wordStages';
import { db } from './db';
import { levelDataNow, loadLevelData } from './levelData';
import { getLevelOverview } from './levelModel';
import { getSettings } from './settings';

export type { Knowledge, KnowledgeModel };

export interface ReaderKnowledge extends KnowledgeModel {
  /** The user's live note for a term_norm (a word or a phrase), or null. */
  noteIdOf(term: string): Id | null;
  /** term_norm of every live counted note (the reader looks for the multi-word ones). */
  noteTerms: string[];
}

interface BandCache {
  key: string;
  at: Millis;
  bands: Record<CefrLevel, number>;
}
let bandCache: BandCache | null = null;
/** The level model is replayed again after this long even when nothing seems to have changed. */
const BAND_TTL_MS = 10 * 60_000;

/**
 * The level model's share of known words per band (getLevelOverview). Replaying it reads every
 * recognition card's history, so the result is kept for the session and computed again only
 * when the level, the number of answers or of "Biliyorum" words changed.
 */
async function bandKnown(now: Millis): Promise<Record<CefrLevel, number>> {
  const settings = await getSettings(now);
  const [answers, known, tests] = await Promise.all([db.review_logs.count(), db.known_terms.count(), db.level_tests.count()]);
  const key = `${settings.level}|${settings.level_updated_at ?? 0}|${answers}|${known}|${tests}`;
  if (bandCache && bandCache.key === key && now - bandCache.at < BAND_TTL_MS) return bandCache.bands;
  let bands: Record<CefrLevel, number>;
  try {
    const overview = await getLevelOverview(now);
    bands = Object.fromEntries(LEVELS.map((b) => [b, overview.ratios[b].ratio])) as Record<CefrLevel, number>;
  } catch {
    const prior = priorFor(null, settings.level);
    bands = Object.fromEntries(LEVELS.map((b) => [b, prior[b].ratio])) as Record<CefrLevel, number>;
  }
  bandCache = { key, at: now, bands };
  return bands;
}

/** Tests only. */
export function resetKnowledgeCache(): void {
  bandCache = null;
}

async function levelsOrNull() {
  try {
    const data = levelDataNow() ?? (await loadLevelData());
    return { lookup: data.lookup, minZipf: data.minZipf };
  } catch {
    return null; // offline before the level file was ever fetched
  }
}

export async function loadReaderKnowledge(now: Millis = Date.now()): Promise<ReaderKnowledge> {
  const [levels, bands, settings] = await Promise.all([levelsOrNull(), bandKnown(now), getSettings(now)]);
  const { notes, cards, known } = await db.transaction('r', [db.notes, db.cards, db.known_terms], async () => ({
    notes: await db.notes.toArray(),
    cards: await db.cards.toArray(),
    known: await db.known_terms.toArray(),
  }));
  const byNote = wordStagesByNote(notes, cards);
  const stages = new Map<string, WordStage>();
  const noteIds = new Map<string, Id>();
  // Oldest note first: when two live notes share a term (a merge), the first one answers.
  for (const n of [...notes].sort((a, b) => a.created_at - b.created_at)) {
    const info = byNote.get(n.id);
    if (!info || noteIds.has(n.term_norm)) continue;
    stages.set(n.term_norm, info.stage);
    noteIds.set(n.term_norm, n.id);
  }
  const knownSet = new Set(known.filter((k) => k.deleted_at === null).map((k) => k.term_norm));
  const model = buildKnowledge({
    stages,
    known: knownSet,
    bandKnown: bands,
    levels,
    offset: settings.reading_offset ?? 0,
  });
  return {
    ...model,
    noteIdOf: (term) => noteIds.get(term) ?? null,
    noteTerms: [...noteIds.keys()],
  };
}

export async function loadKnowledge(): Promise<Knowledge> {
  const k = await loadReaderKnowledge();
  return { lemmatize: k.lemmatize, pKnown: k.pKnown };
}
