// The quick sheet's word lookup (v0.5 İP4, docs/decisions/0046-quick-capture.md): everything
// on this device first, so a word selected in another app shows its meaning offline. Order:
// Kelime Bankası (curated meanings, shared system content) → the lexicon cache (the shared
// dictionary rows this device has seen). Both are read only; adding goes through the normal
// add paths (addFromWordBank / addNoteWithSenses), so the card is the user's own like any other.
import { IMAGE_TARGET, pickImage, rejectedImageIds } from '../domain/images';
import { normalizeTerm } from '../domain/normalize';
import type { CefrLevel, Id, LexiconSense, Millis } from '../domain/types';
import type { WordBankEntry } from '../domain/wordBank';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { getKnownTermKeys } from './knownTerms';
import { addFromWordBank } from './wordBank';

export interface QuickSense {
  /** Stable within one preview: `${entryId}#${index}` (bank) or the lexicon sense id. */
  key: string;
  meaning_tr: string;
  pos: string | null;
  gloss_en: string | null;
  /** The bank's own example sentence (not the user's text). */
  example_en: string | null;
  lexicon_sense_id: Id | null;
}

export interface QuickPicture {
  id: Id;
  svg: string;
  alt: string;
  isNew: boolean;
}

export interface QuickPreview {
  /** The spelling the card gets: the dictionary form when one was found, else the selection. */
  term: string;
  /** The form that matched (normalised), or null when nothing on the device knows the word. */
  matched: string | null;
  origin: 'bank' | 'lexicon' | 'none';
  ipa: string | null;
  cefr: CefrLevel | null;
  senses: QuickSense[];
  /** Bank rows behind `senses` (origin 'bank'). */
  bank: WordBankEntry[];
  lexiconTermId: Id | null;
  /** The user already has a card for it, or marked it known. */
  owned: 'carded' | 'known' | null;
  picture: QuickPicture | null;
}

async function pictureFor(lexiconSenseIds: readonly Id[]): Promise<QuickPicture | null> {
  const ids = lexiconSenseIds.filter(Boolean);
  if (!ids.length) return null;
  const rows = await db.images.where('sense_id').anyOf(ids).toArray();
  if (!rows.length) return null;
  const feedback = await db.content_feedback
    .where('[target_kind+target_id]')
    .anyOf(rows.map((r) => [IMAGE_TARGET, r.id]))
    .filter((f) => f.deleted_at === null)
    .toArray();
  const rejected = rejectedImageIds(feedback);
  // The first sense with a picture wins (senses are in their display order).
  for (const id of ids) {
    const own = rows.filter((r) => r.sense_id === id);
    const picked = pickImage(own, { imageId: null, hidden: false }, rejected);
    if (picked)
      return {
        id: picked.id,
        svg: picked.svg,
        alt: picked.alt_tr,
        isNew: picked.status === 'review',
      };
  }
  return null;
}

async function ownedStatus(forms: readonly string[]): Promise<QuickPreview['owned']> {
  for (const f of forms) {
    const notes = await db.notes.where('term_norm').equals(f).toArray();
    if (notes.some((n) => n.deleted_at === null)) return 'carded';
  }
  const known = await getKnownTermKeys();
  return forms.some((f) => known.has(f)) ? 'known' : null;
}

function fromBank(entries: WordBankEntry[]): QuickSense[] {
  return entries.flatMap((e) =>
    e.senses.map((s, i) => ({
      key: `${e.id}#${i}`,
      meaning_tr: s.meaning_tr,
      pos: e.pos,
      gloss_en: null,
      example_en: s.example_en || null,
      lexicon_sense_id: s.sense_id ?? null,
    })),
  );
}

function fromLexicon(rows: LexiconSense[]): QuickSense[] {
  return rows.map((s) => ({
    key: s.id,
    meaning_tr: s.meaning_tr,
    pos: s.pos || null,
    gloss_en: s.gloss_en || null,
    example_en: null,
    lexicon_sense_id: s.id,
  }));
}

/**
 * What the quick sheet shows for a selected term. `forms` are the spellings to try, best first
 * (features/quick/route.ts lookupForms). Reads only; safe in a live query.
 */
export async function quickPreview(
  selected: string,
  forms: readonly string[],
): Promise<QuickPreview> {
  const keys = forms.length ? forms : [normalizeTerm(selected)];
  const owned = await ownedStatus(keys);
  for (const form of keys) {
    const bank = (await db.word_bank.where('lemma_norm').equals(form).toArray()).sort(
      (a, b) => (b.zipf ?? -1) - (a.zipf ?? -1) || a.pos.localeCompare(b.pos),
    );
    if (bank.length) {
      const senses = fromBank(bank);
      const lex = await db.lexicon_cache.where('lemma_norm').equals(form).first();
      return {
        term: bank[0]!.lemma,
        matched: form,
        origin: 'bank',
        ipa: lex?.ipa ?? null,
        cefr: bank[0]!.cefr,
        senses,
        bank,
        lexiconTermId: bank[0]!.lexicon_term_id,
        owned,
        picture: await pictureFor(
          senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x),
        ),
      };
    }
    const lex = await db.lexicon_cache.where('lemma_norm').equals(form).toArray();
    if (lex.length) {
      return {
        term: lex[0]!.lemma,
        matched: form,
        origin: 'lexicon',
        ipa: lex.find((s) => s.ipa)?.ipa ?? null,
        cefr: lex.find((s) => s.cefr)?.cefr ?? null,
        senses: fromLexicon(lex),
        bank: [],
        lexiconTermId: lex[0]!.term_id,
        owned,
        picture: await pictureFor(lex.map((s) => s.id)),
      };
    }
  }
  return {
    term: selected,
    matched: null,
    origin: 'none',
    ipa: null,
    cefr: null,
    senses: [],
    bank: [],
    lexiconTermId: null,
    owned,
    picture: null,
  };
}

/** Dictionary senses that came back from ai-enrich, when they are filed under another lemma. */
export function previewFromSenses(
  base: QuickPreview,
  senses: readonly {
    lexicon_sense_id: Id;
    lexicon_term_id: Id | null;
    pos: string | null;
    gloss_en: string | null;
    meaning_tr: string;
    ipa: string | null;
  }[],
): QuickPreview {
  if (base.origin !== 'none' || !senses.length) return base;
  return {
    ...base,
    origin: 'lexicon',
    ipa: senses.find((s) => s.ipa)?.ipa ?? null,
    senses: senses.map((s) => ({
      key: s.lexicon_sense_id,
      meaning_tr: s.meaning_tr,
      pos: s.pos,
      gloss_en: s.gloss_en,
      example_en: null,
      lexicon_sense_id: s.lexicon_sense_id,
    })),
    lexiconTermId: senses[0]!.lexicon_term_id,
  };
}

export interface QuickAddResult {
  term: string;
  /** Senses that became new (0: the user already had all of them). */
  added: number;
  cards: number;
}

/**
 * "Karta ekle": the picked meanings through the normal add path. Bank words keep the bank's
 * example sentence (it gives the cloze card); dictionary senses get no sentence, because a
 * selected word has none of its own.
 */
export async function addQuickCard(
  preview: QuickPreview,
  keys: readonly string[],
  now: Millis = Date.now(),
): Promise<QuickAddResult> {
  const picked = new Set(keys.length ? keys : preview.senses.slice(0, 1).map((s) => s.key));
  if (preview.origin === 'bank') {
    const picks = preview.bank
      .map((entry) => ({
        entry,
        senses: entry.senses.map((_, i) => i).filter((i) => picked.has(`${entry.id}#${i}`)),
      }))
      .filter((p) => p.senses.length > 0);
    const res = await addFromWordBank(picks, now);
    return { term: preview.term, added: res.added.length, cards: res.cards };
  }
  const senses = preview.senses.filter((s) => picked.has(s.key));
  if (!senses.length) return { term: preview.term, added: 0, cards: 0 };
  const res = await addNoteWithSenses(
    {
      term: preview.term,
      term_type: preview.term.includes(' ') ? 'phrase' : 'word',
      ipa: preview.ipa,
      lexicon_term_id: preview.lexiconTermId,
      senses: senses.map((s) => ({
        meaning_tr: s.meaning_tr,
        pos: s.pos,
        gloss_en: s.gloss_en,
        lexicon_sense_id: s.lexicon_sense_id,
        source_sentence: null,
      })),
    },
    now,
  );
  return { term: res.note.term, added: res.addedSenses.length, cards: res.createdCards.length };
}
