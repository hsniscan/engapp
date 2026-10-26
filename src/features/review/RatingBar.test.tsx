// A wrong typed answer must not send a forgotten word months away with one tap (ADR 0055).
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, type CardView } from '@/data';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { RatingBar } from './RatingBar';

const T = Date.UTC(2026, 9, 21, 9);

async function view(): Promise<CardView> {
  const card = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
  return (await getCardView(card.id, T))!;
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T);
  await addNoteWithSenses({ term: 'hinder', senses: [{ meaning_tr: 'engellemek' }] }, T);
});

describe('RatingBar', () => {
  it('after a wrong answer Zor, İyi and Kolay need a second tap; Tekrar goes at once', async () => {
    const onAnswer = vi.fn();
    renderRoute(<RatingBar view={await view()} onAnswer={onAnswer} suggested={Rating.Again} />);
    expect(screen.getByTestId('rating-confirm')).toHaveTextContent('Tekrar öneriyoruz');

    fireEvent.click(screen.getByRole('button', { name: /İyi/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByTestId('rating-confirm')).toHaveTextContent('Yine de “İyi” mi?');
    fireEvent.click(screen.getByRole('button', { name: /İyi/ }));
    expect(onAnswer).toHaveBeenCalledWith(Rating.Good, expect.any(Boolean));

    onAnswer.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar/ }));
    expect(onAnswer).toHaveBeenCalledWith(Rating.Again, expect.any(Boolean));
  });

  it('keys 2–4 need a second press too', async () => {
    const onAnswer = vi.fn();
    renderRoute(<RatingBar view={await view()} onAnswer={onAnswer} suggested={Rating.Again} />);
    act(() => void fireEvent.keyDown(document.body, { key: '2' }));
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => void fireEvent.keyDown(document.body, { key: '2' }));
    expect(onAnswer).toHaveBeenCalledWith(Rating.Hard, true);
  });

  it('a right answer answers on one tap', async () => {
    const onAnswer = vi.fn();
    renderRoute(<RatingBar view={await view()} onAnswer={onAnswer} suggested={Rating.Good} />);
    expect(screen.queryByTestId('rating-confirm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Kolay/ }));
    expect(onAnswer).toHaveBeenCalledWith(Rating.Easy, expect.any(Boolean));
  });
});
