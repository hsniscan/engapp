import { beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_CHOICE_KIND, IMAGE_REASON_KIND, IMAGE_TARGET, type CachedImage } from '@/domain/images';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import {
  applyImageFetch,
  cardImageOf,
  chooseImage,
  getImageCacheStats,
  getSenseImages,
  listImageSenseIds,
  setImageHidden,
  setImageVerdict,
  storeImage,
  undoImageReject,
} from './images';
import { getCardView } from './queries';
import { updateSettings } from './settings';

const T = Date.UTC(2026, 9, 25, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const LEX2 = '0199f0a0-0000-7000-8000-00000000a002';
const id = (n: number) => `0199f0a0-0000-7000-8000-0000000b${String(n).padStart(4, '0')}`;

function img(n: number, p: Partial<CachedImage> = {}): CachedImage {
  return {
    id: id(n),
    sense_id: LEX,
    variant: n,
    svg: SAMPLE_PICTURES.apple.svg,
    alt_tr: `Elma ${n}`,
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    fetched_at: T,
    ...p,
  };
}

async function apple() {
  const res = await addNoteWithSenses(
    { term: 'apple', senses: [{ meaning_tr: 'elma', lexicon_sense_id: LEX, pos: 'noun' }] },
    T,
  );
  return res.note.id;
}

async function senseOf(noteId: string) {
  return (await db.senses.where('note_id').equals(noteId).toArray())[0]!;
}

beforeEach(async () => {
  await resetDb();
});

describe('picture of a card', () => {
  it('a card shows the first approved picture of its sense; the setting puts it on the front', async () => {
    const noteId = await apple();
    await storeImage(img(0, { status: 'review' }));
    await storeImage(img(1));
    const card = (await db.cards.where('note_id').equals(noteId).toArray()).find((c) => c.card_type === 'recognition')!;
    let view = await getCardView(card.id, T);
    expect(view?.image).toEqual({ id: id(1), svg: SAMPLE_PICTURES.apple.svg, alt: 'Elma 1', isNew: false });
    expect(view?.imageOnFront).toBe(false);
    await updateSettings({ show_image_front: true }, T);
    view = await getCardView(card.id, T);
    expect(view?.imageOnFront).toBe(true);
  });

  it('no lexicon sense or nothing cached: no picture', async () => {
    const res = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
    expect(await cardImageOf(await senseOf(res.note.id))).toBeNull();
    expect(await cardImageOf(await senseOf(await apple()))).toBeNull();
  });

  it('only a review picture: shown and marked new', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(3, { status: 'review' }));
    expect(await cardImageOf(sense)).toMatchObject({ id: id(3), isNew: true });
  });
});

describe("the user's choice", () => {
  it('"Bunu kullan" picks a variant; the choice is a synced user_content row of this sense', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0));
    await storeImage(img(1));
    await chooseImage(sense.id, id(1), T);
    expect((await cardImageOf(sense))?.id).toBe(id(1));
    const rows = await db.user_content.where('kind').equals(IMAGE_CHOICE_KIND).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sense_id: sense.id, lexicon_sense_id: LEX, replaces_id: id(1), selected: true, context: 'chosen' });
    expect(await db.outbox.where('table').equals('user_content').count()).toBeGreaterThan(0);
    // A picture of another sense cannot be chosen.
    await storeImage(img(9, { sense_id: LEX2 }));
    await expect(chooseImage(sense.id, id(9), T)).rejects.toThrow();
  });

  it('"Görseli gizle" hides it everywhere and "Göster" brings back the same pick', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0));
    await storeImage(img(1));
    await chooseImage(sense.id, id(1), T);
    await setImageHidden(sense.id, true, T + 1);
    expect(await cardImageOf(sense)).toBeNull();
    const view = await getSenseImages(sense.id);
    expect(view?.choice).toEqual({ imageId: id(1), hidden: true });
    expect(view?.shown).toBeNull();
    expect(view?.images.map((i) => i.id)).toEqual([id(0), id(1)]);
    await setImageHidden(sense.id, false, T + 2);
    expect((await cardImageOf(sense))?.id).toBe(id(1));
  });

  it('hiding without a pick, then showing again, leaves no row behind', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0));
    await setImageHidden(sense.id, true, T);
    expect(await cardImageOf(sense)).toBeNull();
    await setImageHidden(sense.id, false, T + 1);
    expect(await cardImageOf(sense)).not.toBeNull();
    const rows = await db.user_content.where('kind').equals(IMAGE_CHOICE_KIND).toArray();
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
  });
});

describe('"Bu görsel anlamı anlatıyor mu?"', () => {
  it('Evet is a like; Hayır with a reason skips the picture, drops the pick, and can be undone', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0));
    await storeImage(img(1));
    await chooseImage(sense.id, id(0), T);
    await setImageVerdict(sense.id, id(1), 'like', null, T + 1);
    let view = await getSenseImages(sense.id);
    expect(view?.verdicts).toEqual({ [id(1)]: 'like' });

    const { clearedChoice } = await setImageVerdict(sense.id, id(0), 'reject', 'wrong_meaning', T + 2);
    expect(clearedChoice).toBe(true);
    view = await getSenseImages(sense.id);
    expect(view?.verdicts[id(0)]).toBe('reject');
    expect(view?.reasons).toEqual({ [id(0)]: 'wrong_meaning' });
    expect(view?.shown?.id).toBe(id(1));
    const fb = await db.content_feedback.where('[target_kind+target_id]').equals([IMAGE_TARGET, id(0)]).first();
    expect(fb).toMatchObject({ verdict: 'reject', deleted_at: null });
    const reason = (await db.user_content.where('kind').equals(IMAGE_REASON_KIND).toArray())[0];
    expect(reason).toMatchObject({ context: 'wrong_meaning', replaces_id: id(0), sense_id: sense.id });

    await undoImageReject(sense.id, id(0), { restoreChoice: true }, T + 3);
    view = await getSenseImages(sense.id);
    expect(view?.verdicts[id(0)]).toBeUndefined();
    expect(view?.reasons).toEqual({});
    expect(view?.shown?.id).toBe(id(0));
  });

  it('choosing a picture takes a "Hayır" for it back', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0));
    await setImageVerdict(sense.id, id(0), 'reject', 'ugly', T);
    expect(await cardImageOf(sense)).toBeNull();
    await chooseImage(sense.id, id(0), T + 1);
    expect((await cardImageOf(sense))?.id).toBe(id(0));
    expect((await getSenseImages(sense.id))?.verdicts).toEqual({});
  });
});

describe('the cache', () => {
  it('lists the lexicon senses of live senses only', async () => {
    await apple();
    const res = await addNoteWithSenses({ term: 'bridge', senses: [{ meaning_tr: 'köprü', lexicon_sense_id: LEX2 }] }, T);
    expect(await listImageSenseIds()).toEqual([LEX, LEX2].sort());
    await db.senses.update((await senseOf(res.note.id)).id, { deleted_at: T });
    expect(await listImageSenseIds()).toEqual([LEX]);
  });

  it('applies a fetch and keeps the shown pictures when over the cap', async () => {
    const sense = await senseOf(await apple());
    await storeImage(img(0, { status: 'review', fetched_at: 1 }));
    await storeImage(img(5, { fetched_at: 2 }));
    await chooseImage(sense.id, id(5), T);
    const size = SAMPLE_PICTURES.apple.svg.length;
    const res = await applyImageFetch(
      { remove: [], statusChanges: [{ id: id(0), status: 'approved' }] },
      [img(1, { fetched_at: 3 }), img(2, { fetched_at: 4 })],
      size * 2,
    );
    expect(res).toEqual({ added: 2, removed: 0, updated: 1, evicted: 2 });
    const left = (await db.images.toArray()).map((r) => r.id).sort();
    // The chosen picture stays; of the rest only the most recently fetched one.
    expect(left).toEqual([id(2), id(5)].sort());
    expect(await getImageCacheStats()).toEqual({ count: 2, bytes: size * 2 });
    await applyImageFetch({ remove: [id(2)], statusChanges: [] }, []);
    expect(await db.images.count()).toBe(1);
  });
});
