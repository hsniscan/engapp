// "Görsel" in the word detail and "Görselle çalış" in the leech sheet (v0.4 İP3): other
// pictures, "Yeniden üret" with the four refusals in plain Turkish, "Görseli gizle", and
// "Bu görsel anlamı anlatıyor mu? Evet / Hayır" with the reasons. No live call: ai-image is a
// recorded answer.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, cardImageOf, db, ensureSettings, getSenseImages, storeImage } from '@/data';
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
import type { ImageRequestDeps } from './request';
import { resetAdminCache } from './useIsAdmin';

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

function deps(answer: Awaited<ReturnType<ImageRequestDeps['request']>>): ImageRequestDeps {
  return {
    request: vi.fn(async () => answer),
    isOnline: () => true,
    isSignedIn: async () => true,
    now: () => T,
  };
}

let sense: Sense;
const signedIn = (uid = 'u1') => setAuthStateForTesting({ status: 'signed_in', user: { id: uid, email: null, name: null, avatarUrl: null } });

beforeEach(async () => {
  await resetDb();
  clearPictureCache();
  resetAdminCache();
  await ensureSettings(T);
  const res = await addNoteWithSenses({ term: 'umbrella', senses: [{ meaning_tr: 'şemsiye', pos: 'noun', lexicon_sense_id: LEX }] }, T);
  sense = res.addedSenses[0]!;
  signedIn();
});
afterEach(() => setAuthStateForTesting({ status: 'guest', user: null }));

function renderSection(props: Partial<Parameters<typeof ImageSection>[0]> = {}) {
  return renderRoute(
    <>
      <ImageSection senses={[sense]} admin={{ ask: async () => false, decide: vi.fn() }} {...props} />
      <Toaster />
    </>,
  );
}

describe('Görsel section', () => {
  it('shows the picture, lets the user pick another one, and the card follows', async () => {
    const user = userEvent.setup();
    await storeImage(pic(0));
    await storeImage(pic(1));
    renderSection();
    const shown = await screen.findByTestId('image-shown');
    expect(within(shown).getByRole('img', { name: 'Mavi bir şemsiye 0' })).toBeInTheDocument();
    const variants = screen.getAllByTestId('image-variant');
    expect(variants).toHaveLength(2);
    expect(variants[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^2\. görsel: Kırmızı bir elma 1\. Bunu kullan$/ }));
    expect(await screen.findByText('Kartlarında artık bu görsel görünecek')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId('image-shown')).getByRole('img', { name: 'Kırmızı bir elma 1' })).toBeInTheDocument());
    expect((await cardImageOf(sense))?.id).toBe(id(1));
  });

  it('Evet is saved; Hayır asks why, hides the picture from cards and can be undone', async () => {
    const user = userEvent.setup();
    await storeImage(pic(0));
    await storeImage(pic(1));
    renderSection();
    const shown = await screen.findByTestId('image-shown');
    expect(within(shown).getByText('Bu görsel anlamı anlatıyor mu?')).toBeInTheDocument();
    await user.click(within(shown).getByRole('button', { name: 'Evet' }));
    expect(await within(shown).findByText('“Evet” dedin, teşekkürler.')).toBeInTheDocument();
    expect((await getSenseImages(sense.id))?.verdicts).toEqual({ [id(0)]: 'like' });

    await user.click(within(shown).getByRole('button', { name: 'Cevabı değiştir' }));
    await user.click(within(shown).getByRole('button', { name: 'Hayır' }));
    const reasons = within(shown).getByRole('group', { name: 'Neden anlatmıyor?' });
    expect(within(reasons).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Başka bir anlamı gösteriyor',
      'Ne olduğu anlaşılmıyor',
      'Çizim kötü görünüyor',
      'Başka bir sebep',
      'Vazgeç',
    ]);
    await user.click(within(reasons).getByRole('button', { name: 'Ne olduğu anlaşılmıyor' }));
    expect(await screen.findByText('Teşekkürler, bu görsel artık kartlarında çıkmayacak.')).toBeInTheDocument();
    // The card falls back to the other picture.
    await waitFor(async () => expect((await cardImageOf(sense))?.id).toBe(id(1)));
    expect((await getSenseImages(sense.id))?.reasons).toEqual({ [id(0)]: 'unclear' });

    await user.click(screen.getByRole('button', { name: 'Geri al' }));
    await waitFor(async () => expect((await getSenseImages(sense.id))?.verdicts).toEqual({}));
    expect((await cardImageOf(sense))?.id).toBe(id(0));
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

  it('"Yeniden üret": each refusal reads as plain Turkish; a new picture becomes the one shown', async () => {
    const user = userEvent.setup();
    await storeImage(pic(0));
    const cases = [
      ['daily_limit', 'Bugün 10 görsel ürettin; günlük sınır bu kadar. Yarın yine deneyebilirsin.'],
      ['budget', 'Bu ayın görsel bütçesi doldu. Gelecek ay yeniden üretebilirsin.'],
      ['not_visual', 'Bu anlam resimle anlatılabilecek bir şey değil, o yüzden görsel çizilmedi.'],
      ['failed', 'Görsel üretilemedi. Biraz sonra tekrar dene.'],
    ] as const;
    for (const [reason, text] of cases) {
      const view = renderSection({ requestDeps: deps({ ok: false, reason }) });
      await user.click(await screen.findByRole('button', { name: 'Yeniden üret' }));
      expect(await screen.findByText(text)).toBeInTheDocument();
      view.unmount();
    }
    const d = deps({
      ok: true,
      image: { id: id(7), sense_id: LEX, variant: 7, svg: SAMPLE_PICTURES.apple.svg, alt_tr: 'Yeni bir elma', status: 'review', created_at: '2026-10-25T09:00:00Z' },
    });
    renderSection({ requestDeps: d });
    await user.click(await screen.findByRole('button', { name: 'Yeniden üret' }));
    expect(await screen.findByText('Yeni görsel hazır ve kartlarına eklendi.')).toBeInTheDocument();
    expect(d.request).toHaveBeenCalledWith(LEX);
    await waitFor(() => expect(within(screen.getByTestId('image-shown')).getByRole('img', { name: 'Yeni bir elma' })).toBeInTheDocument());
    expect(screen.getByText('Bu görsel yeni; henüz kimse gözden geçirmedi.')).toBeInTheDocument();
  });

  it('no picture yet: "Görsel üret" needs sign-in', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderSection();
    expect(await screen.findByText('Bu anlam için henüz bir görsel yok. Görsel üretmek için Google ile giriş yap.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Görsel üret' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Görseli gizle' })).not.toBeInTheDocument();
  });

  it("an admin's answer about a picture still in review is also the review decision", async () => {
    const user = userEvent.setup();
    signedIn('admin-1');
    await storeImage(pic(0, { status: 'review' }));
    const decide = vi.fn(async () => {});
    renderSection({ admin: { ask: async () => true, decide } });
    const shown = await screen.findByTestId('image-shown');
    await user.click(within(shown).getByRole('button', { name: 'Hayır' }));
    await user.click(within(shown).getByRole('button', { name: 'Başka bir anlamı gösteriyor' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(id(0), 'reject', 'wrong_meaning'));
  });
});

describe('leech sheet: "Görselle çalış"', () => {
  it('opens the picture of the sense, or offers to make one', async () => {
    const user = userEvent.setup();
    const card = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
    renderRoute(<LeechSheet cardId={card.id} onOpenChange={() => {}} />);
    const path = await screen.findByRole('button', { name: /Görselle çalış/ });
    await user.click(path);
    expect(await screen.findByRole('button', { name: 'Görsel üret' })).toBeEnabled();
    await storeImage(pic(0));
    expect(await screen.findByRole('img', { name: 'Mavi bir şemsiye 0' })).toBeInTheDocument();
  });
});
