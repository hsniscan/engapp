// What the reader's word sheet shows, from this device only (v0.5 İP1, decision 0043): the
// user's own note first, then Kelime Bankası, then the cached shared lexicon. Nothing here
// touches the network; the sheet asks ai-enrich (features/import/lexicon.ts) only when this
// finds nothing and the device is online, and never sends the user's sentence with it.
import { normalizeTerm } from '../domain/normalize';
import type { Id, LexiconSense } from '../domain/types';
import { db } from './db';
import { cardImageOf, type CardImage } from './images';
import { findLexiconSenses } from './lexicon';

export interface ReaderMeaning {
  meaning_tr: string;
  gloss_en: string | null;
  pos: string | null;
  lexicon_sense_id: Id | null;
}

export interface ReaderWordInfo {
  /** The form the meanings belong to (the lemma, or the written form when only that is known). */
  term: string;
  /** 'note': the user's card; 'bank': Kelime Bankası; 'lexicon': the cached shared dictionary. */
  source: 'note' | 'bank' | 'lexicon' | null;
  noteId: Id | null;
  lexiconTermId: Id | null;
  ipa: string | null;
  meanings: ReaderMeaning[];
  /** A cached picture of the first meaning, or null. */
  picture: CardImage | null;
}

const fromLexicon = (s: LexiconSense): ReaderMeaning => ({
  meaning_tr: s.meaning_tr,
  gloss_en: s.gloss_en || null,
  pos: s.pos || null,
  lexicon_sense_id: s.id,
});

async function pictureOf(lexiconSenseId: Id | null, senseId: Id = ''): Promise<CardImage | null> {
  if (!lexiconSenseId) return null;
  try {
    return await cardImageOf({ id: senseId, lexicon_sense_id: lexiconSenseId });
  } catch {
    return null;
  }
}

async function lookupOne(term: string): Promise<ReaderWordInfo | null> {
  const norm = normalizeTerm(term);
  if (!norm) return null;
  const note = (await db.notes.where('term_norm').equals(norm).toArray()).find(
    (n) => n.deleted_at === null,
  );
  if (note) {
    const senses = (await db.senses.where('note_id').equals(note.id).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.created_at - b.created_at);
    if (senses.length) {
      return {
        term: note.term,
        source: 'note',
        noteId: note.id,
        lexiconTermId: note.lexicon_term_id ?? null,
        ipa: note.ipa ?? null,
        meanings: senses.map((s) => ({
          meaning_tr: s.meaning_tr_override?.trim() || s.meaning_tr,
          gloss_en: s.gloss_en ?? null,
          pos: s.pos ?? null,
          lexicon_sense_id: s.lexicon_sense_id ?? null,
        })),
        picture: await pictureOf(senses[0]!.lexicon_sense_id ?? null, senses[0]!.id),
      };
    }
  }
  const bank = await db.word_bank.where('lemma_norm').equals(norm).toArray();
  if (bank.length) {
    const sorted = [...bank].sort((a, b) => (b.zipf ?? 0) - (a.zipf ?? 0));
    const meanings = sorted.flatMap((e) =>
      e.senses.map((s) => ({
        meaning_tr: s.meaning_tr,
        gloss_en: null,
        pos: e.pos,
        lexicon_sense_id: s.sense_id,
      })),
    );
    return {
      term: sorted[0]!.lemma,
      source: 'bank',
      noteId: null,
      lexiconTermId: sorted[0]!.lexicon_term_id,
      ipa: null,
      meanings,
      picture: await pictureOf(meanings[0]?.lexicon_sense_id ?? null),
    };
  }
  const lex = await findLexiconSenses(norm);
  if (lex.length) {
    const meanings = lex.map(fromLexicon);
    return {
      term: lex[0]!.lemma,
      source: 'lexicon',
      noteId: null,
      lexiconTermId: lex[0]!.term_id,
      ipa: lex.find((s) => s.ipa)?.ipa ?? null,
      meanings,
      picture: await pictureOf(meanings[0]!.lexicon_sense_id),
    };
  }
  return null;
}

/**
 * The meanings of a tapped word or selected phrase: the lemma first ("went" → "go"), then the
 * written form. `source: null` when the device has nothing (the sheet may then ask online).
 */
export async function lookupReaderWord(lemma: string, written: string): Promise<ReaderWordInfo> {
  for (const t of [lemma, written]) {
    const hit = await lookupOne(t);
    if (hit) return hit;
  }
  return {
    term: lemma || written,
    source: null,
    noteId: null,
    lexiconTermId: null,
    ipa: null,
    meanings: [],
    picture: null,
  };
}
