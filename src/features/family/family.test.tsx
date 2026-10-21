import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { morphologyFile } from '@/test/morphology';
import { addMorphemeCard, addNoteWithSenses, db, ensureSettings, getCardView } from '@/data';
import type { Note } from '@/domain/types';
import { CardBack } from '@/features/review/CardFaces';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { FamilySection } from './FamilySection';
import { resetFamilyLoaders } from './loaders';
import { MORPHOLOGY_ASSET } from './morphologyAsset';

const T = Date.UTC(2026, 9, 21, 9);
const file = morphologyFile;
const speech = { available: true, onSpeak: () => undefined };

async function add(term: string, meaning: string): Promise<Note> {
  return (await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning }] }, T)).note;
}

async function backOf(note: Note) {
  const card = (await db.cards.where('note_id').equals(note.id).toArray()).find((c) => c.card_type === 'recognition')!;
  return (await getCardView(card.id, T))!;
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T);
  resetFamilyLoaders();
  // The morphology file as a device that has opened it once has it (no network in tests).
  await db.ref_cache.put({ key: 'morphology', sha256: MORPHOLOGY_ASSET.sha256, data: file, fetched_at: T });
});

describe('false-friend strip on the card back', () => {
  it('warns with icon and text, and "Gizle" hides it for good', async () => {
    const note = await add('actually', 'aslında');
    renderRoute(<CardBack view={await backOf(note)} isNew={false} speech={speech} />);
    const strip = await screen.findByTestId('false-friend');
    expect(within(strip).getByText('Yanıltıcı benzer')).toBeInTheDocument();
    expect(within(strip).getByText('aktüel')).toHaveAttribute('lang', 'tr');
    expect(strip).toHaveTextContent('= güncel');
    expect(strip.querySelector('svg')).not.toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Gizle' }));
    await waitFor(() => expect(screen.queryByTestId('false-friend')).not.toBeInTheDocument());
    expect(await db.pair_note_feedback.get('actually|aktüel')).toMatchObject({ verdict: 'dismissed' });
  });

  it('"Hatalı" reports it; words without a pair get no strip', async () => {
    const note = await add('jest', 'şaka');
    const other = await add('table', 'masa');
    renderRoute(<CardBack view={await backOf(note)} isNew={false} speech={speech} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bu uyarı hatalı, bildir' }));
    await waitFor(() => expect(screen.queryByTestId('false-friend')).not.toBeInTheDocument());
    expect(await db.pair_note_feedback.get('jest|jest')).toMatchObject({ verdict: 'reported' });

    renderRoute(<CardBack view={await backOf(other)} isNew={false} speech={speech} />);
    await screen.findAllByText('masa');
    expect(screen.queryByTestId('false-friend')).not.toBeInTheDocument();
  });
});

describe('"Aile" in word detail', () => {
  it('shows the family with carded words bold and adds a faded word in one tap', async () => {
    const note = await add('inspect', 'denetlemek');
    await db.lexicon_cache.put({
      id: 'lex-1',
      term_id: 'term-1',
      lemma: 'inspector',
      lemma_norm: 'inspector',
      term_type: 'word',
      pos: 'noun',
      gloss_en: 'an official who inspects',
      meaning_tr: 'müfettiş',
      ipa: null,
      updated_at: T,
    });
    renderRoute(<FamilySection note={note} />);
    const section = await screen.findByTestId('family-section');
    expect(within(section).getByRole('heading', { name: 'Aile' })).toBeInTheDocument();
    expect(within(section).getByText('inspect')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(within(section).getByRole('button', { name: 'inspector kelimesini ekle' }));
    await waitFor(async () => expect((await db.notes.where('term_norm').equals('inspector').first())?.term_type).toBe('word'));
    const sense = await db.senses.filter((s) => s.meaning_tr === 'müfettiş').first();
    expect(sense).toMatchObject({ lexicon_sense_id: 'lex-1', pos: 'noun' });
    // The new word turns bold (no longer a button).
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'inspector kelimesini ekle' })).not.toBeInTheDocument());
  });

  it('opens the add form with the word filled in when no meaning can be looked up', async () => {
    const note = await add('inspect', 'denetlemek');
    const { router } = renderRoute(<FamilySection note={note} />);
    const section = await screen.findByTestId('family-section');
    // Offline in tests: no dictionary entry and no network.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      fireEvent.click(within(section).getByRole('button', { name: 'inspection kelimesini ekle' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/add'));
      expect(router.state.location.search).toBe('?term=inspection');
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });

  it('suggests a root card once three of the user words share the root', async () => {
    const note = await add('inspect', 'denetlemek');
    await add('respect', 'saygı');
    renderRoute(<FamilySection note={note} />);
    await screen.findByTestId('family-section');
    expect(screen.queryByTestId('morpheme-suggestion')).not.toBeInTheDocument();

    await add('spectator', 'seyirci');
    const box = await screen.findByTestId('morpheme-suggestion');
    expect(box).toHaveTextContent('-spect- kökü 3 kelimende geçiyor: inspect, respect, spectator.');
    fireEvent.click(within(box).getByRole('button', { name: 'Kök kartı ekle' }));
    await waitFor(() => expect(screen.queryByTestId('morpheme-suggestion')).not.toBeInTheDocument());
    const affix = await db.notes.where('term_norm').equals('-spect-').first();
    expect(affix?.term_type).toBe('affix');
    expect((await db.cards.where('note_id').equals(affix!.id).toArray()).map((c) => c.card_type)).toEqual(['recognition']);
  });

  it('closing the suggestion keeps it closed', async () => {
    const note = await add('inspect', 'denetlemek');
    await add('respect', 'saygı');
    await add('spectator', 'seyirci');
    renderRoute(<FamilySection note={note} />);
    const box = await screen.findByTestId('morpheme-suggestion');
    fireEvent.click(within(box).getByRole('button', { name: 'Bu öneriyi gösterme' }));
    await waitFor(() => expect(screen.queryByTestId('morpheme-suggestion')).not.toBeInTheDocument());
  });
});

describe('root card', () => {
  it('back lists the user words with the root; the front has no speak button', async () => {
    await add('inspect', 'denetlemek');
    await add('respect', 'saygı');
    const spect = file.morphemes.find((m) => m.id === 'spect')!;
    const { note } = await addMorphemeCard(spect, T);
    renderRoute(<CardBack view={await backOf(note)} isNew={false} speech={speech} />);
    const back = await screen.findByTestId('affix-back');
    expect(back).toHaveTextContent('Kelimelerinde: inspect · respect');
    expect(screen.queryByRole('button', { name: 'Sesli dinle' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('false-friend')).not.toBeInTheDocument();
  });
});
