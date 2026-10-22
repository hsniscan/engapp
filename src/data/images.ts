// Pictures on the device (v0.4 İP3, docs/decisions/0031-images-in-app.md): the cache of shared
// pictures (Dexie `images`, read-only copies of public.lexicon_images rows, never synced) and
// the user's own choice, hide flag and verdicts. The user's rows are user_content (kind
// 'image_choice', one per sense of the user; kind 'image_feedback', the reason of a "Hayır")
// and content_feedback (target_kind 'image'); they sync to the user's account only and are
// never copied to another account. Nothing here writes to a shared table.
import {
  choiceOf,
  IMAGE_CHOICE_KIND,
  IMAGE_REASON_KIND,
  IMAGE_TARGET,
  imageBytes,
  imageChoiceRowId,
  imageReasonRowId,
  orderImages,
  pickImage,
  planEviction,
  reasonOf,
  rejectedImageIds,
  type CachedImage,
  type CachedImageStatus,
  type ImageChoice,
  type ImageRejectReason,
  type ManifestDiff,
} from '../domain/images';
import type { ContentFeedback, Id, Millis, Sense, UserContent } from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { feedbackRowId } from '../domain/examples';
import { imageCardPicture } from '../domain/imageCards';
import { reconcileImageCards } from './imageCards';
import { writeTx } from './writer';

// ------------------------------------------------------------------ reading (no hashing: safe in live queries and transactions)

async function choiceRow(sense: Pick<Sense, 'id' | 'lexicon_sense_id'>): Promise<UserContent | null> {
  if (!sense.lexicon_sense_id) return null;
  const rows = await db.user_content
    .where('lexicon_sense_id')
    .equals(sense.lexicon_sense_id)
    .filter((r) => r.kind === IMAGE_CHOICE_KIND && r.sense_id === sense.id && r.deleted_at === null)
    .toArray();
  return rows.sort((a, b) => b.updated_at - a.updated_at)[0] ?? null;
}

async function imageFeedback(imageIds: readonly Id[]): Promise<ContentFeedback[]> {
  if (!imageIds.length) return [];
  return db.content_feedback
    .where('[target_kind+target_id]')
    .anyOf(imageIds.map((id) => [IMAGE_TARGET, id]))
    .filter((f) => f.deleted_at === null)
    .toArray();
}

/** The picture a card shows for one sense of the user. */
export interface CardImage {
  /** lexicon_images.id */
  id: Id;
  /** Sanitized when it was cached; the screen sanitizes it again before it is shown. */
  svg: string;
  alt: string;
  /** Not yet looked at by a person: shown with a "Yeni" badge. */
  isNew: boolean;
}

/**
 * The picture of `sense` for a card, or null (no lexicon sense, nothing cached, hidden). Reads
 * only: callable inside getCardView's transaction (tables: images, user_content,
 * content_feedback). A picture card (v0.4 İP8) asks with `forImageCard`: then only the chosen
 * picture or an approved one counts (domain/imageCards.ts imageCardPicture).
 */
export async function cardImageOf(
  sense: Pick<Sense, 'id' | 'lexicon_sense_id'> | null,
  forImageCard = false,
): Promise<CardImage | null> {
  if (!sense?.lexicon_sense_id) return null;
  const rows = await db.images.where('sense_id').equals(sense.lexicon_sense_id).toArray();
  if (!rows.length) return null;
  const choice = choiceOf(await choiceRow(sense));
  if (choice.hidden) return null;
  const rejected = rejectedImageIds(await imageFeedback(rows.map((r) => r.id)));
  const picked = forImageCard ? imageCardPicture(rows, choice, rejected) : pickImage(rows, choice, rejected);
  return picked && { id: picked.id, svg: picked.svg, alt: picked.alt_tr, isNew: picked.status === 'review' };
}

/** Everything the "Görsel" section of the word detail shows for one sense of the user. */
export interface SenseImagesView {
  senseId: Id;
  /** null: the sense is not in the shared lexicon (no picture can be drawn for it). */
  lexiconSenseId: Id | null;
  /** Every cached picture of the sense, in display order. */
  images: CachedImage[];
  /** The one cards show (null: none, or hidden). */
  shown: CachedImage | null;
  choice: ImageChoice;
  /** The user's "Bu görsel anlamı anlatıyor mu?" answers, by picture id. */
  verdicts: Record<Id, 'like' | 'reject'>;
  /** The reason of each "Hayır", by picture id. */
  reasons: Record<Id, ImageRejectReason>;
}

export async function getSenseImages(senseId: Id): Promise<SenseImagesView | null> {
  const sense = await db.senses.get(senseId);
  if (!sense || sense.deleted_at !== null) return null;
  const lexiconSenseId = sense.lexicon_sense_id ?? null;
  const empty: SenseImagesView = {
    senseId,
    lexiconSenseId,
    images: [],
    shown: null,
    choice: { imageId: null, hidden: false },
    verdicts: {},
    reasons: {},
  };
  if (!lexiconSenseId) return empty;
  const images = orderImages(await db.images.where('sense_id').equals(lexiconSenseId).toArray());
  const choice = choiceOf(await choiceRow(sense));
  const feedback = await imageFeedback(images.map((i) => i.id));
  const verdicts: SenseImagesView['verdicts'] = {};
  for (const f of feedback) if (f.verdict === 'like' || f.verdict === 'reject') verdicts[f.target_id] = f.verdict;
  const reasons: SenseImagesView['reasons'] = {};
  const reasonRows = await db.user_content
    .where('lexicon_sense_id')
    .equals(lexiconSenseId)
    .filter((r) => r.kind === IMAGE_REASON_KIND && r.deleted_at === null)
    .toArray();
  for (const r of reasonRows) {
    const reason = reasonOf(r.context);
    if (r.replaces_id && reason && verdicts[r.replaces_id] === 'reject') reasons[r.replaces_id] = reason;
  }
  return { ...empty, images, choice, verdicts, reasons, shown: pickImage(images, choice, rejectedImageIds(feedback)) };
}

/** Lexicon sense ids of the user's live senses: the pictures the cache should hold. */
export async function listImageSenseIds(): Promise<Id[]> {
  const ids = new Set<Id>();
  await db.senses.each((s) => {
    if (s.deleted_at === null && s.lexicon_sense_id) ids.add(s.lexicon_sense_id);
  });
  return [...ids].sort();
}

/** Cached pictures without their SVG (a fetch compares them with the server's listing). */
export async function listCachedImageKeys(): Promise<Pick<CachedImage, 'id' | 'sense_id' | 'status'>[]> {
  const out: Pick<CachedImage, 'id' | 'sense_id' | 'status'>[] = [];
  await db.images.each((r) => out.push({ id: r.id, sense_id: r.sense_id, status: r.status }));
  return out;
}

export async function getImageCacheStats(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  await db.images.each((r) => {
    count++;
    bytes += imageBytes(r);
  });
  return { count, bytes };
}

// ------------------------------------------------------------------ the cache

/** Ids of the pictures cards show now (kept first when the cache is over its cap). */
async function shownImageIds(): Promise<Set<Id>> {
  const bySense = new Map<Id, CachedImage[]>();
  await db.images.each((r) => {
    const list = bySense.get(r.sense_id);
    if (list) list.push(r);
    else bySense.set(r.sense_id, [r]);
  });
  const choices = (await db.user_content.where('kind').equals(IMAGE_CHOICE_KIND).toArray()).filter((r) => r.deleted_at === null);
  const rejected = rejectedImageIds(
    (await db.content_feedback.where('[target_kind+target_id]').between([IMAGE_TARGET, ''], [IMAGE_TARGET, '￿']).toArray()),
  );
  const keep = new Set<Id>();
  const senses = (await db.senses.toArray()).filter((s) => s.deleted_at === null && s.lexicon_sense_id);
  for (const s of senses) {
    const rows = bySense.get(s.lexicon_sense_id!);
    if (!rows) continue;
    const choice = choiceOf(choices.find((c) => c.sense_id === s.id));
    const picked = pickImage(rows, choice.hidden ? { imageId: null, hidden: false } : choice, rejected);
    if (picked) keep.add(picked.id);
  }
  return keep;
}

export interface ImageFetchResult {
  added: number;
  removed: number;
  updated: number;
  evicted: number;
}

/**
 * Apply one fetch: drop what the server no longer lists, update statuses, store the new
 * pictures (already sanitized: domain/images.ts toCachedImage), then evict down to the cap.
 */
export async function applyImageFetch(
  diff: Pick<ManifestDiff, 'remove' | 'statusChanges'>,
  downloaded: readonly CachedImage[],
  capBytes?: number,
): Promise<ImageFetchResult> {
  return db.transaction('rw', [db.images, db.senses, db.user_content, db.content_feedback], async () => {
    if (diff.remove.length) await db.images.bulkDelete([...diff.remove]);
    let updated = 0;
    for (const c of diff.statusChanges) updated += await db.images.update(c.id, { status: c.status });
    if (downloaded.length) await db.images.bulkPut([...downloaded]);
    const all = await db.images.toArray();
    const evict = planEviction(all, await shownImageIds(), capBytes);
    if (evict.length) await db.images.bulkDelete(evict);
    return { added: downloaded.length, removed: diff.remove.length, updated, evicted: evict.length };
  });
}

/** A picture drawn on request ("Görsel üret" / "Yeniden üret"), or one the fetch missed. */
export async function storeImage(row: CachedImage): Promise<void> {
  await db.images.put(row);
}

// ------------------------------------------------------------------ the user's choice

async function liveSense(senseId: Id): Promise<Sense> {
  const sense = await db.senses.get(senseId);
  if (!sense || sense.deleted_at !== null) throw new ActionError('not_found', 'sense');
  return sense;
}

async function putChoice(
  sense: Sense,
  rowId: Id,
  next: { imageId: Id | null; hidden: boolean } | null,
  now: Millis,
): Promise<void> {
  await writeTx([db.user_content], now, async (w) => {
    const existing = await db.user_content.get(rowId);
    if (next === null) {
      if (existing && existing.deleted_at === null) await w.put('user_content', { ...existing, deleted_at: now });
      return;
    }
    const context = next.hidden ? 'hidden' : 'chosen';
    await w.put('user_content', {
      ...(existing ?? w.base(rowId)),
      user_id: existing?.user_id ?? w.userId,
      kind: IMAGE_CHOICE_KIND,
      lexicon_sense_id: sense.lexicon_sense_id ?? null,
      sense_id: sense.id,
      context,
      replaces_id: next.imageId,
      text: context,
      translations: null,
      span: null,
      selected: !next.hidden,
      deleted_at: null,
    });
  });
}

/** "Bunu kullan": this sense shows `imageId` (and the picture is no longer hidden). */
export async function chooseImage(senseId: Id, imageId: Id, now: Millis = Date.now()): Promise<void> {
  const sense = await liveSense(senseId);
  const image = await db.images.get(imageId);
  if (!image || image.sense_id !== sense.lexicon_sense_id) throw new ActionError('not_found', 'image');
  // Choosing a picture the user had said "Hayır" to takes that answer back.
  const fbId = await feedbackRowId(IMAGE_TARGET, imageId);
  const reasonId = await imageReasonRowId(imageId);
  const fb = await db.content_feedback.get(fbId);
  if (fb && fb.deleted_at === null && fb.verdict === 'reject') await writeVerdict(sense, imageId, null, null, fbId, reasonId, now);
  await putChoice(sense, await imageChoiceRowId(senseId), { imageId, hidden: false }, now);
  await reconcileImageCards({ senseIds: [senseId] }, now);
}

/** "Görseli gizle" (true) / "Görseli göster" (false). The picked picture is remembered. */
export async function setImageHidden(senseId: Id, hidden: boolean, now: Millis = Date.now()): Promise<void> {
  const sense = await liveSense(senseId);
  const rowId = await imageChoiceRowId(senseId);
  const current = choiceOf(await db.user_content.get(rowId));
  await putChoice(
    sense,
    rowId,
    hidden ? { imageId: current.imageId, hidden: true } : current.imageId ? { imageId: current.imageId, hidden: false } : null,
    now,
  );
  // v0.4 İP8: a hidden picture takes its picture card away; showing it again brings it back.
  await reconcileImageCards({ senseIds: [senseId] }, now);
}

async function writeVerdict(
  sense: Sense,
  imageId: Id,
  verdict: 'like' | 'reject' | null,
  reason: ImageRejectReason | null,
  fbId: Id,
  reasonId: Id,
  now: Millis,
): Promise<void> {
  await writeTx([db.content_feedback, db.user_content], now, async (w) => {
    const fb = await db.content_feedback.get(fbId);
    if (verdict === null) {
      if (fb && fb.deleted_at === null) await w.put('content_feedback', { ...fb, deleted_at: now });
    } else if (!(fb && fb.deleted_at === null && fb.verdict === verdict)) {
      await w.put('content_feedback', {
        ...(fb ?? w.base(fbId)),
        user_id: fb?.user_id ?? w.userId,
        target_kind: IMAGE_TARGET,
        target_id: imageId,
        verdict,
        deleted_at: null,
      });
    }
    const r = await db.user_content.get(reasonId);
    if (verdict === 'reject' && reason) {
      if (!(r && r.deleted_at === null && r.context === reason)) {
        await w.put('user_content', {
          ...(r ?? w.base(reasonId)),
          user_id: r?.user_id ?? w.userId,
          kind: IMAGE_REASON_KIND,
          lexicon_sense_id: sense.lexicon_sense_id ?? null,
          sense_id: sense.id,
          context: reason,
          replaces_id: imageId,
          text: reason,
          translations: null,
          span: null,
          selected: false,
          deleted_at: null,
        });
      }
    } else if (r && r.deleted_at === null) {
      await w.put('user_content', { ...r, deleted_at: now });
    }
  });
}

/**
 * "Bu görsel anlamı anlatıyor mu?": Evet ('like'), Hayır ('reject', with a reason), or null to
 * take the answer back. A "Hayır" for the picked picture drops the pick, so the card falls back
 * to the next picture. Returns whether it did (for "Geri al").
 */
export async function setImageVerdict(
  senseId: Id,
  imageId: Id,
  verdict: 'like' | 'reject' | null,
  reason: ImageRejectReason | null = null,
  now: Millis = Date.now(),
): Promise<{ clearedChoice: boolean }> {
  const sense = await liveSense(senseId);
  const choiceId = await imageChoiceRowId(senseId);
  const fbId = await feedbackRowId(IMAGE_TARGET, imageId);
  const reasonId = await imageReasonRowId(imageId);
  await writeVerdict(sense, imageId, verdict, verdict === 'reject' ? reason : null, fbId, reasonId, now);
  const choice = choiceOf(await db.user_content.get(choiceId));
  const clearedChoice = verdict === 'reject' && choice.imageId === imageId;
  if (clearedChoice) await putChoice(sense, choiceId, choice.hidden ? { imageId: null, hidden: true } : null, now);
  // v0.4 İP8: a "Hayır" for the last usable picture takes the picture card away (and undo back).
  await reconcileImageCards({ senseIds: [senseId] }, now);
  return { clearedChoice };
}

/** "Geri al" after a "Hayır": the answer goes, and the pick comes back if it was dropped. */
export async function undoImageReject(
  senseId: Id,
  imageId: Id,
  opts: { restoreChoice: boolean },
  now: Millis = Date.now(),
): Promise<void> {
  await setImageVerdict(senseId, imageId, null, null, now);
  if (opts.restoreChoice) await chooseImage(senseId, imageId, now);
}

export type { CachedImage, CachedImageStatus };
