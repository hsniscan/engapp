import { cleanup, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, type CardView } from '@/data';
import type { CardType } from '@/domain/types';
import { setLevelDataForTests } from '@/data/levelData';
import { parseClientLevels } from '@/domain/level';
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

  it('back: a level badge that explains its source; dashed for an AI estimate', async () => {
    const speech = { available: true, onSpeak: vi.fn(), speakText: vi.fn() };
    setLevelDataForTests(parseClientLevels('# @min_zipf 3\nanniversary\t3.6\tn:B1:j:A2:Türkçede yıldönümü'));
    const view = await viewOf('recognition');
    renderRoute(<CardBack view={view} isNew={false} speech={speech} />);
    const button = await screen.findByRole('button', { name: /Seviye A2, CEFR-J listesi/ });
    expect(button).toHaveAttribute('data-level-source', 'cefrj');
    fireEvent.click(button);
    expect(await screen.findByText("CEFR-J: B1 → Türk öğrenci için A2 (AI: Türkçede yıldönümü)")).toBeInTheDocument();
    cleanup();

    // A lexicon level (here an AI estimate) wins over the client file.
    const lexView: CardView = {
      ...view,
      lexicon: new Map([
        ['lex-1', { id: 'lex-1', term_id: 't', lemma: 'anniversary', lemma_norm: 'anniversary', term_type: 'word', pos: 'noun',
          gloss_en: 'g', meaning_tr: 'yıldönümü', ipa: null, updated_at: 1, cefr: 'B2', cefr_source: 'ai' }],
      ]),
      senses: view.senses.map((s) => ({ ...s, lexicon_sense_id: 'lex-1' })),
    };
    renderRoute(<CardBack view={lexView} isNew={false} speech={speech} />);
    const ai = await screen.findByRole('button', { name: /Seviye B2, AI tahmini/ });
    expect(ai.querySelector('span')!.className).toContain('border-dashed');
    setLevelDataForTests(null);
  });
});
