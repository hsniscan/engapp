/**
 * The Engapp mark: a stressed "ˈe" — the IPA primary-stress tick before a serif e, set in
 * Source Serif 4 Semibold (outlines converted to paths, SIL OFL). It reads as a dictionary
 * pronunciation entry: the point where an English word gets its weight.
 *
 * Pure data + string builder, shared by the <Logo> component and scripts/generate-icons.ts.
 */

/** Source Serif 4 Semibold "e", font units (1000/em, y up). */
export const E_PATH =
  'M293 -14Q216 -14 159.0 17.0Q102 48 71.5 105.0Q41 162 41 242Q41 322 72.5 382.0Q104 442 160.0 475.0Q216 508 287 508Q351 508 398.5 483.0Q446 458 472.0 412.5Q498 367 498 305Q498 285 496.0 268.5Q494 252 491 239H118V289H348Q368 297 374.5 310.5Q381 324 381 346Q381 381 369.5 405.0Q358 429 337.0 441.5Q316 454 286 454Q253 454 227.0 434.0Q201 414 185.5 371.0Q170 328 170 257Q170 195 190.5 153.0Q211 111 246.5 89.5Q282 68 328 68Q377 68 409.5 85.0Q442 102 467 131L503 102Q482 68 453.5 41.5Q425 15 386.0 0.5Q347 -14 293 -14Z';

/** Source Serif 4 "ˈ" (U+02C8), font units. */
export const TICK_PATH = 'M61 533 53 733H154L146 533Z';

export const markColors = {
  tile: '#1f1d1a',
  letter: '#f5f2ec',
  tick: '#9dbde3',
} as const;

/** Transform that places the glyph pair in a 512 box. `scale` 0.44 for icons, 0.34 for maskable. */
export function glyphTransform(scale = 0.44): string {
  const tx = +(256 - 366 * scale).toFixed(2);
  const ty = +(280 + 247 * scale).toFixed(2);
  return `translate(${tx} ${ty}) scale(${scale} -${scale})`;
}

export interface MarkSvgOptions {
  /** 'rounded' app tile, 'square' full-bleed (maskable / apple-touch), 'none' glyphs only. */
  tile?: 'rounded' | 'square' | 'none';
  scale?: number;
  colors?: { tile: string; letter: string; tick: string };
}

export function markSvg({
  tile = 'rounded',
  scale = 0.44,
  colors = markColors,
}: MarkSvgOptions = {}): string {
  const bg =
    tile === 'none'
      ? ''
      : `<rect width="512" height="512"${tile === 'rounded' ? ' rx="112"' : ''} fill="${colors.tile}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}` +
    `<g transform="${glyphTransform(scale)}">` +
    `<path fill="${colors.tick}" transform="translate(0 -40)" d="${TICK_PATH}"/>` +
    `<path fill="${colors.letter}" transform="translate(176 0)" d="${E_PATH}"/>` +
    `</g></svg>`
  );
}
