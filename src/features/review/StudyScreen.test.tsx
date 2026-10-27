import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings } from '@/data';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { ReviewScreen } from './ReviewScreen';
import { StudyModesPage } from './StudyModesPage';

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  const t = Date.now() - 2 * DAY;
  await ensureSettings(t);
  await addNoteWithSenses(
    {
      term: 'reluctant',
      ipa: '/rɪˈlʌktənt/',
      senses: [
        {
          meaning_tr: 'isteksiz',
          pos: 'adjective',
          source_sentence: 'She was reluctant to leave.',
          span: [8, 17],
        },
      ],
    },
    t,
  );
  for (const [i, term] of ['eager', 'willing', 'curious', 'happy'].entries())
    await addNoteWithSenses(
      { term, senses: [{ meaning_tr: `anlam ${i}`, pos: 'adjective' }] },
      t + 1000 + i,
    );
  // Only the word under test has open production and cloze cards; recognition cards wait.
  const notes = await db.notes.toArray();
  const reluctant = notes.find((n) => n.term === 'reluctant')!;
  await db.cards.toCollection().modify((c) => {
    if (c.note_id === reluctant.id && c.card_type !== 'recognition') c.unlocked = true;
    else if (c.card_type === 'recognition') c.suspended = true;
  });
});

describe('Üretim session', () => {
  it('checks a typed answer, shows the letter diff and suggests a button', async () => {
    const user = userEvent.setup();
    renderRoute(<ReviewScreen studyMode="production" />, { path: '/study' });

    expect(await screen.findByText('isteksiz')).toBeInTheDocument();
    // The term is not on the front.
    expect(screen.queryByText('reluctant', { selector: 'p[lang="en"]' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /İlk harfi göster/ }));
    expect(screen.getByTestId('first-letter')).toHaveTextContent('r________');

    await user.type(screen.getByTestId('answer-input'), 'reluctent{Enter}');
    expect(await screen.findByText('Neredeyse: bir harf farklı')).toBeInTheDocument();
    expect(screen.getByTestId('right-answer')).toHaveAttribute('data-answer', 'reluctant');
    expect(document.querySelector('[data-diff="wrong"]')).toHaveTextContent('e');
    expect(document.querySelector('[data-diff="right"]')).toHaveTextContent('a');
    expect(screen.getByText(/Önerimiz:/)).toHaveTextContent('Zor');

    fireEvent.keyDown(window, { key: '2' });
    await waitFor(async () => expect(await db.review_logs.count()).toBe(1));
    expect((await db.review_logs.toArray())[0]!.rating).toBe(Rating.Hard);
  });

  it('"Bilmiyorum, göster" reveals the answer and suggests Tekrar', async () => {
    const user = userEvent.setup();
    renderRoute(<ReviewScreen studyMode="production" />, { path: '/study' });
    await user.click(await screen.findByRole('button', { name: 'Bilmiyorum, göster' }));
    expect(await screen.findByText('Doğrusu bu')).toBeInTheDocument();
    expect(screen.getByText(/Önerimiz:/)).toHaveTextContent('Tekrar');
  });
});

describe('Boşluk doldurma session', () => {
  it('offers four choices from the collection and marks the pick', async () => {
    const user = userEvent.setup();
    renderRoute(<ReviewScreen studyMode="cloze" />, { path: '/study' });
    const group = await screen.findByRole('group', { name: 'Seçenekler' });
    const choices = await waitFor(() => {
      const b = group.querySelectorAll('button');
      expect(b).toHaveLength(4);
      return [...b];
    });
    const wrong = choices.find((b) => b.textContent !== 'reluctant')!;
    expect(screen.getByRole('button', { name: 'Kontrol et' })).toBeDisabled();
    await user.click(wrong);
    expect(wrong).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Kontrol et' }));

    expect(await screen.findByText('Bu sefer olmadı')).toBeInTheDocument();
    expect(document.querySelector('[data-choice="right"]')).toHaveTextContent('reluctant');
    expect(document.querySelector('[data-choice="picked"]')).toHaveTextContent(wrong.textContent!);
    expect(screen.getByText('Seçtiğin kelime')).toBeInTheDocument();
    expect(screen.getByText(/Önerimiz:/)).toHaveTextContent('Tekrar');

    await user.click(screen.getByRole('button', { name: /^Tekrar/ }));
    await waitFor(async () => expect(await db.review_logs.count()).toBe(1));
  });

  it('can be answered by typing', async () => {
    const user = userEvent.setup();
    renderRoute(<ReviewScreen studyMode="cloze" />, { path: '/study' });
    await user.click(await screen.findByRole('button', { name: /Seçenek yerine yazarak cevapla/ }));
    await user.type(screen.getByTestId('answer-input'), 'Reluctant{Enter}');
    expect(await screen.findByText('Doğru')).toBeInTheDocument();
    expect(screen.getByText(/Önerimiz:/)).toHaveTextContent('İyi');
  });
});

describe('study modes picker', () => {
  it('lists the three types with what each has left today', async () => {
    renderRoute(<StudyModesPage />, { path: '/study' });
    const production = await screen.findByTestId('study-mode-production');
    expect(production).toHaveAttribute('href', '/study?mode=production');
    await waitFor(() => expect(production).toHaveTextContent('1'));
    expect(screen.getByTestId('study-mode-word')).toHaveTextContent('0');
    // The first type with cards is the main one.
    expect(screen.getByTestId('study-start')).toHaveAttribute('href', '/study?mode=production');
    expect(screen.getByTestId('study-start')).toHaveTextContent('Üretime başla');
    // Dikte cannot give cards on this device (no dictation cards): not listed (ADR 0055).
    expect(screen.queryByTestId('study-mode-dictation')).toBeNull();
    expect(screen.getByText(/tek oturumda karışık gelir/)).toHaveTextContent(
      'Kelime çalışma, Üretim ve Boşluk doldurma tek oturumda karışık gelir',
    );
  });

  it('a new user gets first steps, not a start button with no cards', async () => {
    await resetDb();
    await ensureSettings(Date.now());
    renderRoute(<StudyModesPage />, { path: '/study' });
    expect(await screen.findByTestId('study-welcome')).toBeInTheDocument();
    expect(screen.queryByTestId('study-start')).toBeNull();
    expect(screen.queryByText('Bugünlük bütün türler bitti')).toBeNull();
    expect(screen.getByRole('button', { name: /İlk kelimeni ekle/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hazır desteye göz at' })).toHaveAttribute(
      'href',
      '/kesfet?f=desteler',
    );
  });
});

describe('a wrong typed answer', () => {
  it('suggests Tekrar and asks before İyi', async () => {
    const user = userEvent.setup();
    renderRoute(<ReviewScreen studyMode="production" />, { path: '/study' });
    await screen.findByText('isteksiz');
    await user.type(screen.getByTestId('answer-input'), 'zzz{Enter}');
    expect(await screen.findByText('Bu sefer olmadı')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /İyi/ }));
    expect(await db.review_logs.count()).toBe(0);
    expect(screen.getByTestId('rating-confirm')).toHaveTextContent('Yine de “İyi” mi?');
    await user.click(screen.getByRole('button', { name: /İyi/ }));
    await waitFor(async () => expect(await db.review_logs.count()).toBe(1));
  });
});
