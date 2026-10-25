import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  emptyPlan,
  imageCardPicture,
  imageCardRowId,
  imageCardsEnabled,
  pictureStateOf,
  planImageCards,
  wantsImageCard,
  type ImageCardPlanInput,
  type PictureState,
} from './imageCards';
import { deriveUnlocked } from './recompute';
import { RAMP_EPOCH } from './fsrsConfig';
import { CardState, type CardStateValue, type NoteTermType } from './types';

const pic = (id: string, status: 'approved' | 'review' = 'approved', variant = 0) => ({ id, status, variant });
const shown = { imageId: null, hidden: false };

describe('imageCardsEnabled', () => {
  it('is on by default and off only for a stored false', () => {
    expect(imageCardsEnabled(null)).toBe(true);
    expect(imageCardsEnabled({})).toBe(true);
    expect(imageCardsEnabled({ image_cards: null })).toBe(true);
    expect(imageCardsEnabled({ image_cards: true })).toBe(true);
    expect(imageCardsEnabled({ image_cards: false })).toBe(false);
  });
});

describe('imageCardPicture', () => {
  it('takes the first approved picture, never one in review by itself', () => {
    expect(imageCardPicture([pic('b', 'review', 0), pic('a', 'approved', 1)], shown)?.id).toBe('a');
    expect(imageCardPicture([pic('b', 'review')], shown)).toBeNull();
  });
  it('takes the chosen picture even in review, and never a hidden or rejected one', () => {
    expect(imageCardPicture([pic('a'), pic('b', 'review', 1)], { imageId: 'b', hidden: false })?.id).toBe('b');
    expect(imageCardPicture([pic('a')], { imageId: 'a', hidden: true })).toBeNull();
    expect(imageCardPicture([pic('a'), pic('c', 'approved', 1)], shown, new Set(['a']))?.id).toBe('c');
    expect(imageCardPicture([pic('a')], { imageId: 'a', hidden: false }, new Set(['a']))).toBeNull();
  });
});

describe('pictureStateOf', () => {
  it('tells ready, refused, none and unknown apart', () => {
    expect(pictureStateOf([pic('a')], shown, new Set())).toBe('ready');
    expect(pictureStateOf([pic('a')], { imageId: null, hidden: true }, new Set())).toBe('refused');
    expect(pictureStateOf([pic('a'), pic('b', 'approved', 1)], shown, new Set(['a', 'b']))).toBe('refused');
    expect(pictureStateOf([pic('a', 'review')], shown, new Set())).toBe('none');
    expect(pictureStateOf([], shown, new Set())).toBe('unknown');
    expect(pictureStateOf([], shown, new Set(), true)).toBe('none');
    // A hidden picture is refused even before anything was fetched.
    expect(pictureStateOf([], { imageId: null, hidden: true }, new Set())).toBe('refused');
  });
});

describe('wantsImageCard', () => {
  const sense = { note_id: 'n', lexicon_sense_id: 'lx', deleted_at: null };
  it('needs the setting, a live sense and note, a lexicon sense, a word note and a picture', () => {
    expect(wantsImageCard(sense, 'word', true, 'ready')).toBe(true);
    expect(wantsImageCard(sense, 'phrase', true, 'ready')).toBe(true);
    expect(wantsImageCard(sense, 'word', false, 'ready')).toBe(false);
    expect(wantsImageCard({ ...sense, deleted_at: 5 }, 'word', true, 'ready')).toBe(false);
    expect(wantsImageCard(sense, undefined, true, 'ready')).toBe(false);
    expect(wantsImageCard(sense, 'affix', true, 'ready')).toBe(false);
    expect(wantsImageCard(sense, 'contrast', true, 'ready')).toBe(false);
    expect(wantsImageCard({ ...sense, lexicon_sense_id: null }, 'word', true, 'ready')).toBe(false);
    expect(wantsImageCard(sense, 'word', true, 'refused')).toBe(false);
    expect(wantsImageCard(sense, 'word', true, 'none')).toBe(false);
    expect(wantsImageCard(sense, 'word', true, 'unknown')).toBeNull();
  });
});

describe('planImageCards', () => {
  const base = (p: Partial<ImageCardPlanInput> = {}): ImageCardPlanInput => ({
    enabled: true,
    senses: [{ id: 's1', note_id: 'n1', lexicon_sense_id: 'lx1', deleted_at: null }],
    liveNotes: new Map([['n1', 'word']]),
    cards: [],
    pictures: new Map([['s1', 'ready']]),
    ...p,
  });
  const card = (id: string, deleted_at: number | null, updated_at = 1) => ({
    id,
    sense_id: 's1',
    card_type: 'image' as const,
    deleted_at,
    updated_at,
  });

  it('creates a card when the picture becomes available', () => {
    expect(planImageCards(base())).toEqual({ create: ['s1'], revive: [], remove: [] });
  });
  it('leaves a live card alone and ignores the other card types', () => {
    const other = { ...card('p', null), card_type: 'production' as const };
    expect(emptyPlan(planImageCards(base({ cards: [card('c', null), other] })))).toBe(true);
    expect(planImageCards(base({ cards: [other] })).create).toEqual(['s1']);
  });
  it('revives the latest tombstoned card instead of making a second one', () => {
    expect(planImageCards(base({ cards: [card('old', 5, 5), card('new', 9, 9)] }))).toEqual({ create: [], revive: ['new'], remove: [] });
  });
  it('removes every live card when the picture is hidden or rejected, or the setting is off', () => {
    const cards = [card('c', null), card('reset-copy', null)];
    expect(planImageCards(base({ cards, pictures: new Map([['s1', 'refused']]) })).remove).toEqual(['c', 'reset-copy']);
    expect(planImageCards(base({ cards, pictures: new Map([['s1', 'none']]) })).remove).toEqual(['c', 'reset-copy']);
    expect(planImageCards(base({ cards, enabled: false })).remove).toEqual(['c', 'reset-copy']);
  });
  it('changes nothing when the picture is unknown on this device', () => {
    expect(emptyPlan(planImageCards(base({ pictures: new Map() })))).toBe(true);
    expect(emptyPlan(planImageCards(base({ cards: [card('c', null)], pictures: new Map() })))).toBe(true);
  });

  const termType = fc.constantFrom<NoteTermType>('word', 'phrase', 'pattern', 'affix', 'contrast');
  const state = fc.constantFrom<PictureState>('ready', 'refused', 'none', 'unknown');
  const world = fc.record({
    enabled: fc.boolean(),
    senses: fc.array(
      fc.record({
        n: fc.integer({ min: 0, max: 3 }),
        lex: fc.boolean(),
        dead: fc.boolean(),
        state,
        cards: fc.array(fc.record({ dead: fc.boolean(), at: fc.integer({ min: 0, max: 9 }) }), { maxLength: 3 }),
      }),
      { maxLength: 8 },
    ),
    notes: fc.array(fc.option(termType), { minLength: 4, maxLength: 4 }),
  });
  type World = typeof world extends fc.Arbitrary<infer T> ? T : never;
  const toInput = (w: World): ImageCardPlanInput => {
    const liveNotes = new Map<string, NoteTermType>();
    w.notes.forEach((t, i) => t && liveNotes.set(`n${i}`, t));
    return {
      enabled: w.enabled,
      senses: w.senses.map((s, i) => ({ id: `s${i}`, note_id: `n${s.n}`, lexicon_sense_id: s.lex ? `lx${i}` : null, deleted_at: s.dead ? 1 : null })),
      liveNotes,
      cards: w.senses.flatMap((s, i) =>
        s.cards.map((c, j) => ({ id: `c${i}-${j}`, sense_id: `s${i}`, card_type: 'image' as const, deleted_at: c.dead ? 1 : null, updated_at: c.at })),
      ),
      pictures: new Map(w.senses.map((s, i) => [`s${i}`, s.state])),
    };
  };
  const apply = (input: ImageCardPlanInput): ImageCardPlanInput => {
    const plan = planImageCards(input);
    const cards = input.cards.map((c) =>
      plan.remove.includes(c.id) ? { ...c, deleted_at: 2 } : plan.revive.includes(c.id) ? { ...c, deleted_at: null } : c,
    );
    for (const s of plan.create) cards.push({ id: `new-${s}`, sense_id: s, card_type: 'image', deleted_at: null, updated_at: 3 });
    return { ...input, cards };
  };

  it('property: applying the plan once is enough (idempotent)', () => {
    fc.assert(fc.property(world, (w) => emptyPlan(planImageCards(apply(toInput(w))))));
  });
  it('property: afterwards a sense has a live card exactly when it should, and unknown senses are untouched', () => {
    fc.assert(
      fc.property(world, (w) => {
        const input = toInput(w);
        const after = apply(input);
        for (const s of input.senses) {
          const want = wantsImageCard(s, input.liveNotes.get(s.note_id), input.enabled, input.pictures.get(s.id)!);
          const live = after.cards.filter((c) => c.sense_id === s.id && c.deleted_at === null).length;
          const liveBefore = input.cards.filter((c) => c.sense_id === s.id && c.deleted_at === null).length;
          // A wanted sense keeps the live cards it had (a leech reset copy), or gets exactly one.
          if (want === true && live !== Math.max(1, liveBefore)) return false;
          if (want === false && live !== 0) return false;
          if (want === null) {
            const before = input.cards.filter((c) => c.sense_id === s.id).map((c) => c.deleted_at);
            const now = after.cards.filter((c) => c.sense_id === s.id).map((c) => c.deleted_at);
            if (JSON.stringify(before) !== JSON.stringify(now)) return false;
          }
        }
        return true;
      }),
    );
  });
  it('property: never creates or brings back a card with the setting off or a hidden picture', () => {
    fc.assert(
      fc.property(world, (w) => {
        const input = toInput(w);
        const plan = planImageCards(input);
        const revived = new Set(plan.revive.map((id) => input.cards.find((c) => c.id === id)!.sense_id));
        for (const s of [...plan.create, ...revived]) {
          if (!input.enabled || input.pictures.get(s!) !== 'ready') return false;
        }
        return true;
      }),
    );
  });
});

describe('unlock rule (acceptance criterion 8)', () => {
  it('a picture card opens only once the word reaches Pekişiyor, like production (ADR 0041)', () => {
    const fresh = { card_type: 'image' as const, state: CardState.New, reps: 0 };
    const at = RAMP_EPOCH + 86_400_000;
    const rec = (state: CardStateValue, ramp_step = 0) => ({ state, ramp_step, last_review: at });
    expect(deriveUnlocked(fresh, null)).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.New))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Learning))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Review))).toBe(false);
    expect(deriveUnlocked(fresh, rec(CardState.Review, 1))).toBe(true);
    expect(deriveUnlocked(fresh, rec(CardState.Relearning, 1))).toBe(true);
    // Studied once, it stays open after an undo on the recognition card.
    expect(deriveUnlocked({ ...fresh, reps: 1, state: CardState.Learning }, rec(CardState.Learning))).toBe(true);
  });
});

describe('imageCardRowId', () => {
  it('is the same id for the same sense on every device, and differs per sense', async () => {
    const a = await imageCardRowId('0199f0a0-0000-7000-8000-00000000a001');
    expect(a).toBe(await imageCardRowId('0199f0a0-0000-7000-8000-00000000a001'));
    expect(a).not.toBe(await imageCardRowId('0199f0a0-0000-7000-8000-00000000a002'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
