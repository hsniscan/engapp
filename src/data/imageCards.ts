// Picture cards, "Görselden hatırlama" (v0.4 İP8, docs/decisions/0036-image-card.md), data side.
// The rule lives in domain/imageCards.ts; this module gathers the rows (senses, notes, picture
// cards, the picture cache and the user's choice / verdict rows), applies the plan in one
// transaction and answers "can this picture card be shown now?" for the queue. Picture cards
// are ordinary synced cards (card_type 'image'); their answers are ordinary review logs.
import { choiceOf, IMAGE_CHOICE_KIND, IMAGE_TARGET, rejectedImageIds, type CachedImage } from '../domain/images';
import {
  emptyPlan,
  imageCardPicture,
  imageCardRowId,
  imageCardsEnabled,
  pictureStateOf,
  planImageCards,
  type ImageCardPlan,
  type PictureState,
} from '../domain/imageCards';
import { emptyFsrs } from '../domain/fsrs';
import { primaryRecognition } from '../domain/leech';
import { deriveUnlocked, recognitionUnlocks } from '../domain/recompute';
import type { Card, Id, Millis, NoteTermType, Sense, UserContent } from '../domain/types';
import { db } from './db';
import { getSettings, updateSettings } from './settings';
import { writeTx } from './writer';

/** Tables a plan reads (a transaction that calls planNow must include them). */
const readTables = () => [db.settings, db.senses, db.notes, db.cards, db.images, db.user_content, db.content_feedback];

export interface ReconcileOptions {
  /** Only these senses (the user's sense ids); default every sense. */
  senseIds?: readonly Id[];
  /**
   * Lexicon sense ids the server was just asked about and listed no picture for (a fetch):
   * with nothing cached, their picture cards go. Without it an empty cache means "unknown".
   */
  serverHasNone?: ReadonlySet<Id>;
}

interface PictureLookup {
  rowsOf: (lexiconSenseId: Id) => CachedImage[];
  choiceOf: (senseId: Id) => ReturnType<typeof choiceOf>;
  rejected: Set<Id>;
}

/** The picture cache and the user's picture rows, for the given lexicon senses (all when null). */
async function pictureLookup(lexiconSenseIds: readonly Id[] | null): Promise<PictureLookup> {
  const images =
    lexiconSenseIds === null
      ? await db.images.toArray()
      : lexiconSenseIds.length
        ? await db.images.where('sense_id').anyOf([...lexiconSenseIds]).toArray()
        : [];
  const bySense = new Map<Id, CachedImage[]>();
  for (const r of images) {
    const list = bySense.get(r.sense_id);
    if (list) list.push(r);
    else bySense.set(r.sense_id, [r]);
  }
  const choices = new Map<Id, UserContent>();
  for (const r of await db.user_content.where('kind').equals(IMAGE_CHOICE_KIND).toArray()) {
    if (r.deleted_at !== null || !r.sense_id) continue;
    const prev = choices.get(r.sense_id);
    if (!prev || prev.updated_at < r.updated_at) choices.set(r.sense_id, r);
  }
  const feedback = await db.content_feedback
    .where('[target_kind+target_id]')
    .between([IMAGE_TARGET, ''], [IMAGE_TARGET, '￿'])
    .toArray();
  return {
    rowsOf: (id) => bySense.get(id) ?? [],
    choiceOf: (id) => choiceOf(choices.get(id)),
    rejected: rejectedImageIds(feedback),
  };
}

interface PlanNow {
  plan: ImageCardPlan;
  senses: Map<Id, Sense>;
  cards: Map<Id, Card>;
}

/** Reads only (no hashing): safe inside a transaction over readTables(). */
async function planNow(opts: ReconcileOptions): Promise<PlanNow> {
  const settings = await getSettings();
  const imageCards = await db.cards.where('card_type').equals('image').toArray();
  let senses: Sense[];
  if (opts.senseIds) {
    senses = (await db.senses.bulkGet([...opts.senseIds])).filter((s): s is Sense => !!s);
  } else {
    const withCard = new Set(imageCards.map((c) => c.sense_id).filter((x): x is Id => !!x));
    senses = await db.senses.filter((s) => !!s.lexicon_sense_id || withCard.has(s.id)).toArray();
  }
  const noteIds = [...new Set(senses.map((s) => s.note_id))];
  const notes = (await db.notes.bulkGet(noteIds)).filter((n) => !!n && n.deleted_at === null);
  const liveNotes = new Map<Id, NoteTermType>(notes.map((n) => [n!.id, n!.term_type]));
  const lexIds = [...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x))];
  const lookup = await pictureLookup(opts.senseIds ? lexIds : null);
  const pictures = new Map<Id, PictureState>();
  for (const s of senses) {
    if (!s.lexicon_sense_id) continue;
    pictures.set(
      s.id,
      pictureStateOf(
        lookup.rowsOf(s.lexicon_sense_id),
        lookup.choiceOf(s.id),
        lookup.rejected,
        opts.serverHasNone?.has(s.lexicon_sense_id) ?? false,
      ),
    );
  }
  const senseIds = new Set(senses.map((s) => s.id));
  const cards = imageCards.filter((c) => c.sense_id && senseIds.has(c.sense_id));
  const plan = planImageCards({ enabled: imageCardsEnabled(settings), senses, liveNotes, cards, pictures });
  return { plan, senses: new Map(senses.map((s) => [s.id, s])), cards: new Map(cards.map((c) => [c.id, c])) };
}

/**
 * Bring picture cards in line with the rule (domain/imageCards.ts): create a card for a sense
 * whose picture became available, bring back one whose picture came back, remove (tombstone)
 * the ones whose picture is hidden, rejected or gone, or all of them when the setting is off.
 * Review logs are never touched. Returns what it did.
 */
export async function reconcileImageCards(opts: ReconcileOptions = {}, now: Millis = Date.now()): Promise<ImageCardPlan> {
  const first = await db.transaction('r', readTables(), () => planNow(opts));
  if (emptyPlan(first.plan)) return first.plan;
  // The derived ids need hashing, which cannot run inside a Dexie transaction.
  const ids = new Map<Id, Id>();
  for (const senseId of first.plan.create) ids.set(senseId, await imageCardRowId(senseId));

  return writeTx(readTables(), now, async (w) => {
    const { plan, senses, cards } = await planNow(opts);
    const done: ImageCardPlan = { create: [], revive: [], remove: [] };
    const recognitionState = async (noteId: Id) =>
      primaryRecognition(await db.cards.where('note_id').equals(noteId).toArray()) ?? null;
    for (const senseId of plan.create) {
      const id = ids.get(senseId);
      const sense = senses.get(senseId);
      // Planned between the two reads: the next run makes it.
      if (!id || !sense) continue;
      // The derived id may already be taken by a tombstone the plan did not see (another sense
      // never has it); bring it back instead of overwriting its history.
      const existing = await db.cards.get(id);
      const state = await recognitionState(sense.note_id);
      if (existing) {
        await w.put('cards', { ...existing, deleted_at: null, unlocked: deriveUnlocked(existing, state) });
      } else {
        await w.put('cards', {
          ...w.base(id),
          note_id: sense.note_id,
          sense_id: sense.id,
          card_type: 'image',
          suspended: false,
          unlocked: recognitionUnlocks(state),
          ...emptyFsrs(w.now),
        } satisfies Card);
      }
      done.create.push(senseId);
    }
    for (const cardId of plan.revive) {
      const card = cards.get(cardId)!;
      await w.put('cards', { ...card, deleted_at: null, unlocked: deriveUnlocked(card, await recognitionState(card.note_id)) });
      done.revive.push(cardId);
    }
    for (const cardId of plan.remove) {
      await w.put('cards', { ...cards.get(cardId)!, deleted_at: w.now });
      done.remove.push(cardId);
    }
    return done;
  });
}

/**
 * A cheap fingerprint of what the plan depends on (index counts only, no picture is read): a run
 * with nothing new can skip the plan. Changes when senses, pictures, picture cards, picture
 * choices or verdicts are added or removed, or the setting changes.
 */
export async function imageCardsSignature(): Promise<string> {
  return db.transaction('r', [db.settings, db.senses, db.images, db.cards, db.user_content, db.content_feedback], async () => {
    const settings = await getSettings();
    const parts = await Promise.all([
      db.senses.count(),
      db.images.count(),
      db.cards.where('card_type').equals('image').count(),
      db.user_content.where('kind').equals(IMAGE_CHOICE_KIND).count(),
      db.content_feedback.where('[target_kind+target_id]').between([IMAGE_TARGET, ''], [IMAGE_TARGET, '\uffff']).count(),
    ]);
    return [imageCardsEnabled(settings), ...parts].join('|');
  });
}

/** Turn picture cards on or off (Ayarlar), then add or remove the cards at once. */
export async function setImageCardsEnabled(enabled: boolean, now: Millis = Date.now()): Promise<ImageCardPlan> {
  await updateSettings({ image_cards: enabled }, now);
  return reconcileImageCards({}, now);
}

/**
 * Picture cards among `cards` whose picture is not on this device (offline before the fetch,
 * evicted, refused): the session skips them instead of showing a card without its question.
 * Reads images, senses, user_content and content_feedback; safe inside a transaction over them.
 */
export async function imageCardsWithoutPicture(cards: readonly Pick<Card, 'id' | 'card_type' | 'sense_id'>[]): Promise<Set<Id>> {
  const out = new Set<Id>();
  const pictureCards = cards.filter((c) => c.card_type === 'image');
  if (!pictureCards.length) return out;
  const senses = await db.senses.bulkGet(pictureCards.map((c) => c.sense_id ?? ''));
  const lexIds = [...new Set(senses.map((s) => s?.lexicon_sense_id).filter((x): x is Id => !!x))];
  const lookup = await pictureLookup(lexIds);
  pictureCards.forEach((c, i) => {
    const s = senses[i];
    const ok = !!s?.lexicon_sense_id && !!imageCardPicture(lookup.rowsOf(s.lexicon_sense_id), lookup.choiceOf(s.id), lookup.rejected);
    if (!ok) out.add(c.id);
  });
  return out;
}

