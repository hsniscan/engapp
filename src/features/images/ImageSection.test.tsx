// "Görsel" in the word detail and "Görselle çalış" in the leech sheet (v0.4 İP3): the shipped
// picture is displayed and can be hidden. Since v0.5.2 (ADR 0061) nothing is drawn on request:
// no "Görsel üret", no variant picker, no Evet / Hayır. Earlier choices and "Hayır" answers in
// the user's account are still honoured.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, cardImageOf, db, ensureSettings, storeImage } from '@/data';
import { IMAGE_CHOICE_KIND, IMAGE_TARGET, imageChoiceRowId } from '@/domain/images';
import { feedbackRowId } from '@/domain/examples';
import type { CachedImage } from '@/domain/images';
import type { Sense } from '@/domain/types';
import { setAuthStateForTesting } from '@/features/auth/session';
import { LeechSheet } from '@/features/leech/LeechSheet';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { renderRoute } from '@/test/ui';
import { Toaster } from '@/ui';
import { ImageSection } from './ImageSection';
import { clearPictureCache } from './picture';

const sanitizeSvg = vi.hoisted(() => vi.fn((svg: string) => ({ ok: true as const, svg })));
vi.mock('../../../supabase/functions/_shared/svg-sanitize', () => ({ sanitizeSvg }));

const T = Date.UTC(2026, 9, 25, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const id = (n: number) => `0199f0a0-0000-7000-8000-0000000b${String(n).padStart(4, '0')}`;

function pic(n: number, p: Partial<CachedImage> = {}): CachedImage {
  return {
    id: id(n),
    sense_id: LEX,
    variant: n,
    svg: n % 2 ? SAMPLE_PICTURES.apple.svg : SAMPLE_PICTURES.umbrella.svg,
    alt_tr: n % 2 ? `Kırmızı bir elma ${n}` : `Mavi bir şemsiye ${n}`,
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    fetched_at: T,
    ...p,
  };
}

let sense: Sense;
const signedIn = (uid = 'u1') => setAuthStateForTesting({ status: 'signed_in', user: { id: uid, email: null, name: null, avatarUrl: null } });

beforeEach(async () => {
  await resetDb();
  clearPictureCache();
  await ensureSettings(T);
  const res = await addNoteWithSenses({ term: 'umbrella', senses: [{ meaning_tr: 'şemsiye', pos: 'noun', lexicon_sense_id: LEX }] }, T);
  sense = res.addedSenses[0]!;
  signedIn();
});
afterEach(() => setAuthStateForTesting({ status: 'guest', user: null }));

function renderSection(props: Partial<Parameters<typeof ImageSection>[0]> = {}) {
  return renderRoute(
    <>
      <ImageSection senses={[sense]} {...props} />
      <Toaster />
    </>,
  );
}

describe('Görsel section', () => {
  it('shows one picture, with no drawing, variant or verdict controls', async () => {
    await storeImage(pic(0));
    await storeImage(pic(1, { created_at: '2026-10-26T01:30:00Z' }));
    renderSection();
    const shown = await screen.findByTestId('image-shown');
    expect(within(shown).getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByTestId('image-variant')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /üret/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Evet' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Görseli gizle' })).toBeInTheDocument();
    const card = await cardImageOf(sense);
    expect(within(shown).getByRole('img', { name: card!.alt })).toBeInTheDocument();
  });

  it('an earlier pick and an earlier "Hayır" stored in the account still decide the picture', async () => {
    await storeImage(pic(0));
    await storeImage(pic(1));
    await storeImage(pic(2));
    // Synced rows from an older app version: picked picture 1, said "Hayır" to picture 2.
    await db.user_content.put({
      id: await imageChoiceRowId(sense.id),
      user_id: 'u1',
      kind: IMAGE_CHOICE_KIND,
      lexicon_sense_id: LEX,
      sense_id: sense.id,
      context: 'chosen',
      replaces_id: id(1),
      text: 'chosen',
      translations: null,
      span: null,
      selected: true,
      hlc: 'h1',
      created_at: T,
      updated_at: T,
      deleted_at: null,
    });
    renderSection();
    const shown = await screen.findByTestId('image-shown');
    expect(within(shown).getByRole('img', { name: 'Kırmızı bir elma 1' })).toBeInTheDocument();
    expect((await cardImageOf(sense))?.id).toBe(id(1));

    // Without the pick, the default picture; an earlier "Hayır" to it moves on to another.
    const choice = (await db.user_content.toArray())[0]!;
    await db.user_content.put({ ...choice, deleted_at: T + 1 });
    await waitFor(async () => expect((await cardImageOf(sense))?.id).not.toBe(undefined));
    const first = (await cardImageOf(sense))!;
    await db.content_feedback.put({
      id: await feedbackRowId(IMAGE_TARGET, first.id),
      user_id: 'u1',
      target_kind: IMAGE_TARGET,
      target_id: first.id,
      verdict: 'reject',
      hlc: 'h2',
      created_at: T,
      updated_at: T,
      deleted_at: null,
    });
    await waitFor(() => expect(within(screen.getByTestId('image-shown')).queryByRole('img', { name: first.alt })).not.toBeInTheDocument());
    expect((await cardImageOf(sense))?.id).not.toBe(first.id);
  });

  it('"Görseli gizle" takes it off the cards; "Görseli göster" brings it back', async () => {
    const user = userEvent.setup();
    await storeImage(pic(0));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Görseli gizle' }));
    expect(await screen.findByText('Bu anlamın görselini gizledin; kartlarında görünmüyor.')).toBeInTheDocument();
    expect(screen.queryByTestId('image-shown')).not.toBeInTheDocument();
    expect(await cardImageOf(sense)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Görseli göster' }));
    expect(await screen.findByTestId('image-shown')).toBeInTheDocument();
    expect((await cardImageOf(sense))?.id).toBe(id(0));
  });

  it('no picture yet: says how shipped pictures arrive, and offers nothing to press', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderSection();
    expect(await screen.findByText('Bu anlam için henüz bir görsel yok. Hazır görseller Google ile giriş yapınca bu cihaza indirilir.')).toBeInTheDocument();
    expect(within(screen.getByTestId('image-section')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('a guest still sees a picture cached on the device', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    await storeImage(pic(0));
    renderSection();
    expect(await screen.findByRole('img', { name: 'Mavi bir şemsiye 0' })).toBeInTheDocument();
  });
});

describe('leech sheet: "Görselle çalış"', () => {
  it('is offered only when the device has a picture of the sense', async () => {
    const user = userEvent.setup();
    const card = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
    renderRoute(<LeechSheet cardId={card.id} onOpenChange={() => {}} />);
    await screen.findByRole('button', { name: /Başka bir cümlede gör/ });
    expect(screen.queryByRole('button', { name: /Görselle çalış/ })).not.toBeInTheDocument();
    await storeImage(pic(0));
    await user.click(await screen.findByRole('button', { name: /Görselle çalış/ }));
    expect(await screen.findByRole('img', { name: 'Mavi bir şemsiye 0' })).toBeInTheDocument();
  });
});
