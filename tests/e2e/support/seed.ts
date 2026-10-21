/**
 * Realistic study data for performance tests, as an Engapp backup file (restored through the
 * app's own "Geri yükle"). Cards get real FSRS state from simulated review histories
 * (src/domain/fsrs.ts), so queue building, recompute and integrity see what a long-time user
 * has: most cards in review, some due today, some learning, new cards waiting.
 */
import { buildBackup, type BackupFile } from '../../../src/domain/backup.ts';
import { applyRating, createScheduler, emptyFsrs } from '../../../src/domain/fsrs.ts';
import { encodeHlc } from '../../../src/domain/hlc.ts';
import { deriveUnlocked } from '../../../src/domain/recompute.ts';
import { FAKE_SPECS } from '../../../src/features/import/testing/fakeSpecs.ts';
import type {
  Card,
  CardType,
  Note,
  RatingValue,
  ReviewLog,
  Sense,
  Settings,
} from '../../../src/domain/types.ts';

const DAY = 86_400_000;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'reluctant',
  'thrive',
  'scarce',
  'curb',
  'feasible',
  'hinder',
  'tackle',
  'notably',
  'harsh',
  'outweigh',
  'backfire',
  'subsidy',
  'widespread',
  'eventually',
  'overwhelming',
  'boost',
  'cope',
];

/** `cards` ≈ number of cards (3 per note: recognition, production, cloze). */
export async function buildSeedBackup(cards: number, now = Date.now()): Promise<BackupFile> {
  const rand = rng(cards);
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const nNotes = Math.ceil(cards / 3);
  const notes: Note[] = [];
  const senses: Sense[] = [];
  const cardRows: Card[] = [];
  const logs: ReviewLog[] = [];
  let seq = 0;
  const id = (p: string) => `${p}-${String(++seq).padStart(7, '0')}`;
  const hlc = (t: number) => encodeHlc({ ms: t, counter: 0, node: 'seed' });
  const start = now - 180 * DAY;

  for (let i = 0; i < nNotes; i++) {
    const created = start + Math.floor((i / nNotes) * 170 * DAY);
    // The newest notes (what home, library and screenshots show first) are real words with
    // real meanings and sentences; the long tail is generated.
    const candidate = FAKE_SPECS[nNotes - 1 - i];
    const spec =
      candidate && candidate.sentence.includes(candidate.surface) ? candidate : undefined;
    const term = spec?.term ?? `${WORDS[i % WORDS.length]}${i >= WORDS.length ? ` ${i}` : ''}`;
    const noteId = id('note');
    const senseId = id('sense');
    const base = {
      user_id: null,
      created_at: created,
      updated_at: created,
      deleted_at: null,
      hlc: hlc(created),
    };
    notes.push({
      ...base,
      id: noteId,
      term,
      term_norm: term.toLowerCase(),
      term_type: spec?.type ?? 'word',
      lexicon_term_id: null,
      ipa: spec?.ipa ?? null,
      tags: i % 7 === 0 ? ['iş'] : [],
      possible_duplicate: false,
      level_override: null,
    });
    const sentence = spec?.sentence ?? `People say the word ${term} is useful in daily life.`;
    const surface = spec?.surface ?? term;
    const at = sentence.indexOf(surface);
    senses.push({
      ...base,
      id: senseId,
      note_id: noteId,
      sense_no: 1,
      lexicon_sense_id: null,
      pos: spec?.pos ?? 'adjective',
      gloss_en: spec?.gloss ?? 'an example gloss',
      meaning_tr: spec?.tr ?? `anlam ${i}`,
      meaning_tr_override: null,
      source_sentence: sentence,
      source_sentence_tr: null,
      span: [at, at + surface.length],
      source_id: null,
    });

    // Newer notes are partly unstudied; older ones have a history.
    const studied = i < nNotes * 0.85;
    let recognitionState: Card['state'] | null = null;
    for (const type of ['recognition', 'production', 'cloze'] as CardType[]) {
      const cardId = id('card');
      let f = emptyFsrs(created);
      if (studied && (type === 'recognition' || rand() < 0.7)) {
        let t = created + (type === 'recognition' ? 0 : 3 * DAY) + Math.floor(rand() * DAY);
        while (t < now) {
          const r = rand();
          const rating = (r < 0.08 ? 1 : r < 0.18 ? 2 : r < 0.92 ? 3 : 4) as RatingValue;
          f = applyRating(scheduler, { id: cardId, ...f }, rating, t);
          logs.push({
            id: id('log'),
            user_id: null,
            card_id: cardId,
            rating,
            reviewed_at: t,
            duration_ms: 3000 + Math.floor(rand() * 9000),
            device_id: 'seed',
            undo_of: null,
            shown_sense_id: type === 'recognition' ? senseId : null,
            created_at: t,
            hlc: hlc(t),
          });
          // The user reviews when due (sometimes a day or two late).
          t = Math.max(f.due, t + 60_000) + (rand() < 0.2 ? Math.floor(rand() * 2 * DAY) : 0);
        }
      }
      if (type === 'recognition') recognitionState = f.state;
      const last =
        logs.length && logs[logs.length - 1]!.card_id === cardId
          ? logs[logs.length - 1]!.reviewed_at
          : created;
      cardRows.push({
        ...base,
        updated_at: last,
        hlc: hlc(last),
        id: cardId,
        note_id: noteId,
        sense_id: type === 'recognition' ? null : senseId,
        card_type: type,
        suspended: false,
        unlocked: deriveUnlocked(
          { card_type: type, state: f.state, reps: f.reps },
          recognitionState,
        ),
        ...f,
      });
    }
  }
  const settings: Settings = {
    id: 'settings',
    user_id: null,
    created_at: start,
    updated_at: start,
    deleted_at: null,
    hlc: hlc(start),
    daily_new_limit: 10,
    request_retention: 0.9,
    timezone: 'Europe/Istanbul',
    day_start_hour: 4,
    theme: 'system',
    voice: 'en-US',
    level: 'B1',
    fsrs_params: null,
    last_backup_at: null,
  };
  return buildBackup(
    { notes, senses, cards: cardRows, review_logs: logs, sources: [], settings: [settings] },
    { exported_at: now, device_id: 'seed' },
  );
}
