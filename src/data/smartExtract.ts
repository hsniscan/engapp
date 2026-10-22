// Smart extraction on the device (v0.2 İP4): when an import job's last chunk is in, every
// candidate gets its level and a preview section, and the default selection follows the
// level rule of domain/candidates.ts. What the learner knows (their notes, İP3's known
// terms) is read here and compared here; it is never sent to the server.
import { looksLikeVocabularyList } from '../domain/chunking';
import { occurrenceCounter, planCandidates, type CandidateFacts } from '../domain/candidates';
import { senseLevel, type LevelData } from '../domain/level';
import { normalizeTerm } from '../domain/normalize';
import type { Id, LexiconSense } from '../domain/types';
import { db } from './db';
import { logError } from './errorLog';
import type { ImportCandidateRecord, ImportJobRecord } from './import';
import { knownTermsProvider } from './knownTermsProvider';
import { levelDataNow, loadLevelData } from './levelData';

/** What the classification needs from outside the Dexie transaction. */
export interface SmartContext {
  /** Known-term keys (İP3), compared on the device only. */
  known: Set<string>;
  /** The client level file, for candidates whose lexicon sense has no level yet. */
  levels: LevelData | null;
}

/**
 * Loads the known terms and the level file. Never fails: without them every candidate is
 * classified with what the lexicon rows carry (an unknown level counts as one above the
 * learner's, so it stays within the 10 % share).
 */
export async function loadSmartContext(): Promise<SmartContext> {
  const [known, levels] = await Promise.all([
    knownTermsProvider()
      .getKnownTermKeys()
      .catch((e: unknown) => {
        void logError(e, 'import.knownTerms');
        return new Set<string>();
      }),
    loadLevelData().catch(() => levelDataNow()),
  ]);
  return { known, levels };
}

const candidates = () =>
  db.import_candidates as unknown as import('dexie').Table<ImportCandidateRecord, Id>;

/**
 * Classifies every candidate of a job and stores level, section and default selection.
 * Runs inside the caller's transaction (import_candidates and lexicon_cache in scope).
 * The user's later choices (selection, "Biliyorum") are made on these rows afterwards.
 */
export async function classifyJobCandidates(
  job: ImportJobRecord,
  ctx: SmartContext,
): Promise<void> {
  const rows = await candidates().where('job_id').equals(job.id).toArray();
  if (rows.length === 0) return;
  const lexIds = [
    ...new Set(rows.flatMap((r) => (r.lexicon_sense_id ? [r.lexicon_sense_id] : []))),
  ];
  const lex = new Map<string, LexiconSense>();
  for (const l of await db.lexicon_cache.bulkGet(lexIds)) if (l) lex.set(l.id, l);

  const count = occurrenceCounter(job.chunks.join('\n'));
  const listChunk = new Map<number, boolean>();
  const isList = (order: number) => {
    const i = Math.floor(order / 1000);
    let v = listChunk.get(i);
    if (v === undefined) {
      v = looksLikeVocabularyList(job.chunks[i] ?? '');
      listChunk.set(i, v);
    }
    return v;
  };

  const facts: CandidateFacts[] = [];
  for (const r of rows) {
    const key = normalizeTerm(r.term);
    const l = r.lexicon_sense_id ? lex.get(r.lexicon_sense_id) : undefined;
    const level = senseLevel(
      { term_norm: key, term_type: r.term_type },
      { pos: r.pos ?? '' },
      l,
      ctx.levels,
    );
    r.cefr = level?.cefr ?? null;
    r.cefr_source = level?.source ?? null;
    r.from_list = isList(r.order);
    facts.push({
      id: r.id,
      key,
      cefr: r.cefr,
      occurrences: count(r.term, r.surface),
      zipf: l?.zipf ?? ctx.levels?.lookup(key)?.zipf ?? null,
      hasNote: r.user_status !== 'new',
      fromList: r.from_list,
      order: r.order,
    });
  }
  const plan = planCandidates(facts, job.level, ctx.known);
  const byId = new Map(rows.map((r) => [r.id, r]));
  plan.rows.forEach((p, i) => {
    const r = byId.get(p.id)!;
    r.bucket = p.bucket;
    r.selected = p.selected;
    r.rank = i;
  });
  await candidates().bulkPut(rows);
}

/**
 * "Biliyorum" in the preview: the candidate (and every other candidate of the same term in the
 * job) moves to "Biliyorsun" and is unselected; the word is reported to the known-terms
 * provider so that later imports do not offer it again. Returns the ids that moved.
 */
export async function markCandidateKnown(id: Id): Promise<Id[]> {
  const c = await candidates().get(id);
  if (!c) return [];
  const key = normalizeTerm(c.term);
  const ids = await db.transaction('rw', db.import_candidates, async () => {
    const same = (await candidates().where('job_id').equals(c.job_id).toArray()).filter(
      (r) => normalizeTerm(r.term) === key,
    );
    for (const r of same) await candidates().update(r.id, { bucket: 'known', selected: false });
    return same.map((r) => r.id);
  });
  try {
    await knownTermsProvider().markKnown(c.term, 'preview');
  } catch (e) {
    void logError(e, 'import.markKnown');
  }
  return ids;
}

/**
 * When the preview opens: candidates of words marked known after the job was classified (on
 * another device, in the level test, in another preview or in the known-words list) move to
 * "Biliyorsun" and are unselected, so a "Biliyorum" word is not offered again. Unclassified
 * rows (job still running) are left to classifyJobCandidates. Returns the ids that moved.
 */
export async function refreshKnownCandidates(jobId: Id): Promise<Id[]> {
  const known = await knownTermsProvider().getKnownTermKeys();
  if (known.size === 0) return [];
  return db.transaction('rw', db.import_candidates, async () => {
    const rows = await candidates().where('job_id').equals(jobId).toArray();
    const moved = rows.filter(
      (r) => r.bucket != null && r.bucket !== 'known' && known.has(normalizeTerm(r.term)),
    );
    for (const r of moved) await candidates().update(r.id, { bucket: 'known', selected: false });
    return moved.map((r) => r.id);
  });
}
