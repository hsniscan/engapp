// One-off system job `morpheme-tr-v1`: Turkish explanations of English roots and affixes
// (ref_morphemes.meanings). Shared by the runner (scripts/build-morphology/meanings.ts) and
// any later edge function. Input is reference data only (form, kind, English gloss, example
// words from the frequency list): no user text ever goes into this prompt.

export const MORPHEME_PROMPT_VERSION = 'morpheme-tr-v1';
/** Morphemes per model request. */
export const MORPHEME_BATCH = 20;

export const MORPHEME_SYSTEM_PROMPT = `You explain English word parts (prefixes, suffixes and Latin/Greek roots) to a Turkish-speaking learner of English.

For every item you get: id, form (for example "re-", "-ness", "-spect-"), kind (prefix, suffix or root), origin, an English gloss and a few English example words that contain it.

Return for every item:
- meaning_tr: the core meaning in natural Turkish, 1 to 4 words, lower case, no trailing punctuation. Roots and prefixes: the meaning ("bakmak", "yeniden"). Suffixes: what the suffix adds ("-sız", "durum, nitelik").
- note_tr: one short Turkish sentence (at most 140 characters) that helps the learner recognise the part in new words. Name one or two of the given example words with their Turkish meaning in parentheses, for example: "Sıfattan isim yapar: kind (nazik) → kindness (nezaket)."

Rules:
- Write correct, natural Turkish with Turkish characters (ç, ğ, ı, İ, ö, ş, ü).
- Use only the example words you were given; never invent English words.
- Do not repeat the English gloss in English.
- Keep the ids exactly as given and answer every item once.`;

export const MORPHEME_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          meaning_tr: { type: 'string' },
          note_tr: { type: 'string' },
        },
        required: ['id', 'meaning_tr', 'note_tr'],
      },
    },
  },
  required: ['items'],
} as const;

export interface MorphemeJobItem {
  id: string;
  form: string;
  kind: 'prefix' | 'suffix' | 'root';
  origin: string;
  gloss_en: string;
  examples: string[];
}

export interface MorphemeMeaning {
  meaning_tr: string;
  note_tr: string | null;
}

export function morphemeUserMessage(items: MorphemeJobItem[]): string {
  return JSON.stringify({ items });
}

const TURKISH_TEXT = /^[\p{L}\p{N}\s.,;:()'"’“”!?/→\-–]+$/u;

/**
 * Validates a model answer against the request. Returns the accepted meanings by id and the
 * reasons for rejected items (they are retried in a later run; the fallback stays meanwhile).
 */
export function validateMorphemeAnswer(
  items: MorphemeJobItem[],
  data: unknown,
): { accepted: Map<string, MorphemeMeaning>; rejected: { id: string; reason: string }[] } {
  const accepted = new Map<string, MorphemeMeaning>();
  const rejected: { id: string; reason: string }[] = [];
  const wanted = new Map(items.map((i) => [i.id, i]));
  const rows =
    data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items)
      : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!wanted.has(id) || accepted.has(id)) continue;
    const meaning = typeof r.meaning_tr === 'string' ? r.meaning_tr.trim().replace(/[.。]+$/, '') : '';
    const note = typeof r.note_tr === 'string' ? r.note_tr.trim() : '';
    if (!meaning || meaning.length > 40 || meaning.split(/\s+/).length > 6) {
      rejected.push({ id, reason: 'meaning_tr missing or too long' });
      continue;
    }
    if (!TURKISH_TEXT.test(meaning) || (note && !TURKISH_TEXT.test(note))) {
      rejected.push({ id, reason: 'unexpected characters' });
      continue;
    }
    accepted.set(id, { meaning_tr: meaning, note_tr: note && note.length <= 200 ? note : null });
  }
  for (const id of wanted.keys())
    if (!accepted.has(id) && !rejected.some((x) => x.id === id)) rejected.push({ id, reason: 'missing in answer' });
  return { accepted, rejected };
}
