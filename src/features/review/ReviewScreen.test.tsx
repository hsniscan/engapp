import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ReviewScreen } from './ReviewScreen';

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  const t = Date.now() - 2 * DAY;
  await ensureSettings(t);
  await addNoteWithSenses(
    {
      term: 'bank',
      ipa: '/bæŋk/',
      senses: [
        {
          meaning_tr: 'banka',
          gloss_en: 'a place for money',
          source_sentence: 'I went to the bank.',
          span: [14, 18],
        },
        {
          meaning_tr: 'kıyı',
          gloss_en: 'the land beside a river',
          source_sentence: 'We sat on the bank of the river.',
          span: [10, 14],
        },
      ],
    },
    t,
  );
  await addNoteWithSenses({ term: 'light', senses: [{ meaning_tr: 'hafif' }] }, t + 1000);
});

const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }));
const term = (text: string) => screen.findByText(text, { selector: 'p[lang="en"]' });

describe('review session', () => {
  it('flips with Space, answers with 1–4 only after flipping, undoes with Z and ends with a summary', async () => {
    renderRoute(<ReviewScreen />, { path: '/review' });

    // Recognition front: term + the first sense's sentence with the term marked.
    await term('bank');
    expect(screen.getByText('bank', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.queryByText('kıyı')).not.toBeInTheDocument();

    // Number keys do nothing before the flip.
    await press('4');
    expect(await db.review_logs.count()).toBe(0);

    await press(' ');
    // Back: both senses numbered, the shown one (sense 1) flagged.
    expect(await screen.findByText('kıyı')).toBeInTheDocument();
    expect(screen.getByText('banka')).toBeInTheDocument();
    expect(screen.getByText(/cümledeki anlam/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Ne kadar iyi hatırladın?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kolay/ })).toBeInTheDocument();

    await press('4');
    await term('light');
    await waitFor(async () => expect(await db.review_logs.count()).toBe(1));
    const log = (await db.review_logs.toArray())[0]!;
    expect(log.rating).toBe(4);
    expect(log.duration_ms).toBeLessThanOrEqual(60_000);
    expect(log.shown_sense_id).not.toBeNull();

    // Undo brings the card back face up and adds an undo row (logs are never changed).
    await screen.findByRole('button', { name: 'Son cevabı geri al (Z)' });
    await press('z');
    await term('bank');
    await waitFor(async () =>
      expect(await db.review_logs.filter((l) => l.undo_of === log.id).count()).toBe(1),
    );
    expect(screen.getByText('0 / 2')).toBeInTheDocument();

    await press(' ');
    await screen.findByText('kıyı');
    await press('4');
    await term('light');
    await press(' ');
    await screen.findByText('hafif');
    await press('4');

    expect(await screen.findByRole('heading', { name: 'Oturum tamamlandı' })).toBeInTheDocument();
    const cards = screen.getByText('Kart').nextElementSibling;
    expect(cards).toHaveTextContent('2');
    expect(screen.getByText('%100')).toBeInTheDocument();
    expect(await screen.findByText('Günlük seri')).toBeInTheDocument();
    expect(screen.getByText('Bugün serine eklendi.')).toBeInTheDocument();
  });

  it('shows a calm empty state when nothing is due', async () => {
    await db.cards.toCollection().modify({ suspended: true });
    renderRoute(<ReviewScreen />, { path: '/review' });
    expect(await screen.findByRole('heading', { name: 'Bugünlük bitti' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ana ekrana dön' })).toHaveAttribute('href', '/');
  });

  it('skips a card that is deleted while it is on screen', async () => {
    renderRoute(<ReviewScreen />, { path: '/review' });
    await term('bank');
    const bank = (await db.cards.filter((c) => c.card_type === 'recognition').first())!;
    await db.cards.update(bank.id, { deleted_at: Date.now() });
    await term('light');
  });
});
