// The `src` of a picture: sanitized again (defence in depth, plan A.4), recoloured for the
// theme and wrapped in a `data:` URL for an <img> (never inline SVG in the DOM). Memoized per
// picture and theme, so a card switch costs a Map lookup; `preloadPicture` builds and decodes
// the next card's picture while the current one is on screen.
import { pictureDataUrl, safeSanitize } from '@/domain/images';
import type { Id } from '@/domain/types';
import { getThemePreference, resolveTheme, type ResolvedTheme } from '@/ui/theme';

const MAX_ENTRIES = 300;
const cache = new Map<string, string | null>();

function remember(key: string, value: string | null): string | null {
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

/** The current theme as shown (for code outside React). */
export const shownTheme = (): ResolvedTheme => resolveTheme(getThemePreference());

/** `data:` URL of a picture in a theme, or null when the sanitizer refuses it. */
export function pictureSrc(image: { id: Id; svg: string }, theme: ResolvedTheme): string | null {
  const key = `${image.id}:${theme}:${image.svg.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const clean = safeSanitize(image.svg);
  return remember(key, clean ? pictureDataUrl(clean, theme) : null);
}

/** Whether a picture can be shown at all (the sanitizer accepts it). */
export const canShowPicture = (image: { id: Id; svg: string } | null | undefined, theme: ResolvedTheme = shownTheme()): boolean =>
  !!image && pictureSrc(image, theme) !== null;

const decoded = new Map<string, HTMLImageElement>();

/**
 * Build and decode a picture ahead of time (the next card of a review session), so showing it
 * costs no decode on the card switch. Best effort; never throws.
 */
export function preloadPicture(image: { id: Id; svg: string } | null | undefined, theme: ResolvedTheme = shownTheme()): void {
  if (!image || typeof Image === 'undefined') return;
  const src = pictureSrc(image, theme);
  if (!src || decoded.has(src)) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  decoded.set(src, img);
  if (decoded.size > 12) decoded.delete(decoded.keys().next().value!);
  img.decode?.().catch(() => {});
}

/** Tests only. */
export function clearPictureCache(): void {
  cache.clear();
  decoded.clear();
}
