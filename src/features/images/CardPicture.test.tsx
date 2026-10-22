import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, storeImage, updateSettings, type CardView } from '@/data';
import type { CardType } from '@/domain/types';
import { CardBack, CardFront } from '@/features/review/CardFaces';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { renderRoute } from '@/test/ui';
import { setThemePreference } from '@/ui';
import { IMAGE_PALETTE } from '../../../supabase/functions/_shared/image-contract';
import { clearPictureCache } from './picture';

// Stand-in for the İP2 sanitizer: it keeps the picture and counts the calls.
const sanitizeSvg = vi.hoisted(() => vi.fn((svg: string) => ({ ok: true as const, svg })));
vi.mock('../../../supabase/functions/_shared/svg-sanitize', () => ({ sanitizeSvg }));

const T = Date.UTC(2026, 9, 25, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const IMG = '0199f0a0-0000-7000-8000-0000000b0001';
const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };

async function viewOf(type: CardType): Promise<CardView> {
  const card = (await db.cards.toArray()).find((c) => c.card_type === type)!;
  return (await getCardView(card.id, T))!;
}

const srcOf = (img: HTMLElement) => decodeURIComponent(img.getAttribute('src')!.slice('data:image/svg+xml,'.length));

beforeEach(async () => {
  await resetDb();
  clearPictureCache();
  sanitizeSvg.mockClear();
  setThemePreference('light');
  await ensureSettings(T);
  await addNoteWithSenses(
    {
      term: 'umbrella',
      senses: [{ meaning_tr: 'şemsiye', pos: 'noun', lexicon_sense_id: LEX, source_sentence: 'Take an umbrella.', span: [8, 16] }],
    },
    T,
  );
  await storeImage({
    id: IMG,
    sense_id: LEX,
    variant: 0,
    svg: SAMPLE_PICTURES.umbrella.svg,
    alt_tr: 'Yağmurda açık mavi bir şemsiye',
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    fetched_at: T,
  });
});

afterEach(() => setThemePreference('system'));

describe('picture on the card', () => {
  it('recognition back: the picture sits beside the meaning, as an <img> with the Turkish alt text', async () => {
    renderRoute(<CardBack view={await viewOf('recognition')} isNew={false} speech={speech} />);
    const img = await screen.findByRole('img', { name: 'Yağmurda açık mavi bir şemsiye' });
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/);
    expect(srcOf(img)).toBe(SAMPLE_PICTURES.umbrella.svg);
    expect(screen.getByTestId('meaning-with-picture')).toHaveTextContent('şemsiye');
    // Never inline SVG markup in the page.
    expect(document.querySelector('svg circle, svg path[fill]')).toBeNull();
    expect(sanitizeSvg).toHaveBeenCalled();
  });

  it('production and cloze backs show it too; fronts only with "Görseli ön yüzde de göster"', async () => {
    renderRoute(<CardBack view={await viewOf('production')} isNew={false} speech={speech} />);
    expect(screen.getByRole('img', { name: /şemsiye/ })).toBeInTheDocument();
    cleanup();
    renderRoute(<CardFront view={await viewOf('recognition')} isNew={false} speech={speech} />);
    expect(screen.queryByRole('img', { name: /şemsiye/ })).not.toBeInTheDocument();

    await updateSettings({ show_image_front: true }, T);
    for (const type of ['recognition', 'production', 'cloze'] as const) {
      renderRoute(<CardFront view={await viewOf(type)} isNew={false} speech={speech} />);
      expect(screen.getByRole('img', { name: /şemsiye/ })).toBeInTheDocument();
      cleanup();
    }
  });

  it('switching to the dark theme recolours the picture', async () => {
    renderRoute(<CardBack view={await viewOf('recognition')} isNew={false} speech={speech} />);
    const light = srcOf(screen.getByRole('img', { name: /şemsiye/ }));
    expect(light).toContain(IMAGE_PALETTE.blue[0]);
    act(() => void setThemePreference('dark'));
    const dark = srcOf(screen.getByRole('img', { name: /şemsiye/ }));
    expect(dark).not.toContain(IMAGE_PALETTE.blue[0]);
    expect(dark).toContain(IMAGE_PALETTE.blue[1]);
    expect(dark).toContain(IMAGE_PALETTE.soft[1]);
  });

  it('a picture the sanitizer refuses is not shown; a new one carries the "Yeni" badge', async () => {
    sanitizeSvg.mockImplementationOnce(() => ({ ok: false, reason: 'href' }) as never);
    renderRoute(<CardBack view={await viewOf('recognition')} isNew={false} speech={speech} />);
    expect(screen.queryByRole('img', { name: /şemsiye/ })).not.toBeInTheDocument();
    expect(screen.getByText('şemsiye')).toBeInTheDocument();

    cleanup();
    clearPictureCache();
    await db.images.update(IMG, { status: 'review' });
    renderRoute(<CardBack view={await viewOf('recognition')} isNew={false} speech={speech} />);
    expect(screen.getByText('Yeni görsel, henüz gözden geçirilmedi')).toBeInTheDocument();
  });
});
