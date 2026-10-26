import { beforeEach, describe, expect, it } from 'vitest';
import type { CachedImage } from '@/domain/images';
import { imageCardRowId } from '@/domain/imageCards';
import { CardState, Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { addNoteWithSenses, answerCard, setSuspended, softDeleteSense, undoAnswer } from './actions';
import { db } from './db';
import { imageCardsWithoutPicture, reconcileImageCards, setImageCardsEnabled } from './imageCards';
import { chooseImage, setImageHidden, setImageVerdict, storeImage, undoImageReject } from './images';
import { getCardView, getStudyQueue } from './queries';

const T = Date.UTC(2026, 9, 26, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
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

async function apple(termType?: 'affix') {
  const res = await addNoteWithSenses(
    { term: 'apple', term_type: termType, senses: [{ meaning_tr: 'elma', lexicon_sense_id: LEX, pos: 'noun' }] },
    T,
  );
  const sense = (await db.senses.where('note_id').equals(res.note.id).toArray())[0]!;
  const rec = res.createdCards.find((c) => c.card_type === 'recognition')!;
  const production = res.createdCards.find((c) => c.card_type === 'production');
  return { noteId: res.note.id, sense, rec, production };
}

const imageCards = async () => (await db.cards.where('card_type').equals('image').toArray()).sort((a, b) => a.created_at - b.created_at);
const liveImageCards = async () => (await imageCards()).filter((c) => c.deleted_at === null);

beforeEach(async () => {
  await resetDb();
});

describe('reconcileImageCards', () => {
  it('creates one locked picture card per sense with an approved picture, under an id every device derives', async () => {
    const { sense } = await apple();
    expect(await reconcileImageCards({}, T)).toEqual({ create: [], revive: [], remove: [] });
    await storeImage(img(0));
    const plan = await reconcileImageCards({}, T);
    expect(plan.create).toEqual([sense.id]);
    const [card] = await imageCards();
    expect(card).toMatchObject({
      id: await imageCardRowId(sense.id),
      card_type: 'image',
      sense_id: sense.id,
      unlocked: false,
      state: CardState.New,
      deleted_at: null,
    });
    // Synced like any card.
    expect((await db.outbox.toArray()).some((o) => o.table === 'cards' && o.row_id === card!.id)).toBe(true);
    // Running again changes nothing.
    expect(await reconcileImageCards({}, T + 1)).toEqual({ create: [], revive: [], remove: [] });
    expect(await imageCards()).toHaveLength(1);
  });

  it('acceptance 8: opens once the recognition card is Pekişiyor, then is studied like any card', async () => {
    const { rec, production } = await apple();
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    const [card] = await imageCards();
    let q = await getStudyQueue({}, T);
    expect(q.items.map((i) => i.card_id)).not.toContain(card!.id);

    // Learning model (decision 0041): reaching Review is not enough; the word must be recalled
    // again on another day (ramp_step 1, Pekişiyor) before its other cards open.
    const first = await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 3000 }, T);
    expect(first.card.state).toBe(CardState.Review);
    expect(first.unlockedCardIds).not.toContain(card!.id);
    const ans = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 3000 }, first.card.due);
    expect(ans.unlockedCardIds).toContain(card!.id);
    expect((await db.cards.get(card!.id))!.unlocked).toBe(true);
    const next = first.card.due + 86_400_000;

    // Tomorrow it is a new card (one card per note a day), counted against the new limit; the
    // production card of the same sense would come first, so it is set aside here.
    await setSuspended({ card_ids: [production!.id] }, true, T);
    q = await getStudyQueue({}, next);
    expect(q.items.find((i) => i.card_id === card!.id)?.kind).toBe('new');
    const view = await getCardView(card!.id, next);
    expect(view?.sense?.id).toBe(card!.sense_id);
    expect(view?.image).toMatchObject({ id: id(0), isNew: false });
    const res = await answerCard({ card_id: card!.id, rating: Rating.Good, duration_ms: 4000 }, next);
    expect(res.log.card_id).toBe(card!.id);
    expect(res.card.reps).toBe(1);

    // Undo on the recognition card re-locks nothing that was already studied.
    await undoAnswer(ans.log.id, next + 1);
    expect((await db.cards.get(card!.id))!.unlocked).toBe(true);
  });

  it('a picture in review alone makes no card; choosing it does', async () => {
    const { sense } = await apple();
    await storeImage(img(0, { status: 'review' }));
    await reconcileImageCards({}, T);
    expect(await imageCards()).toHaveLength(0);
    await chooseImage(sense.id, id(0), T);
    expect(await liveImageCards()).toHaveLength(1);
  });

  it('hiding the picture removes the card and showing it brings the same card back; logs are never touched', async () => {
    const { sense, rec } = await apple();
    await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 1000 }, T);
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    const [card] = await imageCards();
    await answerCard({ card_id: card!.id, rating: Rating.Good, duration_ms: 1000 }, T + 86_400_000);
    const logs = await db.review_logs.toArray();

    await setImageHidden(sense.id, true, T + 2 * 86_400_000);
    expect(await liveImageCards()).toHaveLength(0);
    expect((await db.cards.get(card!.id))!.deleted_at).not.toBeNull();

    await setImageHidden(sense.id, false, T + 3 * 86_400_000);
    const [back] = await liveImageCards();
    expect(back!.id).toBe(card!.id);
    expect(back!.reps).toBe(1);
    expect(await db.review_logs.toArray()).toEqual(logs);
  });

  it('"Hayır" for the only picture removes the card; undo brings it back; another picture keeps it', async () => {
    const { sense } = await apple();
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    await setImageVerdict(sense.id, id(0), 'reject', 'wrong_meaning', T + 1);
    expect(await liveImageCards()).toHaveLength(0);
    await undoImageReject(sense.id, id(0), { restoreChoice: false }, T + 2);
    expect(await liveImageCards()).toHaveLength(1);

    await storeImage(img(1));
    await setImageVerdict(sense.id, id(0), 'reject', 'ugly', T + 3);
    expect(await liveImageCards()).toHaveLength(1);
    const card = (await liveImageCards())[0]!;
    expect((await getCardView(card.id, T + 4))?.image?.id).toBe(id(1));
  });

  it('the setting turns every picture card off and on again', async () => {
    await apple();
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    await setImageCardsEnabled(false, T + 1);
    expect(await liveImageCards()).toHaveLength(0);
    expect((await db.settings.get('settings'))?.image_cards).toBe(false);
    await reconcileImageCards({}, T + 2);
    expect(await liveImageCards()).toHaveLength(0);
    await setImageCardsEnabled(true, T + 3);
    expect(await liveImageCards()).toHaveLength(1);
    expect(await imageCards()).toHaveLength(1);
  });

  it('an empty cache is "unknown" and changes nothing, unless the server just listed no picture', async () => {
    await apple();
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    await db.images.clear();
    expect(await reconcileImageCards({}, T + 1)).toEqual({ create: [], revive: [], remove: [] });
    expect(await liveImageCards()).toHaveLength(1);
    const plan = await reconcileImageCards({ serverHasNone: new Set([LEX]) }, T + 2);
    expect(plan.remove).toHaveLength(1);
    expect(await liveImageCards()).toHaveLength(0);
  });

  it('roots and affixes, senses outside the lexicon and deleted senses get no picture card', async () => {
    await apple('affix');
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    expect(await imageCards()).toHaveLength(0);

    await resetDb();
    const { sense } = await apple();
    await storeImage(img(0));
    await reconcileImageCards({}, T);
    await softDeleteSense(sense.id, T + 1);
    await reconcileImageCards({}, T + 2);
    expect(await liveImageCards()).toHaveLength(0);
  });
});

describe('picture missing on this device', () => {
  it('the queue leaves out a picture card whose picture is not cached (offline), and takes it back later', async () => {
    const { rec, production } = await apple();
    // Easy, then recalled again when due (Pekişiyor): the picture card opens.
    const first = await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 1000 }, T);
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, first.card.due);
    await setSuspended({ card_ids: [production!.id] }, true, T);
    await storeImage(img(0));
    await reconcileImageCards({}, first.card.due);
    const [card] = await imageCards();
    const tomorrow = first.card.due + 86_400_000;
    expect((await getStudyQueue({}, tomorrow)).items.map((i) => i.card_id)).toContain(card!.id);

    await db.images.clear();
    expect(await imageCardsWithoutPicture([card!])).toEqual(new Set([card!.id]));
    expect((await getStudyQueue({}, tomorrow)).items.map((i) => i.card_id)).not.toContain(card!.id);
    expect((await getCardView(card!.id, tomorrow))?.image).toBeNull();

    await storeImage(img(0));
    expect((await getStudyQueue({}, tomorrow)).items.map((i) => i.card_id)).toContain(card!.id);
  });
});
