// Anki .apkg import (v0.3 İP1, docs/decisions/0019-anki-import.md): the pure rules. The
// archive is read elsewhere (src/features/anki/readApkg.ts, in a Web Worker); this module
// turns the collection's rows into Engapp notes, senses, cards and review logs.
//
// - Each Anki note becomes one Engapp note with one sense (term + Turkish meaning, optional
//   sentence); the user maps the note type's fields. Cloze note types are not imported.
// - The card template that asks the English side maps to the recognition card, the one that
//   asks the Turkish side to the production card; other templates are ignored and counted.
// - revlog rows become review logs (origin 'anki'); a card's FSRS state is the replay of its
//   logs (invariant 3), never Anki's SM-2 interval.
import { isSameMeaningTr } from '../../supabase/functions/_shared/text';
import { codePoints, LIMITS, truncateCodePoints } from './limits';
import { cleanText, normalizeTerm } from './normalize';
import { findSpan, type Span } from './recognition';
import { cleanTag, tagKey } from './tags';
import { Rating, type RatingValue } from './types';

export type AnkiFormat = 'anki2' | 'anki21' | 'anki21b';

export interface AnkiTemplate {
  ord: number;
  name: string;
  /** Front side template ("{{Front}}"). */
  front: string;
}

export interface AnkiNoteType {
  id: string;
  name: string;
  kind: 'normal' | 'cloze';
  /** Field names in field order. */
  fields: string[];
  templates: AnkiTemplate[];
}

export interface AnkiNote {
  id: number;
  /** Note type id. */
  mid: string;
  tags: string[];
  /** Raw field values (HTML) in field order. */
  fields: string[];
}

export interface AnkiCard {
  id: number;
  nid: number;
  /** Template index (cloze number for cloze note types). */
  ord: number;
  /** -1 suspended, -2/-3 buried, 0 new, 1/3 learning, 2 review. */
  queue: number;
}

export interface AnkiRevlog {
  /** Review time in ms since the epoch (Anki uses it as the row id). */
  id: number;
  cid: number;
  /** Button pressed: 1–4 (1–3 for learning cards on the old v1 scheduler); 0 = manual. */
  ease: number;
  /** 0 learn, 1 review, 2 relearn, 3 filtered/cram, 4 manual, 5 rescheduled. */
  type: number;
  /** Answer time in ms. */
  time: number;
}

/** What the reader returns: plain rows, structured-cloneable from the worker. */
export interface AnkiCollection {
  format: AnkiFormat;
  /** Anki scheduler version (1 = old three-button learning steps). */
  schedVer: number;
  noteTypes: AnkiNoteType[];
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlog: AnkiRevlog[];
  /** Media files in the archive (not imported). */
  mediaFiles: number;
}

/** Field indexes for one note type. */
export interface AnkiFieldMapping {
  term: number;
  meaning: number;
  sentence: number | null;
}

/** Per note type id: its mapping, or null to leave that note type out. */
export type AnkiMappings = Record<string, AnkiFieldMapping | null>;

// ---------------------------------------------------------------------------- fields

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  shy: '',
  zwnj: '',
  zwj: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const MEDIA_RE = /\[sound:[^\]]*\]|<(?:img|audio|video|object|embed|source)\b[^>]*>/gi;

/** Media references in a field (images, sounds): dropped, only counted. */
export function countMedia(html: string): number {
  return html.match(MEDIA_RE)?.length ?? 0;
}

/**
 * Plain text of an Anki field: media references, styles and markup removed, cloze markers
 * resolved to their text, entities decoded, whitespace folded. Lines (br, div, p, li) are
 * joined with `joiner`.
 */
export function ankiFieldText(html: string, joiner = ' '): string {
  const s = html
    .replace(MEDIA_RE, ' ')
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .replace(/<br\s*\/?>|<\/(?:div|p|li|tr|h\d)>|<(?:div|p|li|tr|h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((l) => cleanText(l))
    .filter(Boolean)
    .join(joiner);
}

// ---------------------------------------------------------------------------- mapping

const TERM_NAMES = /^(front|english|word|term|vocab(ulary)?|expression|ingilizce|kelime|sözcük|ön( yüz)?|en)$/i;
const MEANING_NAMES = /^(back|turkish|meaning|translation|definition|türkçe|anlam(ı)?|çeviri|arka( yüz)?|tr)$/i;
const SENTENCE_NAMES = /(sentence|example|context|cümle|örnek)/i;

/** A first guess of the mapping from the field names (first two fields otherwise). */
export function guessMapping(nt: AnkiNoteType): AnkiFieldMapping | null {
  if (nt.kind === 'cloze' || nt.fields.length < 2) return null;
  const find = (re: RegExp, not: number[] = []) =>
    nt.fields.findIndex((f, i) => !not.includes(i) && (re.test(f.trim().toLowerCase()) || re.test(f.trim().toLocaleLowerCase('tr'))));
  let term = find(TERM_NAMES);
  if (term === -1) term = 0;
  let meaning = find(MEANING_NAMES, [term]);
  if (meaning === -1) meaning = term === 0 ? 1 : 0;
  const sentence = find(SENTENCE_NAMES, [term, meaning]);
  return { term, meaning, sentence: sentence === -1 ? null : sentence };
}

/** A mapping that points at real, distinct fields of the note type. */
export function isValidMapping(nt: AnkiNoteType, m: AnkiFieldMapping): boolean {
  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < nt.fields.length;
  if (!ok(m.term) || !ok(m.meaning) || m.term === m.meaning) return false;
  return m.sentence === null || (ok(m.sentence) && m.sentence !== m.term && m.sentence !== m.meaning);
}

export interface AnkiPreviewNote {
  term: string;
  meaning: string;
  sentence: string | null;
}

/** One note as it would be imported (before length checks). */
export function previewNote(note: AnkiNote, m: AnkiFieldMapping): AnkiPreviewNote {
  const sentence = m.sentence === null ? '' : ankiFieldText(note.fields[m.sentence] ?? '');
  return {
    term: ankiFieldText(note.fields[m.term] ?? ''),
    meaning: ankiFieldText(note.fields[m.meaning] ?? '', '; '),
    sentence: sentence || null,
  };
}

export type AnkiDirection = 'recognition' | 'production';

/** Field names a template shows: {{Field}}, {{type:Field}}, {{#Field}}… sections excluded. */
function templateFields(front: string): Set<string> {
  const out = new Set<string>();
  for (const m of front.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const raw = m[1]!.trim();
    if (/^[#^/!]/.test(raw)) continue;
    const name = raw.split(':').at(-1)!.trim();
    if (name) out.add(name);
  }
  return out;
}

/**
 * Which Engapp card each template's cards map to: the template whose front shows the term
 * (and not the meaning) is recognition, the one that shows the meaning (and not the term) is
 * production. A note type with one or two templates the fronts do not tell apart falls back
 * to the first = recognition, second = production. One template per direction; others are
 * ignored.
 */
export function templateDirections(nt: AnkiNoteType, m: AnkiFieldMapping): Map<number, AnkiDirection> {
  const out = new Map<number, AnkiDirection>();
  if (nt.kind === 'cloze') return out;
  const termName = nt.fields[m.term];
  const meaningName = nt.fields[m.meaning];
  const sorted = [...nt.templates].sort((a, b) => a.ord - b.ord);
  const taken = new Set<AnkiDirection>();
  for (const t of sorted) {
    const f = templateFields(t.front);
    const term = termName !== undefined && f.has(termName);
    const meaning = meaningName !== undefined && f.has(meaningName);
    const dir: AnkiDirection | null = term && !meaning ? 'recognition' : meaning && !term ? 'production' : null;
    if (dir && !taken.has(dir)) {
      out.set(t.ord, dir);
      taken.add(dir);
    }
  }
  if (out.size === 0 && sorted.length <= 2) {
    if (sorted[0]) out.set(sorted[0].ord, 'recognition');
    if (sorted[1]) out.set(sorted[1].ord, 'production');
  }
  return out;
}

// ---------------------------------------------------------------------------- history

/**
 * The rating of one revlog row, or null when it is not an answer: filtered-deck cramming
 * (type 3), manual changes (type ≥ 4, ease 0). On the old v1 scheduler learning and
 * relearning cards had three buttons: 1 Again, 2 Good, 3 Easy.
 */
export function revlogRating(r: Pick<AnkiRevlog, 'ease' | 'type'>, schedVer: number): RatingValue | null {
  if (r.type < 0 || r.type > 2) return null;
  if (!Number.isInteger(r.ease) || r.ease < 1 || r.ease > 4) return null;
  if (schedVer === 1 && r.type !== 1) {
    if (r.ease === 4) return null;
    return r.ease === 1 ? Rating.Again : r.ease === 2 ? Rating.Good : Rating.Easy;
  }
  return r.ease as RatingValue;
}

export const MAX_ANKI_DURATION_MS = 60_000;
/** Ids/times before this are not real Anki timestamps (2000-01-01). */
const PLAUSIBLE_MS = 946_684_800_000;

/** cyrb128: a fast, well-mixed 128-bit string hash (not cryptographic). */
function hash128(s: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex = (n: number, len: number) => n.toString(16).padStart(len, '0');

/**
 * Review log id of an Anki answer: a UUID v7 whose time is the review time and whose other
 * bits are a hash of (Engapp card id, Anki revlog id). The same answer on the same card
 * always gets the same id (an interrupted or repeated import cannot add it twice), and the
 * card id keeps it unique across accounts (review_logs' key is the id alone).
 */
export function ankiLogId(cardId: string, revlogId: number): string {
  const [a, b, c, d] = hash128(`${cardId}|${revlogId}`);
  const ms = Math.max(0, Math.min(Math.floor(revlogId), 0xffffffffffff));
  const time = hex(ms, 12);
  const randA = hex(a & 0xfff, 3);
  const variant = hex(0x8000 | (b & 0x3fff), 4);
  const tail = hex(c, 8) + hex(d & 0xffff, 4);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${randA}-${variant}-${tail}`;
}

// ---------------------------------------------------------------------------- summary

export interface AnkiNoteTypeSummary {
  id: string;
  name: string;
  kind: AnkiNoteType['kind'];
  fields: string[];
  noteCount: number;
  /** The first three notes, for the mapping preview. */
  samples: AnkiNote[];
  /** Initial mapping (null: cloze or a single field, not importable). */
  mapping: AnkiFieldMapping | null;
}

export interface AnkiSummary {
  format: AnkiFormat;
  notes: number;
  cards: number;
  /** revlog rows that are answers (cramming and manual changes left out). */
  reviews: number;
  mediaFiles: number;
  noteTypes: AnkiNoteTypeSummary[];
}

export const PREVIEW_NOTES = 3;

/** Counts for the "1.240 not, 2.480 kart, 18.300 tekrar kaydı" line and the mapping step. */
export function summarizeAnki(col: AnkiCollection): AnkiSummary {
  const byType = new Map<string, AnkiNote[]>();
  for (const n of col.notes) {
    const list = byType.get(n.mid);
    if (list) list.push(n);
    else byType.set(n.mid, [n]);
  }
  const noteTypes = col.noteTypes
    .filter((nt) => byType.has(nt.id))
    .map((nt) => {
      const notes = byType.get(nt.id)!;
      return {
        id: nt.id,
        name: nt.name,
        kind: nt.kind,
        fields: nt.fields,
        noteCount: notes.length,
        samples: notes.slice(0, PREVIEW_NOTES),
        mapping: guessMapping(nt),
      };
    })
    .sort((a, b) => b.noteCount - a.noteCount);
  return {
    format: col.format,
    notes: col.notes.length,
    cards: col.cards.length,
    reviews: col.revlog.filter((r) => revlogRating(r, col.schedVer) !== null).length,
    mediaFiles: col.mediaFiles,
    noteTypes,
  };
}

// ---------------------------------------------------------------------------- plan

export interface PlannedLog {
  revlog_id: number;
  rating: RatingValue;
  reviewed_at: number;
  duration_ms: number;
}

export interface PlannedCard {
  anki_card_id: number;
  /** Creation time for the replay: the Anki card's creation, never after its first answer. */
  created_at: number;
  suspended: boolean;
  /** Answers oldest first. */
  logs: PlannedLog[];
}

export interface PlannedSense {
  anki_note_id: number;
  meaning_tr: string;
  source_sentence: string | null;
  /** The term in the sentence (cloze card), when it is found there. */
  span: Span | null;
  production: PlannedCard | null;
}

export interface PlannedNote {
  term: string;
  term_norm: string;
  tags: string[];
  created_at: number;
  recognition: PlannedCard | null;
  senses: PlannedSense[];
}

export interface AnkiPlanCounts {
  /** Notes in the file. */
  notes: number;
  /** Notes of a cloze note type or of a note type the user left out. */
  skippedNoteType: number;
  /** Notes with an empty term or meaning, or a term over the length limit. */
  skippedEmpty: number;
  /** The same term with the same meaning appears again later in the file. */
  sameInFile: number;
  /** Cards in the file. */
  cards: number;
  /** Cards that became an Engapp recognition or production card. */
  cardsMapped: number;
  /** Cards of other templates (and of skipped notes). */
  cardsIgnored: number;
  /** Recognition cards of a second meaning of a term already in the file: history not kept. */
  cardsMerged: number;
  /** Answers that become review logs. */
  logs: number;
  /** revlog rows not imported: cramming, manual changes, answers in the future, unknown cards. */
  logsSkipped: number;
  suspended: number;
  /** Media references (images, sounds) in the imported fields: dropped. */
  media: number;
}

export interface AnkiPlan {
  notes: PlannedNote[];
  counts: AnkiPlanCounts;
}

function plausibleTime(ms: number, now: number): number | null {
  return Number.isFinite(ms) && ms >= PLAUSIBLE_MS && ms <= now ? Math.floor(ms) : null;
}

function cleanTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = cleanTag(r);
    const k = tagKey(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

const bare = (s: string) => s.replace(/\([^)]*\)/g, ' ');

/**
 * Same Turkish meaning in other words ("elma" vs "elma, alma"); a note in brackets does not
 * make it another meaning ("kıyı (nehir)" vs "kıyı").
 */
export function sameMeaning(a: string, b: string): boolean {
  return normalizeTerm(a) === normalizeTerm(b) || isSameMeaningTr(a, b) || isSameMeaningTr(bare(a), bare(b));
}

/**
 * Plan the import of a collection with the user's mappings. Notes are grouped by term
 * (normalized): the first note of a term becomes the note with its history; a later note of
 * the same term with another meaning becomes a second sense (its production card keeps its
 * history, its recognition card's history is dropped because the note has one recognition
 * card); the same term with the same meaning again is counted, not imported.
 */
export function planAnkiImport(col: AnkiCollection, mappings: AnkiMappings, now: number): AnkiPlan {
  const counts: AnkiPlanCounts = {
    notes: col.notes.length,
    skippedNoteType: 0,
    skippedEmpty: 0,
    sameInFile: 0,
    cards: col.cards.length,
    cardsMapped: 0,
    cardsIgnored: 0,
    cardsMerged: 0,
    logs: 0,
    logsSkipped: 0,
    suspended: 0,
    media: 0,
  };
  const types = new Map(col.noteTypes.map((nt) => [nt.id, nt]));
  const directions = new Map<string, Map<number, AnkiDirection>>();
  for (const nt of col.noteTypes) {
    const m = mappings[nt.id];
    if (m && nt.kind !== 'cloze' && isValidMapping(nt, m)) directions.set(nt.id, templateDirections(nt, m));
  }

  const cardsByNote = new Map<number, AnkiCard[]>();
  for (const c of col.cards) {
    const list = cardsByNote.get(c.nid);
    if (list) list.push(c);
    else cardsByNote.set(c.nid, [c]);
  }
  const logsByCard = new Map<number, AnkiRevlog[]>();
  for (const r of col.revlog) {
    const list = logsByCard.get(r.cid);
    if (list) list.push(r);
    else logsByCard.set(r.cid, [r]);
  }
  const knownCards = new Set(col.cards.map((c) => c.id));
  for (const r of col.revlog) if (!knownCards.has(r.cid)) counts.logsSkipped++;
  const rawLogCount = (cardId: number) => logsByCard.get(cardId)?.length ?? 0;

  const plannedCard = (c: AnkiCard): PlannedCard => {
    const logs: PlannedLog[] = [];
    for (const r of logsByCard.get(c.id) ?? []) {
      const rating = revlogRating(r, col.schedVer);
      const at = plausibleTime(r.id, now);
      if (rating === null || at === null) {
        counts.logsSkipped++;
        continue;
      }
      logs.push({
        revlog_id: r.id,
        rating,
        reviewed_at: at,
        duration_ms: Math.min(MAX_ANKI_DURATION_MS, Math.max(0, Math.round(r.time || 0))),
      });
    }
    logs.sort((a, b) => a.reviewed_at - b.reviewed_at || a.revlog_id - b.revlog_id);
    counts.logs += logs.length;
    const born = plausibleTime(c.id, now) ?? logs[0]?.reviewed_at ?? now;
    const suspended = c.queue === -1;
    if (suspended) counts.suspended++;
    counts.cardsMapped++;
    return { anki_card_id: c.id, created_at: Math.min(born, logs[0]?.reviewed_at ?? born), suspended, logs };
  };
  const ignore = (cards: readonly AnkiCard[]) => {
    for (const c of cards) {
      counts.cardsIgnored++;
      counts.logsSkipped += rawLogCount(c.id);
    }
  };

  const byTerm = new Map<string, PlannedNote>();
  const out: PlannedNote[] = [];
  for (const note of col.notes) {
    const nt = types.get(note.mid);
    const dirs = directions.get(note.mid);
    const mapping = mappings[note.mid];
    const cards = (cardsByNote.get(note.id) ?? []).sort((a, b) => a.ord - b.ord);
    if (!nt || !dirs || !mapping) {
      counts.skippedNoteType++;
      ignore(cards);
      continue;
    }
    const p = previewNote(note, mapping);
    const termNorm = normalizeTerm(p.term);
    if (!termNorm || !p.meaning || codePoints(p.term) > LIMITS.term) {
      counts.skippedEmpty++;
      ignore(cards);
      continue;
    }
    counts.media += note.fields.reduce((n, f, i) => (i === mapping.term || i === mapping.meaning || i === mapping.sentence ? n + countMedia(f) : n), 0);
    const meaning = truncateCodePoints(p.meaning, LIMITS.meaning_tr);
    const sentence = p.sentence && codePoints(p.sentence) <= LIMITS.source_sentence ? p.sentence : null;

    const existing = byTerm.get(termNorm);
    if (existing && existing.senses.some((s) => sameMeaning(s.meaning_tr, meaning))) {
      counts.sameInFile++;
      ignore(cards);
      continue;
    }
    let recognition: AnkiCard | undefined;
    let production: AnkiCard | undefined;
    const others: AnkiCard[] = [];
    for (const c of cards) {
      const dir = dirs.get(c.ord);
      if (dir === 'recognition' && !recognition) recognition = c;
      else if (dir === 'production' && !production) production = c;
      else others.push(c);
    }
    ignore(others);
    const sense: PlannedSense = {
      anki_note_id: note.id,
      meaning_tr: meaning,
      source_sentence: sentence,
      span: sentence ? findSpan(sentence, p.term) : null,
      production: production ? plannedCard(production) : null,
    };
    if (existing) {
      existing.senses.push(sense);
      if (recognition) {
        counts.cardsMerged++;
        counts.logsSkipped += rawLogCount(recognition.id);
      }
      existing.tags = cleanTags([...existing.tags, ...note.tags]);
      continue;
    }
    const rec = recognition ? plannedCard(recognition) : null;
    const noteBorn = plausibleTime(note.id, now) ?? now;
    const firstCard = Math.min(rec?.created_at ?? Infinity, sense.production?.created_at ?? Infinity);
    const planned: PlannedNote = {
      term: cleanText(p.term),
      term_norm: termNorm,
      tags: cleanTags(note.tags),
      created_at: Math.min(noteBorn, firstCard),
      recognition: rec,
      senses: [sense],
    };
    byTerm.set(termNorm, planned);
    out.push(planned);
  }
  return { notes: out, counts };
}

// ---------------------------------------------------------------------------- lexicon

/**
 * "Sözlükle eşleştir": the shared-lexicon sense that is the user's meaning, if any (same
 * Turkish meaning in other words). Without one only the note is linked to the lexicon term.
 */
export function matchLexiconSense<T extends { meaning_tr: string }>(meaning: string, senses: readonly T[]): T | null {
  return senses.find((s) => sameMeaning(s.meaning_tr, meaning)) ?? null;
}
