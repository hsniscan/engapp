import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, setInterest, type CardView } from '@/data';
import { applyLexiconExamples as storeExamples } from '@/data/sync';
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
    // Only contexts that have sentences get a tab (nothing is generated on request).
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Günlük2', 'İş1']);
    expect(screen.queryByRole('button', { name: 'Yenisini üret' })).not.toBeInTheDocument();
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

  it('credits a Tatoeba sentence with its authors and a link to the source (ADR 0074)', async () => {
    await storeExamples([
      ex({
        id: 'e1',
        context: 'daily',
        source: 'tatoeba',
        attribution: { license: 'CC BY 2.0 FR', en_id: 1234, en_by: 'CK', tr_id: 5678, tr_by: 'duran' },
        updated_at: 3,
      }),
      ex({
        id: 'w1',
        context: 'work',
        text_en: 'Our team can cope with the extra work.',
        span: [13, 17],
        source: 'tatoeba',
        attribution: { license: 'CC BY 2.0 FR', en_id: 99, en_by: 'CK', tr_id: 100, tr_by: 'CK', tr_edited: true },
        updated_at: 3,
      }),
    ]);
    localStorage.setItem('engapp.examples.open', '1');
    const user = userEvent.setup();
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    // The model-written sentence carries no credit; the Tatoeba one names its authors.
    expect(await screen.findByText(/with stress well/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tatoeba/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sonraki cümle' }));
    const credit = await screen.findByRole('link', { name: 'Tatoeba · CK, duran' });
    expect(credit).toHaveAttribute('href', 'https://tatoeba.org/sentences/show/1234');
    // A corrected translation says so, and one author is named once.
    const tabs = screen.getByRole('tablist', { name: 'Bağlamlar' });
    await user.click(within(tabs).getByRole('tab', { name: /İş/ }));
    expect(await screen.findByRole('link', { name: 'Tatoeba · CK · çevirisi düzeltildi' })).toHaveAttribute(
      'href',
      'https://tatoeba.org/sentences/show/99',
    );
  });

  it('orders the context tabs by the interest profile (İP7) and follows its changes', async () => {
    localStorage.setItem('engapp.examples.open', '1');
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    const tabs = await screen.findByRole('tablist', { name: 'Bağlamlar' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Günlük2', 'İş1']);
    await setInterest('business', true, T);
    await waitFor(() =>
      expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['İş1', 'Günlük2']),
    );
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

  it('a sense without shipped sentences says so, with no AI button', async () => {
    await db.lexicon_examples.clear();
    localStorage.setItem('engapp.examples.open', '1');
    renderRoute(<CardBack view={await view()} isNew={false} speech={speech} />);
    expect(await screen.findByText('Bu anlam için henüz örnek cümle yok.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
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
