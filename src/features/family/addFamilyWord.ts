// "Aile" row, one tap on a word the user does not have yet: add it with its first meaning
// from the shared dictionary (device cache first, then the server; the server only calls
// the model when the dictionary has nothing). Without a meaning (guest, offline, error) the
// caller opens the add form with the word filled in.
import { addNoteWithSenses, type AddNoteResult } from '@/data';
import { lookupLexicon, type LookupDeps } from '@/features/import/lexicon';

export type AddFamilyWordResult =
  | { status: 'added'; result: AddNoteResult; meaning: string }
  | { status: 'needs_form'; reason: string };

export async function addFamilyWord(lemma: string, deps?: LookupDeps): Promise<AddFamilyWordResult> {
  const found = await lookupLexicon(lemma, { more: false }, deps);
  if (!found.ok) return { status: 'needs_form', reason: found.error };
  const first = found.senses[0];
  if (!first) return { status: 'needs_form', reason: 'empty' };
  const result = await addNoteWithSenses({
    term: lemma,
    term_type: 'word',
    ipa: first.ipa,
    lexicon_term_id: first.lexicon_term_id,
    senses: [
      {
        meaning_tr: first.meaning_tr,
        lexicon_sense_id: first.lexicon_sense_id,
        pos: first.pos,
        gloss_en: first.gloss_en,
      },
    ],
  });
  return { status: 'added', result, meaning: first.meaning_tr };
}
