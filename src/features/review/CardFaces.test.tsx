import { cleanup, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, type CardView } from '@/data';
import type { CardType } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { CardBack, CardFront } from './CardFaces';

const T = Date.UTC(2026, 9, 21, 9);
const SENTENCE = 'I marked our anniversary on the calendar.';
const SENTENCE_TR = 'Yıldönümümüzü takvime işaretledim.';

async function viewOf(type: CardType): Promise<CardView> {
  const card = (await db.cards.toArray()).find((c) => c.card_type === type)!;
  return (await getCardView(card.id, T))!;
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T);
  await addNoteWithSenses(
    {
      term: 'anniversary',
      ipa: '/ˌænəˈvɜːrsəri/',
      senses: [
        {
          meaning_tr: 'yıldönümü',
          pos: 'Noun',
          gloss_en: 'a date that is remembered because a special event happened',
          source_sentence: SENTENCE,
          source_sentence_tr: SENTENCE_TR,
          span: [13, 24],
        },
      ],
    },
    T,
  );
});

describe('card faces', () => {
  it('recognition back: Turkish part of speech, the translation and a sentence speak button', async () => {
    const speakText = vi.fn();
    const speech = { available: true, onSpeak: vi.fn(), speakText };
    const view = await viewOf('recognition');

    renderRoute(<CardFront view={view} isNew={false} speech={speech} />);
    expect(screen.queryByText(SENTENCE_TR)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cümleyi seslendir' })).not.toBeInTheDocument();

    renderRoute(<CardBack view={view} isNew={false} speech={speech} />);
    expect(await screen.findByText(/isim ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Noun/)).not.toBeInTheDocument();
    expect(screen.getByText(SENTENCE_TR)).toHaveAttribute('lang', 'tr');
    fireEvent.click(screen.getByRole('button', { name: 'Cümleyi seslendir' }));
    expect(speakText).toHaveBeenCalledWith(SENTENCE);
    expect(speech.onSpeak).not.toHaveBeenCalled();
  });

  it('cloze: no translation or sentence playback on the front, both on the back', async () => {
    const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };
    const view = await viewOf('cloze');

    renderRoute(<CardFront view={view} isNew={false} speech={speech} />);
    expect(screen.queryByText(SENTENCE_TR)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cümleyi seslendir' })).not.toBeInTheDocument();

    renderRoute(<CardBack view={view} isNew={false} speech={speech} />);
    expect(await screen.findByText(SENTENCE_TR)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cümleyi seslendir' })).toBeInTheDocument();
  });

  it('production back shows the translation; a sense without one shows no line', async () => {
    const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };
    renderRoute(<CardBack view={await viewOf('production')} isNew={false} speech={speech} />);
    expect(await screen.findByText(SENTENCE_TR)).toBeInTheDocument();

    const sense = (await db.senses.toArray())[0]!;
    await db.senses.put({ ...sense, source_sentence_tr: null });
    cleanup();
    renderRoute(<CardBack view={await viewOf('production')} isNew={false} speech={speech} />);
    expect(await screen.findByText('yıldönümü')).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE_TR)).not.toBeInTheDocument();
  });
});
