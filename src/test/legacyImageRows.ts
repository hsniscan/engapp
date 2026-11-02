// Test helpers: the picture rows an older app version wrote ("Bunu kullan", Evet / Hayır),
// written straight into Dexie. The app no longer writes them (v0.5.2, ADR 0061), but synced
// rows still decide which picture a card shows, so the tests need them.
import { db } from '@/data/db';
import { feedbackRowId } from '@/domain/examples';
import { IMAGE_CHOICE_KIND, IMAGE_REASON_KIND, IMAGE_TARGET, imageChoiceRowId, imageReasonRowId, type ImageRejectReason } from '@/domain/images';
import type { Id, Millis, Sense } from '@/domain/types';

const sync = (now: Millis, deleted: Millis | null) => ({
  user_id: 'user-1',
  hlc: `${now}-legacy`,
  created_at: now,
  updated_at: now,
  deleted_at: deleted,
});

/** "Bunu kullan": the sense shows `imageId`. `deleted` makes it a tombstone. */
export async function putLegacyChoice(sense: Pick<Sense, 'id' | 'lexicon_sense_id'>, imageId: Id, now: Millis, deleted: Millis | null = null): Promise<void> {
  await db.user_content.put({
    id: await imageChoiceRowId(sense.id),
    kind: IMAGE_CHOICE_KIND,
    lexicon_sense_id: sense.lexicon_sense_id ?? null,
    sense_id: sense.id,
    context: 'chosen',
    replaces_id: imageId,
    text: 'chosen',
    translations: null,
    span: null,
    selected: true,
    ...sync(now, deleted),
  });
}

/** Evet ('like') / Hayır ('reject' with a reason). `deleted` takes the answer back. */
export async function putLegacyVerdict(
  sense: Pick<Sense, 'id' | 'lexicon_sense_id'>,
  imageId: Id,
  verdict: 'like' | 'reject',
  reason: ImageRejectReason | null,
  now: Millis,
  deleted: Millis | null = null,
): Promise<void> {
  await db.content_feedback.put({
    id: await feedbackRowId(IMAGE_TARGET, imageId),
    target_kind: IMAGE_TARGET,
    target_id: imageId,
    verdict,
    ...sync(now, deleted),
  });
  if (verdict === 'reject' && reason) {
    await db.user_content.put({
      id: await imageReasonRowId(imageId),
      kind: IMAGE_REASON_KIND,
      lexicon_sense_id: sense.lexicon_sense_id ?? null,
      sense_id: sense.id,
      context: reason,
      replaces_id: imageId,
      text: reason,
      translations: null,
      span: null,
      selected: false,
      ...sync(now, deleted),
    });
  }
}
