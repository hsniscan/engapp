// Note tags: cleaning and case-insensitive set operations. Pure: no Dexie, no React.
// A tag is compared case-insensitively with Turkish rules ("İş" = "iş"); the first spelling
// on a note is kept. The server allows LIMITS.tags tags per note (no per-tag length limit);
// new tags are capped at MAX_TAG_LENGTH so chips and deck filters stay readable.
import { LIMITS } from './limits';

export const MAX_TAG_LENGTH = 40;

/** Trimmed, single-spaced, NFC, without a leading "#", at most MAX_TAG_LENGTH code points. */
export function cleanTag(raw: string): string {
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
  return [...s].slice(0, MAX_TAG_LENGTH).join('').trim();
}

export function tagKey(tag: string): string {
  return tag.normalize('NFC').toLocaleLowerCase('tr');
}

export function sameTag(a: string, b: string): boolean {
  return tagKey(a) === tagKey(b);
}

export function hasTag(tags: readonly string[], tag: string): boolean {
  const k = tagKey(tag);
  return tags.some((t) => tagKey(t) === k);
}

/**
 * `tags` plus every tag of `add` the note does not have yet (case-insensitive), in order.
 * Returns null when the result would exceed LIMITS.tags (the server rejects such a row).
 */
export function withTags(tags: readonly string[], add: readonly string[]): string[] | null {
  const out = [...tags];
  for (const raw of add) {
    const t = cleanTag(raw);
    if (t && !hasTag(out, t)) out.push(t);
  }
  return out.length > LIMITS.tags ? null : out;
}

/** `tags` without any tag of `remove` (case-insensitive). */
export function withoutTags(tags: readonly string[], remove: readonly string[]): string[] {
  const keys = new Set(remove.map(tagKey));
  return tags.filter((t) => !keys.has(tagKey(t)));
}

/** `tags` with `from` replaced by `to` (merged if the note already has `to`). */
export function renamedTags(tags: readonly string[], from: string, to: string): string[] {
  if (!hasTag(tags, from)) return [...tags];
  const target = cleanTag(to);
  const out: string[] = [];
  for (const t of tags) {
    const next = sameTag(t, from) ? target : t;
    if (next && !hasTag(out, next)) out.push(next);
  }
  return out;
}

/** Distinct tags (first spelling wins) with how many notes carry them, most used first. */
export function tagCounts(tagLists: Iterable<readonly string[]>): { tag: string; count: number }[] {
  const map = new Map<string, { tag: string; count: number }>();
  for (const tags of tagLists) {
    const seen = new Set<string>();
    for (const t of tags) {
      const k = tagKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      const cur = map.get(k);
      if (cur) cur.count++;
      else map.set(k, { tag: t, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'));
}
