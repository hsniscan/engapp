import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, storeExamples, type CardView } from '@/data';
import type { LexiconExample } from '@/domain/types';
import { CardBack } from '@/features/review/CardFaces';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';

const T = Date.UTC(2026, 9, 22, 9);

const ex = (p: Partial<LexiconExample> & { id: string; context: string }): LexiconExample => ({
  sense_id: 'ls-cope',
  level_band: 'B1',
  text_en: 'We had to cope with the delay.',
  span: [10, 14],
  translations: { tr: 'Gecikmeyle başa çıkmak zorunda kaldık.' },
  status: 'active',
  updated_at: 1,
  ...p,
});

async function view(reps = 0): Promise<CardView> {
  const card = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
  await db.cards.update(card.id, { reps });
  return (await getCardView(card.id, T))!;
}

const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };

beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  await ensureSettings(T);
  await addNoteWithSenses(
    {
      term: 'cope',
      senses: [{ meaning_tr: 'başa çıkmak', lexicon_sense_id: 'ls-cope', source_sentence: 'I can cope.', span: [6, 10] }],
    },
    T,
  );
  await storeExamples([
    ex({ id: 'e1', context: 'daily' }),
    ex({ id: 'e2', context: 'daily', text_en: 'She copes with stress well.', span: [4, 9], translations: { tr: 'Stresle iyi başa çıkar.' }, updated_at: 2 }),
    ex({ id: 'w1', context: 'work', text_en: 'Our team can cope with the extra work.', span: [13, 17] }),
  ]);
});

describe('example sentences on the back of a card', () => {
  it('opens on demand with context tabs; the translation waits for a tap', async () => {
    const user = userEvent.setup();
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    const toggle = await screen.findByRole('button', { name: 'Örnek cümleler' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const tabs = await screen.findByRole('tablist', { name: 'Bağlamlar' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Günlük2', 'Sohbet0', 'İş1', 'Resmi0']);
    expect(screen.getByText(/We had to/)).toBeInTheDocument();
    expect(screen.queryByText('Gecikmeyle başa çıkmak zorunda kaldık.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Türkçesini göster' }));
    expect(screen.getByText('Gecikmeyle başa çıkmak zorunda kaldık.')).toHaveAttribute('lang', 'tr');

    await user.click(screen.getByRole('button', { name: 'Sonraki cümle' }));
    expect(screen.getByText(/She/)).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: /İş/ }));
    expect(await screen.findByText(/Our team can/)).toBeInTheDocument();
  });

  it('like is a toggle with a text label; reject hides the sentence for good', async () => {
    const user = userEvent.setup();
    localStorage.setItem('engapp.examples.open', '1');
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    const like = await screen.findByRole('button', { name: 'Beğen' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
    await user.click(like);
    expect(await screen.findByRole('button', { name: 'Beğendin' })).toHaveAttribute('aria-pressed', 'true');
    expect((await db.content_feedback.toArray()).map((f) => f.verdict)).toEqual(['like']);

    await user.click(screen.getByRole('button', { name: 'Cümle için diğer işlemler' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reddet' }));
    await waitFor(() => expect(screen.queryByText(/We had to/)).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/She/)).toBeInTheDocument();
    expect((await db.content_feedback.filter((f) => f.target_id === 'e1').toArray())[0]?.verdict).toBe('reject');
  });

  it('edits stay private and show instead of the shared sentence', async () => {
    const user = userEvent.setup();
    localStorage.setItem('engapp.examples.open', '1');
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    await user.click(await screen.findByRole('button', { name: 'Cümle için diğer işlemler' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Düzenle' }));
    const box = await screen.findByRole('textbox', { name: 'Cümle' });
    await user.clear(box);
    await user.type(box, 'I had to cope with a late train.');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Düzenlendi')).toBeInTheDocument();
    expect(screen.getByText(/late train/)).toBeInTheDocument();
    expect(await db.user_content.count()).toBe(1);
    expect((await db.lexicon_examples.get('e1'))!.text_en).toBe('We had to cope with the delay.');
  });

  it('without an account an empty context says how to get sentences, with no AI button', async () => {
    const user = userEvent.setup();
    localStorage.setItem('engapp.examples.open', '1');
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    await user.click(await screen.findByRole('tab', { name: /Resmi/ }));
    expect(await screen.findByText('Örnek cümleler için Google ile giriş yap.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yenisini üret' })).not.toBeInTheDocument();
  });

  it('the back repeats the rotating sentence of the front, its translation behind a tap', async () => {
    const user = userEvent.setup();
    renderRoute(<CardBack view={await view(1)} isNew={false} speech={speech} />);
    expect(await screen.findByText(/We had to/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Türkçesini göster' }));
    expect(screen.getByText('Gecikmeyle başa çıkmak zorunda kaldık.')).toBeInTheDocument();
  });
});
