// "Engapp" in the text-selection menu (v0.5 İP4, docs/decisions/0046-quick-capture.md): what a
// selection becomes in the quick sheet at /quick?text=…. Pure; the Android menu entry and the
// web build open the same address.
//
//   ≤ 3 words  → one term: its meanings, picture, audio and "Karta ekle"
//   a link     → handed to "Paylaş → Engapp" (/share), which already knows links
//   more       → "Okuyucuda aç" (a 'paste' reading text) and "Kelimeleri çıkar" (/share)
//
// The words and their cleaning are the share target's (src/features/share/route.ts), so a word
// selected in Chrome and the same word shared from Chrome end up as the same term.
import { lemmaForms } from '../../../supabase/functions/_shared/tokenize';
import { normalizeTerm } from '@/domain/normalize';
import { MAX_TEXT_CHARS } from '@/domain/texts';
import { countWords, routeShared } from '@/features/share/route';

export type QuickRoute =
  | { kind: 'empty' }
  | { kind: 'term'; term: string }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string; words: number };

export function routeQuick(raw: string | null | undefined): QuickRoute {
  const r = routeShared({ text: (raw ?? '').slice(0, MAX_TEXT_CHARS) });
  switch (r.kind) {
    case 'term':
      return { kind: 'term', term: r.term };
    case 'link':
      return { kind: 'link', url: r.url };
    case 'text':
      return { kind: 'text', text: r.text, words: countWords(r.text) };
    default:
      return { kind: 'empty' };
  }
}

/**
 * The spellings to look a selected term up under, best first: the term itself, then (for one
 * word) its likely base forms ("postponed" → "postpone"), so an inflected word in an article
 * still finds its word-bank entry. Normalised like notes.term_norm.
 */
export function lookupForms(term: string): string[] {
  const norm = normalizeTerm(term);
  if (!norm) return [];
  if (norm.includes(' ')) return [norm];
  return [...new Set([norm, ...lemmaForms(norm).map(normalizeTerm)])].filter(Boolean);
}

/** The in-app address of the quick sheet for a selection. */
export function quickHref(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT_CHARS);
  return t ? `/quick?${new URLSearchParams({ text: t }).toString()}` : '/quick';
}

/** Readable title for a selection saved as a reading text. */
export function quickTitle(text: string, max = 60): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const flat = line.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).trim()}…`;
}

/**
 * The only addresses the quick sheet may open in the main app (and the main app accepts from
 * that intent): a reading text, or the full add form for a term ("Anlamını kendim yazayım").
 */
export function isOpenablePath(path: string): boolean {
  if (path.length > 600) return false;
  return /^\/oku\/[A-Za-z0-9_-]{1,64}$/.test(path) || /^\/add\?term=[^&#\s]{1,500}$/.test(path);
}

/** The full add form for a term (the quick sheet's way out when nothing knows the word). */
export const addFormPath = (term: string): string => `/add?term=${encodeURIComponent(term)}`;
