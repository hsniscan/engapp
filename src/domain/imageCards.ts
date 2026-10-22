// Picture cards, "Görselden hatırlama" (v0.4 İP8, docs/decisions/0036-image-card.md). Pure:
// which picture a picture card shows, what the device knows about a sense's picture, and which
// picture cards to create, bring back or remove. The data layer (data/imageCards.ts) gathers
// the rows and applies the plan in one transaction.
//
// The rule:
//   - A sense has a picture card while picture cards are on (settings.image_cards, default on),
//     the sense and its note are live, the note is not recognition-only (root/affix, contrast),
//     the sense is in the shared lexicon, and it has a picture the card may show: the user's
//     chosen picture, else the first approved one the user did not reject. A picture still in
//     review never makes a card by itself; a hidden picture never does.
//   - The card is created locked and unlocks like the production card: when the note's
//     recognition card first reaches Review (domain/recompute.ts deriveUnlocked).
//   - Hiding the picture, rejecting every picture of the sense, the server dropping its pictures
//     or turning the setting off removes the card (a tombstone; its answers stay in review_logs
//     and come back with the card if the picture does).
//   - Nothing cached and no word from the server: unknown, the card is left as it is (a device
//     that has not fetched pictures yet must not remove cards another device made).
import { orderImages, type CachedImage, type ImageChoice } from './images';
import { contentRowId } from './examples';
import { recognitionOnly, type Card, type Id, type NoteTermType, type Sense, type Settings } from './types';

/** settings.image_cards: on unless the user turned it off. */
export const imageCardsEnabled = (s: Pick<Settings, 'image_cards'> | null | undefined): boolean => s?.image_cards !== false;

/**
 * The id of a sense's picture card is derived from the sense (UUID v8), so two devices that
 * both see the new picture write the same row instead of two cards.
 */
export const imageCardRowId = (senseId: Id): Promise<Id> => contentRowId(['cards', 'image', senseId]);

type PictureRow = Pick<CachedImage, 'id' | 'status' | 'variant'>;

/**
 * The picture a picture card shows: none when hidden; the chosen one while it is cached (any
 * status: the user picked it); else the first approved picture the user did not reject.
 */
export function imageCardPicture<T extends PictureRow>(
  rows: readonly T[],
  choice: ImageChoice,
  rejected: ReadonlySet<Id> = new Set(),
): T | null {
  if (choice.hidden) return null;
  if (choice.imageId) {
    const chosen = rows.find((r) => r.id === choice.imageId);
    if (chosen && !rejected.has(chosen.id)) return chosen;
  }
  return orderImages(rows).find((r) => r.status === 'approved' && !rejected.has(r.id)) ?? null;
}

/**
 * What this device knows about the picture of one sense:
 *   ready    a picture the card can show is cached
 *   refused  the user hid the picture, or rejected every cached picture
 *   none     no usable picture: only pictures in review are cached, or the server listed none
 *   unknown  nothing cached and the server was not asked (or not reached)
 */
export type PictureState = 'ready' | 'refused' | 'none' | 'unknown';

export function pictureStateOf(
  rows: readonly PictureRow[],
  choice: ImageChoice,
  rejected: ReadonlySet<Id>,
  /** The server's listing for this sense was just read and had no picture. */
  serverHasNone = false,
): PictureState {
  if (choice.hidden) return 'refused';
  if (imageCardPicture(rows, choice, rejected)) return 'ready';
  if (rows.length > 0) return rows.every((r) => rejected.has(r.id)) ? 'refused' : 'none';
  return serverHasNone ? 'none' : 'unknown';
}

export interface ImageCardPlanInput {
  /** imageCardsEnabled(settings). */
  enabled: boolean;
  senses: readonly Pick<Sense, 'id' | 'note_id' | 'lexicon_sense_id' | 'deleted_at'>[];
  /** Term type of each live note (deleted or missing notes are absent). */
  liveNotes: ReadonlyMap<Id, NoteTermType>;
  /** Every picture card row (live or not) of these senses. */
  cards: readonly Pick<Card, 'id' | 'sense_id' | 'card_type' | 'deleted_at' | 'updated_at'>[];
  /** Picture state per sense id (the user's sense); a missing entry is 'unknown'. */
  pictures: ReadonlyMap<Id, PictureState>;
}

export interface ImageCardPlan {
  /** Senses that get a new picture card. */
  create: Id[];
  /** Tombstoned picture cards to bring back (one per sense). */
  revive: Id[];
  /** Live picture cards to remove (tombstone). */
  remove: Id[];
}

export const emptyPlan = (p: ImageCardPlan): boolean => !p.create.length && !p.revive.length && !p.remove.length;

/** Whether the sense should have a picture card: true, false, or null (unknown: leave it). */
export function wantsImageCard(
  sense: Pick<Sense, 'note_id' | 'lexicon_sense_id' | 'deleted_at'>,
  termType: NoteTermType | undefined,
  enabled: boolean,
  picture: PictureState,
): boolean | null {
  if (!enabled || sense.deleted_at !== null || termType === undefined || recognitionOnly(termType)) return false;
  if (!sense.lexicon_sense_id) return false;
  switch (picture) {
    case 'ready':
      return true;
    case 'refused':
    case 'none':
      return false;
    default:
      return null;
  }
}

/** The changes that bring the senses' picture cards in line with the rule above. */
export function planImageCards(input: ImageCardPlanInput): ImageCardPlan {
  const bySense = new Map<Id, ImageCardPlanInput['cards'][number][]>();
  for (const c of input.cards) {
    if (c.card_type !== 'image' || !c.sense_id) continue;
    const list = bySense.get(c.sense_id);
    if (list) list.push(c);
    else bySense.set(c.sense_id, [c]);
  }
  const plan: ImageCardPlan = { create: [], revive: [], remove: [] };
  const seen = new Set<Id>();
  for (const s of input.senses) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const want = wantsImageCard(s, input.liveNotes.get(s.note_id), input.enabled, input.pictures.get(s.id) ?? 'unknown');
    if (want === null) continue;
    const rows = bySense.get(s.id) ?? [];
    const live = rows.filter((c) => c.deleted_at === null);
    if (want) {
      if (live.length > 0) continue;
      if (rows.length === 0) plan.create.push(s.id);
      else plan.revive.push([...rows].sort((a, b) => b.updated_at - a.updated_at || (a.id < b.id ? -1 : 1))[0]!.id);
    } else {
      for (const c of live) plan.remove.push(c.id);
    }
  }
  return plan;
}
