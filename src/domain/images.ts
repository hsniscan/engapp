// Pictures of word senses on the device (v0.4 İP3, docs/decisions/0031-images-in-app.md). Pure:
// which cached picture a card shows, what the cache keeps under its size cap, what a fetch has
// to download, and the safe `data:` URL an <img> gets. The shared rows come from
// public.lexicon_images (supabase/functions/_shared/image-contract.ts); the user's own choice,
// hide flag and verdicts are user_content / content_feedback rows of their account.
import {
  IMAGE_MAX_BYTES,
  IMAGE_REJECT_REASONS,
  svgForTheme,
  type ImageRejectReason,
  type LexiconImageRow,
  type SanitizeResult,
} from '../../supabase/functions/_shared/image-contract';
import { sanitizeSvg } from '../../supabase/functions/_shared/svg-sanitize';
import { contentRowId } from './examples';
import type { ContentFeedback, Id, Millis, UserContent } from './types';

export { IMAGE_REJECT_REASONS, type ImageRejectReason };

/** user_content.kind of the user's picture choice / hide flag (one row per sense of the user). */
export const IMAGE_CHOICE_KIND = 'image_choice';
/** content_feedback.target_kind of "Bu görsel anlamı anlatıyor mu?" (target_id = image id). */
export const IMAGE_TARGET = 'image';
/** user_content.kind holding the reason of a "Hayır" (one row per image, context = reason). */
export const IMAGE_REASON_KIND = 'image_feedback';

/** The device cache keeps at most this many bytes of SVG (plan: ~20 MB). */
export const IMAGE_CACHE_CAP_BYTES = 20 * 1024 * 1024;

export type CachedImageStatus = 'approved' | 'review';

/** A row of the Dexie `images` table: one shared picture of a lexicon sense. Not synced. */
export interface CachedImage {
  /** lexicon_images.id */
  id: Id;
  /** The shared lexicon sense (lexicon_images.sense_id), not the user's own sense id. */
  sense_id: Id;
  variant: number;
  /** Stored as sanitized at fetch time; sanitized again before it is shown. */
  svg: string;
  alt_tr: string;
  /** 'review': drawn, not yet looked at by a person (shown with a "Yeni" badge). */
  status: CachedImageStatus;
  /** lexicon_images.created_at (ISO). */
  created_at: string;
  fetched_at: Millis;
}

/** The two user-side ids are derived, so two devices write the same row (like mnemonics). */
export const imageChoiceRowId = (senseId: Id): Promise<Id> => contentRowId(['user_content', IMAGE_CHOICE_KIND, senseId]);
export const imageReasonRowId = (imageId: Id): Promise<Id> => contentRowId(['user_content', IMAGE_REASON_KIND, imageId]);

/** Runs the sanitizer and never throws (a failing or missing sanitizer means "do not show"). */
export function safeSanitize(svg: string, sanitize: (svg: string) => SanitizeResult = sanitizeSvg): string | null {
  if (!svg || svg.length > IMAGE_MAX_BYTES) return null;
  try {
    const res = sanitize(svg);
    return res.ok ? res.svg : null;
  } catch {
    return null;
  }
}

/**
 * A shared row as the cache stores it, or null: rejected/checking rows are never cached, and a
 * picture the sanitizer refuses is dropped.
 */
export function toCachedImage(
  row: LexiconImageRow,
  now: Millis,
  sanitize?: (svg: string) => SanitizeResult,
): CachedImage | null {
  if (row.status !== 'approved' && row.status !== 'review') return null;
  const svg = safeSanitize(row.svg, sanitize);
  if (!svg) return null;
  return {
    id: row.id,
    sense_id: row.sense_id,
    variant: row.variant,
    svg,
    alt_tr: row.alt_tr.trim(),
    status: row.status,
    created_at: row.created_at,
    fetched_at: now,
  };
}

/** Display order of a sense's pictures: approved before new, then by variant. */
export function orderImages<T extends Pick<CachedImage, 'status' | 'variant' | 'id'>>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1) ||
      a.variant - b.variant ||
      a.id.localeCompare(b.id),
  );
}

/** The user's choice for one sense. */
export interface ImageChoice {
  /** The picked picture (null: the default pick). */
  imageId: Id | null;
  /** "Görseli gizle": no picture for this sense on this account. */
  hidden: boolean;
}

/** The live choice row of a sense as an ImageChoice (no row: the default, shown). */
export function choiceOf(row: UserContent | null | undefined): ImageChoice {
  if (!row || row.deleted_at !== null || row.kind !== IMAGE_CHOICE_KIND) return { imageId: null, hidden: false };
  return { imageId: row.replaces_id, hidden: row.selected === false };
}

/** Pictures the user answered "Hayır" for (they are skipped by the default pick). */
export function rejectedImageIds(feedback: readonly ContentFeedback[]): Set<Id> {
  return new Set(
    feedback
      .filter((f) => f.target_kind === IMAGE_TARGET && f.deleted_at === null && f.verdict === 'reject')
      .map((f) => f.target_id),
  );
}

/**
 * The picture a sense shows: none when hidden; the chosen one while it is still cached; else
 * the first in display order the user did not reject.
 */
export function pickImage<T extends Pick<CachedImage, 'status' | 'variant' | 'id'>>(
  rows: readonly T[],
  choice: ImageChoice,
  rejected: ReadonlySet<Id> = new Set(),
): T | null {
  if (choice.hidden) return null;
  if (choice.imageId) {
    const chosen = rows.find((r) => r.id === choice.imageId);
    if (chosen) return chosen;
  }
  return orderImages(rows).find((r) => !rejected.has(r.id)) ?? null;
}

/** Size of a cached picture in bytes (UTF-8; stored SVG is ASCII after sanitizing). */
export const imageBytes = (row: Pick<CachedImage, 'svg'>): number => row.svg.length;

/**
 * What to drop so the cache fits `capBytes`: first pictures not in `keep` (pictures cards show
 * win over extra variants), then the rest; within each group the least recently fetched and
 * then the largest go first. Returns ids to delete.
 */
export function planEviction(
  rows: readonly Pick<CachedImage, 'id' | 'svg' | 'fetched_at'>[],
  keep: ReadonlySet<Id>,
  capBytes: number = IMAGE_CACHE_CAP_BYTES,
): Id[] {
  let total = rows.reduce((n, r) => n + imageBytes(r), 0);
  if (total <= capBytes) return [];
  const order = [...rows].sort(
    (a, b) =>
      Number(keep.has(a.id)) - Number(keep.has(b.id)) ||
      a.fetched_at - b.fetched_at ||
      imageBytes(b) - imageBytes(a) ||
      a.id.localeCompare(b.id),
  );
  const out: Id[] = [];
  for (const r of order) {
    if (total <= capBytes) break;
    out.push(r.id);
    total -= imageBytes(r);
  }
  return out;
}

/** One row of the lightweight listing a fetch starts with (no SVG). */
export interface ImageManifestRow {
  id: Id;
  sense_id: Id;
  variant: number;
  status: string;
  created_at: string;
}

export interface ManifestDiff {
  /** Pictures to download (new on the server, or not cached yet). */
  download: Id[];
  /** Cached pictures whose status changed ('review' → 'approved'). */
  statusChanges: { id: Id; status: CachedImageStatus }[];
  /** Cached pictures to drop: gone or rejected on the server, or their sense left the cards. */
  remove: Id[];
}

/**
 * Compare the server listing for `senseIds` with the cache. A cached picture of a sense outside
 * `senseIds` is removed (the user no longer has a card for it).
 */
export function diffManifest(
  cached: readonly Pick<CachedImage, 'id' | 'sense_id' | 'status'>[],
  manifest: readonly ImageManifestRow[],
  senseIds: ReadonlySet<Id>,
): ManifestDiff {
  const remote = new Map<Id, CachedImageStatus>();
  for (const m of manifest) {
    if (!senseIds.has(m.sense_id)) continue;
    if (m.status === 'approved' || m.status === 'review') remote.set(m.id, m.status);
  }
  const local = new Map(cached.map((c) => [c.id, c]));
  const download: Id[] = [];
  const statusChanges: ManifestDiff['statusChanges'] = [];
  for (const [id, status] of remote) {
    const have = local.get(id);
    if (!have) download.push(id);
    else if (have.status !== status) statusChanges.push({ id, status });
  }
  const remove = cached.filter((c) => !remote.has(c.id)).map((c) => c.id);
  return { download, statusChanges, remove };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The `src` of an <img> for a sanitized picture in a theme: the dark swap of the contract, and
 * the SVG namespace (an <img> needs it; the sanitizer's allowlist may drop it). Scripts never
 * run in an <img>, and the SVG never enters the DOM as markup.
 */
export function pictureDataUrl(sanitizedSvg: string, theme: 'light' | 'dark'): string {
  let svg = svgForTheme(sanitizedSvg, theme);
  if (!/^<svg\b[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A reject reason from user_content.context, or null for anything else. */
export function reasonOf(value: string | null | undefined): ImageRejectReason | null {
  return (IMAGE_REJECT_REASONS as readonly string[]).includes(value ?? '') ? (value as ImageRejectReason) : null;
}
