// v0.4 İP8 UI: the picture card's faces, the setting and the with/without comparison on the
// "Gelişim" tab.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureSettings,
  getCardView,
  reconcileImageCards,
  storeImage,
  updateSettings,
} from '@/data';
import { setLevelDataForTests } from '@/data/levelData';
import { parseClientLevels } from '@/domain/level';
import { Rating, type RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { renderRoute } from '@/test/ui';
import { CardBack, CardFront } from '@/features/review/CardFaces';
import { canShow } from '@/features/review/useReviewSession';
import { ProgressPanel } from '@/features/stats/ProgressPanel';
import { ImageSettingsRows } from './ImageSettings';
import { clearPictureCache } from './picture';

// The İP2 sanitizer is mocked as in the other picture tests: it keeps the SVG.
vi.mock('../../../supabase/functions/_shared/svg-sanitize', () => ({
  sanitizeSvg: (svg: string) => ({ ok: true as const, svg }),
}));

const DAY = 86_400_000;
const MIN = 60_000;
const T = Date.UTC(2026, 9, 26, 9);
const LEX = '0199f0a0-0000-7000-8000-00000000a001';
const IMG = '0199f0a0-0000-7000-8000-0000000b0001';
const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };

async function apple(now: number, lexicon_sense_id: string | null = LEX) {
  const res = await addNoteWithSenses(
    {
      term: 'apple',
      ipa: '/ˈæp.əl/',
      senses: [{ meaning_tr: 'elma', pos: 'noun', lexicon_sense_id, source_sentence: 'She ate an apple.', span: [11, 16] }],
    },
    now,
  );
  return res;
}

async function picture(now: number) {
  await storeImage({
    id: IMG,
    sense_id: LEX,
    variant: 0,
    svg: SAMPLE_PICTURES.apple.svg,
    alt_tr: 'Kırmızı bir elma',
    status: 'approved',
    created_at: '2026-10-25T01:30:00Z',
    fetched_at: now,
  });
}

const imageCard = async () => (await db.cards.where('card_type').equals('image').toArray()).find((c) => c.deleted_at === null);

beforeEach(async () => {
  await resetDb();
  clearPictureCache();
  setLevelDataForTests(parseClientLevels(''));
});

describe('picture card faces', () => {
  it('the front shows only the picture and the part of speech; the back gives the word, its sound and meaning', async () => {
    await ensureSettings(T);
    await apple(T);
    await picture(T);
    await reconcileImageCards({}, T);
    const view = (await getCardView((await imageCard())!.id, T))!;

    const front = renderRoute(<CardFront view={view} isNew speech={speech} />);
    expect(screen.getByText('Görseldeki kelimeyi bul')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kırmızı bir elma' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml,/));
    expect(screen.getByText('Sözcük türü: isim')).toBeInTheDocument();
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
    expect(screen.queryByText('elma')).not.toBeInTheDocument();
    front.unmount();

    renderRoute(<CardBack view={view} isNew speech={speech} />);
    // The word, and the same word marked in the sentence it came from.
    expect(screen.getAllByText('apple')[0]).toHaveAttribute('lang', 'en');
    expect(screen.getByText('/ˈæp.əl/')).toBeInTheDocument();
    expect(screen.getByText('elma')).toBeInTheDocument();
    expect(within(screen.getByTestId('meaning-with-picture')).getByRole('img', { name: 'Kırmızı bir elma' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sesli dinle' }));
    expect(speech.onSpeak).toHaveBeenCalled();
  });

  it('without its picture the card asks like a production card instead of showing an empty frame', async () => {
    await ensureSettings(T);
    await apple(T);
    await picture(T);
    await reconcileImageCards({}, T);
    const card = (await imageCard())!;
    await db.images.clear();
    const view = (await getCardView(card.id, T))!;
    expect(view.image).toBeNull();
    renderRoute(<CardFront view={view} isNew={false} speech={speech} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('elma')).toBeInTheDocument();
    // The review session skips it (offline: the picture is not on the device).
    expect(canShow(view)).toBe(false);
    const production = (await db.cards.toArray()).find((c) => c.card_type === 'production')!;
    expect(canShow(await getCardView(production.id, T))).toBe(true);
  });
});

describe('picture card setting', () => {
  it('is on by default; turning it off removes the cards and on brings them back', async () => {
    await ensureSettings(T);
    await apple(T);
    await picture(T);
    await reconcileImageCards({}, T);
    renderRoute(<ImageSettingsRows />);
    const toggle = await screen.findByRole('switch', { name: /Görselden hatırlama kartları/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(async () => expect(await imageCard()).toBeUndefined());
    await waitFor(() => expect(toggle).not.toBeChecked());
    fireEvent.click(toggle);
    await waitFor(async () => expect(await imageCard()).toBeDefined());
  });
});

describe('Gelişim: with vs. without picture cards', () => {
  async function studied(now: number, term: string, lex: string | null, passes: boolean[]) {
    const res = await addNoteWithSenses({ term, senses: [{ meaning_tr: term, pos: 'noun', lexicon_sense_id: lex }] }, now - 40 * DAY);
    const cards = await db.cards.where('note_id').equals(res.note.id).toArray();
    const rec = cards.find((c) => c.card_type === 'recognition')!;
    const prod = cards.find((c) => c.card_type === 'production')!;
    const answer = (id: string, rating: RatingValue, at: number) => answerCard({ card_id: id, rating, duration_ms: 3000 }, at);
    await answer(rec.id, Rating.Easy, now - 35 * DAY);
    await answer(prod.id, Rating.Easy, now - 35 * DAY + MIN);
    for (const [i, ok] of passes.entries()) {
      await answer(prod.id, ok ? Rating.Good : Rating.Again, now - (30 - i) * DAY);
      // A missed card is relearned the same day, so the next day's answer counts again.
      if (!ok) await answer(prod.id, Rating.Good, now - (30 - i) * DAY + 10 * MIN);
    }
  }

  it('shows nothing without picture cards, then both rates in one plain sentence', async () => {
    const now = Date.now();
    await updateSettings({ timezone: 'Europe/Istanbul' }, now - 60 * DAY);
    await studied(now, 'chair', null, [true, false, true]);
    const first = renderRoute(<ProgressPanel />);
    await screen.findByRole('region', { name: 'Tanıma ve üretme' });
    expect(screen.queryByTestId('picture-recall')).not.toBeInTheDocument();
    first.unmount();

    await studied(now, 'apple', LEX, [...Array<boolean>(18).fill(true), false, false]);
    await studied(now, 'idea', null, [...Array<boolean>(13).fill(true), ...Array<boolean>(4).fill(false)]);
    await picture(now);
    await reconcileImageCards({}, now);
    renderRoute(<ProgressPanel />);
    const section = await screen.findByRole('region', { name: 'Görsel kartlarının etkisi' });
    expect(within(section).getByText('Görsel kartı olan anlamlar')).toBeInTheDocument();
    expect(within(section).getByText('%90')).toBeInTheDocument();
    expect(within(section).getByText('%75')).toBeInTheDocument();
    expect(
      within(section).getByText('Görsel kartı olan kelimelerin İngilizcesini %90 oranında hatırlıyorsun; görsel kartı olmayanlarda bu oran %75.'),
    ).toBeInTheDocument();
  });

  it('asks for more answers while one side has fewer than 20', async () => {
    const now = Date.now();
    await updateSettings({ timezone: 'Europe/Istanbul' }, now - 60 * DAY);
    await studied(now, 'apple', LEX, [true, true]);
    await picture(now);
    await reconcileImageCards({}, now);
    renderRoute(<ProgressPanel />);
    const section = await screen.findByRole('region', { name: 'Görsel kartlarının etkisi' });
    expect(within(section).getByText(/iki tarafta da en az 20 cevap/)).toBeInTheDocument();
  });
});
