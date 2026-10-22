// "Paylaş → Engapp" (v0.4 İP6, docs/decisions/0034-share-target.md): where shared text goes.
// Pure: used by the /share page for both the Android share intent and the PWA's Web Share
// Target, which arrive as /share?text=…&title=…&url=….
//
//   ≤ 3 words           → card preview for that term (/add?term=…)
//   a link (+ a title)  → the page title only (full article import comes in v0.5)
//   longer text         → word extraction preview, with the text as the source of the sentences
import { LIMITS } from '@/domain/limits';

/** Same bound as one text import (src/features/import/shared.ts MAX_IMPORT_CHARS). */
export const MAX_SHARED_CHARS = 300_000;
/** Up to this many words is one term (a word or a phrase like "give up on"). */
export const MAX_TERM_WORDS = 3;
/** A link with at most this much other text is "a link with its title", not a passage. */
export const MAX_LINK_CAPTION_WORDS = 30;

export interface SharedInput {
  text?: string | null;
  title?: string | null;
  url?: string | null;
}

export type ShareRoute =
  | { kind: 'empty' }
  | { kind: 'term'; term: string }
  | { kind: 'text'; text: string; title: string | null }
  | { kind: 'link'; url: string; title: string | null };

const URL_RE = /\bhttps?:\/\/[^\s<>"'”“]+/i;

/** Words = whitespace-separated tokens that contain a letter. */
export function countWords(s: string): number {
  return s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

const EDGE_PUNCT = /^[\s"'“”‘’«»`([{<.,;:!?…*_~|•–—-]+|[\s"'“”‘’«»`)\]}>.,;:!?…*_~|•–—-]+$/gu;

/** "“Serendipity.”" → "Serendipity": quotes and punctuation around a shared word go. */
export function cleanTerm(s: string): string {
  return s.replace(/\s+/g, ' ').replace(EDGE_PUNCT, '').trim().slice(0, LIMITS.term);
}

function validUrl(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Trailing punctuation that is part of the sentence, not of the address. */
function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?)\]]+$/, '');
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\r\n?/g, '\n').trim();

export function routeShared(input: SharedInput): ShareRoute {
  const text = clean(input.text).slice(0, MAX_SHARED_CHARS);
  const title = clean(input.title).replace(/\s+/g, ' ').slice(0, LIMITS.source_title) || null;

  let url = validUrl(input.url);
  let rest = text;
  if (!url) {
    const m = URL_RE.exec(text);
    const found = m ? validUrl(trimUrl(m[0])) : null;
    if (m && found) {
      url = found;
      rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim();
    }
  }
  rest = rest.replace(/^[\s\-–—|:•]+|[\s\-–—|:•]+$/g, '').trim();

  if (url) {
    // A long passage that happens to contain a link is still text to learn from.
    if (countWords(rest) > MAX_LINK_CAPTION_WORDS) return { kind: 'text', text: rest, title };
    return { kind: 'link', url, title: title ?? (rest ? rest.replace(/\s+/g, ' ') : null) };
  }

  // Some apps put the selection in the subject only.
  const body = rest || title || '';
  const words = countWords(body);
  if (words === 0) return { kind: 'empty' };
  if (words <= MAX_TERM_WORDS) {
    const term = cleanTerm(body);
    return term ? { kind: 'term', term } : { kind: 'empty' };
  }
  return { kind: 'text', text: body, title: rest ? title : null };
}

/** The in-app address for a share (Android intent → router). */
export function shareHref(p: { text?: string | null; title?: string | null }): string {
  const q = new URLSearchParams();
  const text = clean(p.text).slice(0, MAX_SHARED_CHARS);
  const title = clean(p.title);
  if (text) q.set('text', text);
  if (title) q.set('title', title);
  const s = q.toString();
  return s ? `/share?${s}` : '/share';
}
