// Import jobs (AI extraction queue) and the preview → cards confirmation.
// The queue runner lives in src/features/import/queue.ts; this module owns the Dexie side:
// jobs with their chunk texts, the local chunk cache, candidates with their status against
// the user's own notes, and the single-transaction confirm.
import type { AiFalseFriend } from '../../supabase/functions/_shared/contracts';
import { stripListEntry } from '../../supabase/functions/_shared/listEntry';
import { isDuplicateSense } from '../../supabase/functions/_shared/text';
import { normalizeTerm } from '../domain/normalize';
import type {
  CandidateUserStatus,
  CefrLevel,
  ChunkCacheRow,
  Id,
  ImportCandidate,
  ImportJob,
  LexiconPairNote,
  LexiconSense,
  Millis,
  Sense,
  Source,
} from '../domain/types';
import { uuidv7 } from '../domain/ids';
import { aggregateTopics } from '../domain/topics';
import { addNoteWithSenses, createSource, type SenseInput } from './actions';
import { db } from './db';
import { logError } from './errorLog';
import { ActionError } from './errors';
import { setSourceTopics } from './profile';
import { classifyJobCandidates, loadSmartContext } from './smartExtract';

/** Error codes stored on a failed job (mapped to Turkish messages by the UI). */
export type ImportErrorCode =
  | 'daily_limit'
  | 'quota_exceeded'
  | 'ai_failed'
  | 'not_signed_in'
  | 'not_configured'
  | 'invalid_input'
  | 'bad_response'
  | 'unreachable'
  | 'unknown';

/** What Dexie stores in import_jobs: the ImportJob columns plus the work itself. */
export interface ImportJobRecord extends ImportJob {
  kind: Source['kind'];
  title: string;
  level: CefrLevel;
  /** Chunk texts, processed in order; chunk_done is the index of the next one. */
  chunks: string[];
  error_code: ImportErrorCode | null;
  /** Chunks answered from a cache (this device's chunk_cache or the server's) without AI. */
  chunk_cache_hits: number;
  /** When a transient failure was retried, the earliest next try. */
  next_attempt_at: Millis | null;
  /**
   * extract-v5: the topic keys of each processed chunk, in chunk order (absent on jobs from
   * before). When the job is done they are aggregated into sources.topics.
   */
  chunk_topics?: string[][];
}

/** A preview row, with the lexicon term id kept for the note it may create. */
export interface ImportCandidateRecord extends ImportCandidate {
  lexicon_term_id: Id | null;
  /** Position in the job (chunk index * 1000 + order in chunk): stable list order. */
  order: number;
  /**
   * Display order in the preview, set by smart extraction when the job is complete (sections,
   * then occurrences and frequency); absent before (and on rows from older versions).
   */
  rank?: number;
}

/** The validated result of one chunk, as stored in chunk_cache.result. */
export interface ChunkResult {
  prompt_version: string;
  level: CefrLevel;
  candidates: ChunkCandidate[];
  /** extract-v5: 1–2 topic keys of the chunk; absent in older results. */
  topics?: string[];
}

export interface ChunkCandidate {
  term: string;
  surface: string;
  term_type: ImportCandidate['term_type'];
  source_sentence: string;
  /** Since extract-v2; results cached on this device before that have none (→ null). */
  sentence_tr?: string | null;
  span: [number, number];
  confidence: number;
  match: ImportCandidate['match'];
  lexicon: LexiconSense;
  /** extract-v5: a Turkish look-alike of a new sense with another meaning (shared data). */
  false_friend?: AiFalseFriend | null;
}

/** A false friend from an extract response as a cached lexicon_pair_notes row. */
function falseFriendRow(c: ChunkCandidate): LexiconPairNote | null {
  const ff = c.false_friend;
  if (!ff) return null;
  return {
    id: ff.id,
    term_norm: c.lexicon.lemma_norm,
    sense_id: c.lexicon.id,
    lang_pair: 'en-tr',
    kind: 'false_friend',
    content_key: ff.tr_word,
    content: {
      tr_word: ff.tr_word,
      en_meaning_tr: ff.en_meaning_tr,
      tr_meaning_tr: ff.tr_meaning_tr,
      tr_meaning_en: ff.tr_meaning_en,
      strength: ff.strength,
      note_tr: ff.note_tr,
    },
    curated: false,
    status: 'active',
    updated_at: c.lexicon.updated_at,
  };
}

const jobs = () => db.import_jobs as unknown as import('dexie').Table<ImportJobRecord, Id>;
const candidates = () => db.import_candidates as unknown as import('dexie').Table<ImportCandidateRecord, Id>;

export interface CreateImportJobInput {
  kind: Source['kind'];
  title: string;
  file_name?: string | null;
  page_count?: number | null;
  chunks: string[];
  level: CefrLevel;
}

/** Saves the source and queues a job. Nothing is sent anywhere here. */
export async function createImportJob(input: CreateImportJobInput, now: Millis = Date.now()): Promise<ImportJobRecord> {
  const chunks = input.chunks.filter((c) => c.trim() !== '');
  if (chunks.length === 0) throw new ActionError('invalid_input', 'No text');
  const source = await createSource(
    { kind: input.kind, title: input.title, file_name: input.file_name ?? null, page_count: input.page_count ?? null },
    now,
  );
  const job: ImportJobRecord = {
    id: uuidv7(now),
    source_id: source.id,
    status: 'queued',
    chunk_total: chunks.length,
    chunk_done: 0,
    cache_hits: 0,
    error: null,
    error_code: null,
    chunk_cache_hits: 0,
    created_at: now,
    updated_at: now,
    kind: input.kind,
    title: input.title,
    level: input.level,
    chunks,
    next_attempt_at: null,
  };
  await jobs().add(job);
  return job;
}

export function getImportJob(id: Id): Promise<ImportJobRecord | undefined> {
  return jobs().get(id);
}

/** Jobs that still have chunks to process, oldest first. */
export async function listPendingImportJobs(): Promise<ImportJobRecord[]> {
  const rows = await jobs().where('status').anyOf('queued', 'processing').toArray();
  return rows.sort((a, b) => a.created_at - b.created_at);
}

/** Recent jobs (newest first), for "devam eden içe aktarmalar". */
export async function listRecentImportJobs(limit = 5): Promise<ImportJobRecord[]> {
  return jobs().orderBy('created_at').reverse().limit(limit).toArray();
}

export async function updateImportJob(id: Id, patch: Partial<ImportJobRecord>, now: Millis = Date.now()): Promise<void> {
  await jobs().update(id, { ...patch, updated_at: now });
}

/** Retry a failed job from the chunk where it stopped. */
export async function retryImportJob(id: Id, now: Millis = Date.now()): Promise<void> {
  await jobs().update(id, { status: 'queued', error: null, error_code: null, next_attempt_at: null, updated_at: now });
}

// ------------------------------------------------------------------ chunk cache

export async function getCachedChunk(hash: string, level: CefrLevel, promptVersion?: string): Promise<ChunkResult | null> {
  const row = await db.chunk_cache.get(hash);
  const res = row?.result as ChunkResult | undefined;
  if (!res || !Array.isArray(res.candidates) || res.level !== level) return null;
  if (promptVersion && res.prompt_version !== promptVersion) return null;
  return res;
}

// ------------------------------------------------------------------ candidates

/**
 * "zaten var" / "yeni anlam olarak ekle" / "yeni" against the user's live notes. A sense of
 * the term with the same lexicon sense, the same meaning (or the same part of speech and an
 * overlapping Turkish meaning: "davet" ~ "davetiye, davet") or the same example sentence
 * counts as existing: importing the same list again (a newer prompt may word a sense
 * differently) does not offer the words already added.
 */
export async function userStatusOf(
  term: string,
  lexiconSenseId: Id | null,
  meaning: string | null,
  sentence: string | null = null,
  pos: string | null = null,
): Promise<CandidateUserStatus> {
  const norm = normalizeTerm(term);
  const notes = (await db.notes.where('term_norm').equals(norm).toArray()).filter((n) => n.deleted_at === null);
  if (notes.length === 0) return 'new';
  const senses: Sense[] = (await db.senses.where('note_id').anyOf(notes.map((n) => n.id)).toArray()).filter(
    (s) => s.deleted_at === null,
  );
  const key = meaning ? normalizeTerm(meaning) : null;
  const sentenceKey = sentence?.trim() ? normalizeTerm(sentence) : null;
  const same = senses.some(
    (s) =>
      (lexiconSenseId !== null && s.lexicon_sense_id === lexiconSenseId) ||
      (key !== null && normalizeTerm(s.meaning_tr_override?.trim() || s.meaning_tr) === key) ||
      (meaning !== null && isDuplicateSense({ pos: s.pos, meaning_tr: s.meaning_tr_override?.trim() || s.meaning_tr }, { pos, meaning_tr: meaning })) ||
      (sentenceKey !== null && !!s.source_sentence && normalizeTerm(s.source_sentence) === sentenceKey),
  );
  return same ? 'exists' : 'add_sense';
}

function sentenceKeyOf(term: string, sentence: string): string {
  return `${normalizeTerm(term)}|${normalizeTerm(sentence)}`;
}

/** Does the user already have this candidate's lexicon sense on a live note? */
async function ownsSense(c: Pick<ImportCandidateRecord, 'lexicon_sense_id'>): Promise<boolean> {
  if (!c.lexicon_sense_id) return false;
  return (await db.senses.where('lexicon_sense_id').equals(c.lexicon_sense_id).filter((s) => s.deleted_at === null).count()) > 0;
}

/**
 * Which of two candidates for the same term and sentence to keep: the sense the user
 * already has, then a sense that was in the lexicon before (known_sense), then the higher
 * confidence. A tie keeps the earlier one.
 */
function candidateRank(c: Pick<ImportCandidateRecord, 'match' | 'confidence'>, owned: boolean): number {
  return (owned ? 4 : 0) + (c.match === 'known_sense' ? 2 : 0) + c.confidence;
}

/**
 * Store one processed chunk: candidates (deduplicated against earlier chunks of the job by
 * lexicon sense, and by term + sentence), the lexicon entries, the chunk cache row, and the job's progress — all in
 * one transaction, so a reload resumes at the next chunk.
 */
export async function recordChunkResult(
  jobId: Id,
  chunkIndex: number,
  hash: string,
  result: ChunkResult,
  opts: {
    /** Served from this device's chunk_cache (nothing to store). */
    fromLocalCache: boolean;
    /** Answered by the server's chunk cache (no AI call). */
    serverCacheHit?: boolean;
    /** Candidates matched to existing lexicon senses (no content generated). */
    lexiconHits?: number;
  },
  now: Millis = Date.now(),
): Promise<{ added: number }> {
  // Smart extraction (İP4): the last chunk classifies the whole job. What it needs from
  // outside Dexie (known terms, the level file) is loaded before the transaction.
  const pending = await jobs().get(jobId);
  const smart = pending && chunkIndex + 1 >= pending.chunk_total ? await loadSmartContext() : null;
  const tables = [db.import_jobs, db.import_candidates, db.chunk_cache, db.lexicon_cache, db.lexicon_pair_notes, db.notes, db.senses];
  const out = await db.transaction('rw', tables, async () => {
    const job = await jobs().get(jobId);
    if (!job || job.chunk_done !== chunkIndex) return { added: 0, topicsOf: null }; // processed already (another tab)
    const existing = await candidates().where('job_id').equals(jobId).toArray();
    const seen = new Set(existing.map((c) => c.lexicon_sense_id ?? `${normalizeTerm(c.term)}|${c.meaning_tr ?? ''}`));
    // One candidate per term and sentence across the job: two senses of a word for the
    // same sentence (the model gave a known sense and a reworded new one) are one.
    const bySentence = new Map<string, ImportCandidateRecord>(
      existing.flatMap((c) => (c.source_sentence ? [[sentenceKeyOf(c.term, c.source_sentence), c] as const] : [])),
    );
    const rows: ImportCandidateRecord[] = [];
    const replaced: Id[] = [];
    let i = 0;
    for (const c of result.candidates) {
      const key = c.lexicon.id;
      i++;
      if (seen.has(key)) continue;
      seen.add(key);
      // Results cached before ai-extract cut word-list prefixes ("1988 trailer I own a trailer.").
      const clean = stripListEntry(c.source_sentence, c.term, c.span);
      const sentence = clean.span ? clean.sentence : c.source_sentence;
      const span = clean.span ?? c.span;
      const status = await userStatusOf(c.term, c.lexicon.id, c.lexicon.meaning_tr, sentence, c.lexicon.pos);
      const row: ImportCandidateRecord = {
        id: uuidv7(now),
        job_id: jobId,
        term: c.term,
        surface: c.surface,
        term_type: c.term_type,
        lexicon_sense_id: c.lexicon.id,
        lexicon_term_id: c.lexicon.term_id,
        match: c.match,
        pos: c.lexicon.pos,
        gloss_en: c.lexicon.gloss_en,
        meaning_tr: c.lexicon.meaning_tr,
        ipa: c.lexicon.ipa,
        source_sentence: sentence,
        source_sentence_tr: c.sentence_tr ?? null,
        span,
        confidence: c.confidence,
        selected: status !== 'exists',
        user_status: status,
        meaning_tr_edit: null,
        order: chunkIndex * 1000 + i,
        cefr: c.lexicon.cefr ?? null,
        cefr_source: c.lexicon.cefr_source ?? null,
        bucket: null,
        from_list: false,
      };
      const sKey = sentenceKeyOf(c.term, sentence);
      const twin = bySentence.get(sKey);
      if (twin) {
        if (candidateRank(row, await ownsSense(row)) <= candidateRank(twin, await ownsSense(twin))) continue;
        // The better one takes the twin's place in the list.
        row.order = twin.order;
        const at = rows.indexOf(twin);
        if (at >= 0) rows.splice(at, 1);
        else replaced.push(twin.id);
      }
      bySentence.set(sKey, row);
      rows.push(row);
    }
    if (replaced.length) await candidates().bulkDelete(replaced);
    if (rows.length) await candidates().bulkAdd(rows);
    const lex = result.candidates.map((c) => c.lexicon);
    if (lex.length) await db.lexicon_cache.bulkPut(lex);
    const falseFriends = result.candidates.map(falseFriendRow).filter((r): r is LexiconPairNote => r !== null);
    if (falseFriends.length) await db.lexicon_pair_notes.bulkPut(falseFriends);
    const chunkTopics = [...(job.chunk_topics ?? []).slice(0, chunkIndex), result.topics ?? []];
    if (!opts.fromLocalCache) {
      const cacheRow: ChunkCacheRow = { chunk_hash: hash, result, created_at: now };
      await db.chunk_cache.put(cacheRow);
    }
    const cached = opts.fromLocalCache || !!opts.serverCacheHit;
    const done = chunkIndex + 1;
    const finished = done >= job.chunk_total;
    if (finished) await classifyJobCandidates(job, smart ?? { known: new Set(), levels: null });
    await jobs().update(jobId, {
      chunk_done: done,
      cache_hits: job.cache_hits + (cached ? 1 : 0) + (opts.lexiconHits ?? 0),
      chunk_cache_hits: (job.chunk_cache_hits ?? 0) + (cached ? 1 : 0),
      chunk_topics: chunkTopics,
      status: finished ? 'ready' : 'processing',
      error: null,
      error_code: null,
      next_attempt_at: null,
      updated_at: now,
    });
    return { added: rows.length, topicsOf: finished ? { sourceId: job.source_id, chunkTopics } : null };
  });
  // The text's topics (extract-v5) once every chunk is in. A synced write of its own: a
  // failure here must not undo the job's progress.
  const topics = out.topicsOf ? aggregateTopics(out.topicsOf.chunkTopics) : [];
  if (out.topicsOf && topics.length) {
    await setSourceTopics(out.topicsOf.sourceId, topics, now).catch((e: unknown) => logError(e, 'import.topics'));
  }
  return { added: out.added };
}

export async function listImportCandidates(jobId: Id): Promise<ImportCandidateRecord[]> {
  const rows = await candidates().where('job_id').equals(jobId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/** Persist the user's selection / in-place meaning edit for a candidate. */
export async function updateImportCandidate(id: Id, patch: Partial<Pick<ImportCandidate, 'selected' | 'meaning_tr_edit'>>): Promise<void> {
  await candidates().update(id, patch);
}

export async function setImportCandidatesSelected(ids: Id[], selected: boolean): Promise<void> {
  await db.transaction('rw', db.import_candidates, async () => {
    for (const id of ids) await candidates().update(id, { selected });
  });
}

/** The preview's current state of a candidate (applied inside the confirm transaction). */
export interface CandidateChoice {
  selected: boolean;
  meaning_tr_edit: string | null;
}

export interface ConfirmImportResult {
  notesCreated: number;
  sensesAdded: number;
  cardsCreated: number;
  skipped: number;
}

/**
 * Turn the selected candidates into notes, senses and cards in ONE Dexie transaction
 * (every write is queued for sync), then mark the job done. Candidates of the same term
 * become one note with several senses. The lexicon meaning is copied into the sense; an
 * in-place edit becomes meaning_tr_override.
 */
export async function confirmImport(
  jobId: Id,
  opts: { choices?: ReadonlyMap<Id, CandidateChoice>; now?: Millis } = {},
): Promise<ConfirmImportResult> {
  const now = opts.now ?? Date.now();
  const res: ConfirmImportResult = { notesCreated: 0, sensesAdded: 0, cardsCreated: 0, skipped: 0 };
  await db.transaction('rw', db.tables, async () => {
    const job = await jobs().get(jobId);
    if (!job) throw new ActionError('not_found');
    if (job.status === 'done') throw new ActionError('invalid_input', 'Already confirmed');
    const all = await listImportCandidates(jobId);
    if (opts.choices) {
      for (const c of all) {
        const ch = opts.choices.get(c.id);
        if (!ch) continue;
        c.selected = ch.selected;
        c.meaning_tr_edit = ch.meaning_tr_edit;
        await candidates().update(c.id, { selected: ch.selected, meaning_tr_edit: ch.meaning_tr_edit });
      }
    }
    const chosen = all.filter((c) => c.selected);
    const byTerm = new Map<string, ImportCandidateRecord[]>();
    for (const c of chosen) {
      const key = normalizeTerm(c.term);
      byTerm.set(key, [...(byTerm.get(key) ?? []), c]);
    }
    for (const group of byTerm.values()) {
      const first = group[0]!;
      const senses: SenseInput[] = group.map((c) => {
        const base = (c.meaning_tr ?? '').trim();
        const edit = c.meaning_tr_edit?.trim() || null;
        return {
          meaning_tr: base || edit || '',
          meaning_tr_override: edit && edit !== base ? edit : null,
          lexicon_sense_id: c.lexicon_sense_id,
          pos: c.pos,
          gloss_en: c.gloss_en,
          source_sentence: c.source_sentence,
          source_sentence_tr: c.source_sentence_tr ?? null,
          span: c.span,
          source_id: job.source_id,
        };
      });
      const valid = senses.filter((s) => s.meaning_tr.trim() !== '');
      res.skipped += senses.length - valid.length;
      if (valid.length === 0) continue;
      const out = await addNoteWithSenses(
        {
          term: first.term,
          term_type: first.term_type,
          ipa: group.find((c) => c.ipa)?.ipa ?? null,
          lexicon_term_id: first.lexicon_term_id,
          senses: valid,
          one_sense_per_sentence: true,
        },
        now,
      );
      if (out.status !== 'existing') res.notesCreated++;
      res.sensesAdded += out.addedSenses.length;
      res.skipped += out.skippedSenses.length;
      res.cardsCreated += out.createdCards.length;
    }
    await jobs().update(jobId, { status: 'done', updated_at: now });
  });
  return res;
}

/** Throw a job and its candidates away (the source row stays as history). */
export async function deleteImportJob(jobId: Id): Promise<void> {
  await db.transaction('rw', db.import_jobs, db.import_candidates, async () => {
    await candidates().where('job_id').equals(jobId).delete();
    await jobs().delete(jobId);
  });
}
