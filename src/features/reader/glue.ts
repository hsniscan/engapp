/**
 * Splits the text between two words of a sentence into [glued to the word before, free, glued
 * to the word after]: `, "` gives [',', ' ', '"']. With no space in it, all of it stays with the
 * word before (`—`, `/`); with no word before, it goes to the word after. The reader draws a
 * word with its glued punctuation in one nowrap group, so a line never ends on an opening quote.
 */
export function splitGap(gap: string, hasBefore: boolean): [string, string, string] {
  if (!gap) return ['', '', ''];
  const firstSpace = gap.search(/\s/);
  if (firstSpace < 0) return hasBefore ? [gap, '', ''] : ['', '', gap];
  const afterLastSpace = gap.search(/\S*$/);
  const trail = hasBefore ? gap.slice(0, firstSpace) : '';
  return [trail, gap.slice(trail.length, afterLastSpace), gap.slice(afterLastSpace)];
}
