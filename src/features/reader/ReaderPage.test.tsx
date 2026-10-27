// The reader screen, Desteler → Okuma and Bugünün okuması (v0.5 İP1) on the real Dexie schema.
import { act, configure, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNoteWithSenses,
  applyWordBankPage,
  db,
  getText,
  saveText,
  setTextFinished,
  updateSettings,
} from '@/data';
import { setLevelDataForTests } from '@/data/levelData';
import { applyGradedCatalogPage, setGradedRemoteForTests } from '@/data/library';
import { resetKnowledgeCache } from '@/data/knowledge';
import { parseClientLevels } from '@/domain/level';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { setAuthStateForTesting } from '@/features/auth/session';
import { DecksPage } from '@/features/decks/DecksPage';
import { TextImportPanel } from '@/features/import/TextImportPanel';
import { READER_EXIT, ReaderPage } from './ReaderPage';
import { ReadingTab } from './ReadingTab';
import { TodayReadingCard } from './TodayReadingCard';
import { useListenAlong, type ListenAlongDeps } from './useListenAlong';

configure({ asyncUtilTimeout: 5000 });

const LEVELS = [
  '# @min_zipf 3',
  'walk\t5.1\tv:A1:j',
  'park\t5.0\tn:A1:j',
  'dog\t5.0\tn:A1:j',
  'morning\t5.2\tn:A1:j',
  'cope\t4.1\tv:B1:j',
  'serendipity\t3.1\tn:C2:o',
].join('\n');

const BODY =
  'Every morning I walk my dog in the park. It is quiet there.\n\nOne day I found serendipity in the park. I cope with it.';

beforeEach(async () => {
  await resetDb();
  resetKnowledgeCache();
  setLevelDataForTests(parseClientLevels(LEVELS));
  await updateSettings({ timezone: 'Europe/Istanbul', level: 'A2' });
  await applyWordBankPage([
    {
      lemma_norm: 'serendipity',
      pos: 'noun',
      lemma: 'serendipity',
      cefr: 'C2',
      list_source: 'octanove',
      zipf: 3.1,
      lexicon_term_id: null,
      senses: [
        {
          meaning_tr: 'mutlu tesadüf',
          example_en: 'It was pure serendipity.',
          example_tr: 'Tamamen mutlu bir tesadüftü.',
          sense_id: null,
        },
      ],
      retired: false,
      server_seq: 1,
    },
  ]);
});
afterEach(() => {
  setLevelDataForTests(null);
  setGradedRemoteForTests(undefined);
});

const openReader = (id: string) =>
  renderRoute(<ReaderPage />, { path: '/oku/:textId', url: `/oku/${id}` });
const word = (text: string) =>
  within(screen.getByTestId('reader-text')).getAllByText(text, { selector: '[data-t]' }).at(0)!;

describe('ReaderPage', () => {
  it('colours the text, shows the coverage and counts the encounters once per opening', async () => {
    const cope = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] });
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    const first = openReader(id);
    expect(await screen.findByRole('heading', { name: 'A walk' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('reader-coverage')).toHaveTextContent(
        /Bu metnin %\d+'sını biliyorsun/,
      ),
    );
    await waitFor(() => expect(word('serendipity')).toHaveAttribute('data-mark', 'new'));
    expect(word('cope')).toHaveAttribute('data-mark', 'learning');
    expect(word('walk')).not.toHaveAttribute('data-mark');
    await waitFor(async () =>
      expect(await db.encounters.where('note_id').equals(cope.note.id).count()).toBe(1),
    );
    first.unmount();
    // Same opening rendered again: nothing more is counted.
    openReader(id);
    await screen.findByTestId('reader-coverage');
    await new Promise((r) => setTimeout(r, 50));
    const rows = await db.encounters.where('note_id').equals(cope.note.id).toArray();
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(1);
    // The colours can be switched off.
    await updateSettings({ reader_highlight: false });
    await waitFor(() => expect(word('serendipity')).not.toHaveAttribute('data-mark'));
  });

  it('a tapped word: guess first, then the meaning offline, then a card with the sentence', async () => {
    const user = userEvent.setup();
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    openReader(id);
    await waitFor(() => expect(word('serendipity')).toHaveAttribute('data-mark', 'new'));
    await user.click(word('serendipity'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Önce cümleye bak/)).toBeInTheDocument();
    expect(within(sheet).queryByText('mutlu tesadüf')).toBeNull();
    await user.click(within(sheet).getByTestId('reader-reveal'));
    expect(await within(sheet).findByText('mutlu tesadüf')).toBeInTheDocument();
    await user.click(within(sheet).getByTestId('reader-add-card'));
    await within(sheet).findByText('Bu kelime kartlarında var.');
    const note = (await db.notes.toArray()).find((n) => n.term_norm === 'serendipity')!;
    const sense = (await db.senses.where('note_id').equals(note.id).toArray())[0]!;
    expect(sense).toMatchObject({
      meaning_tr: 'mutlu tesadüf',
      source_sentence: 'One day I found serendipity in the park.',
      span: [16, 27],
    });
    // The word now shows as a card being learned.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(word('serendipity')).toHaveAttribute('data-mark', 'learning'));
  });

  it('selects a phrase by growing the selection', async () => {
    const user = userEvent.setup();
    const id = await saveText({ kind: 'paste', title: 'P', body: 'I walk my dog every morning.' });
    openReader(id);
    await screen.findByTestId('reader-coverage');
    await user.click(word('walk'));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Sonrakiyle →' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'walk my' })).toBeInTheDocument(),
    );
  });

  it('finishing, "çok zor" and reading again', async () => {
    const user = userEvent.setup();
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    openReader(id);
    await user.click(await screen.findByTestId('reader-finish'));
    await user.click(await screen.findByRole('button', { name: 'Çok zor' }));
    await waitFor(async () => expect((await getText(id))!.feedback).toBe('hard'));
    expect((await db.settings.get('settings'))!.reading_offset).toBe(0.1);
    await user.click(screen.getByRole('button', { name: 'Yeniden oku' }));
    await waitFor(async () => expect((await getText(id))!.finished_at).toBeNull());
  });

  it('an unknown text id says so', async () => {
    openReader('nope');
    expect(await screen.findByText('Metin bulunamadı')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ v0.5.1 (decision 0054)

const GID = '00000000-0000-4000-8000-000000000001';
const GRADED_SENTENCES = [
  { en: 'The train was late.', tr: 'Tren geç kaldı.', audio_key: 'en-US/aaa.mp3', p: 0 },
  { en: 'We waited at the station.', tr: 'İstasyonda bekledik.', audio_key: 'en-US/bbb.mp3', p: 0 },
  { en: 'Then it came.', tr: 'Sonra geldi.', audio_key: null, p: 1 },
];
const GRADED_BODY = 'The train was late. We waited at the station.\n\nThen it came.';
const catalogRow = (n: number, title: string) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  level: 'A2',
  topic: 'travel',
  title,
  words: 12,
  tokens: 10,
  cov_level: 0.97,
  lemma_profile: { train: 1, late: 1, station: 1 },
  target_lemmas: ['station'],
  status: 'approved',
  server_seq: n,
});

async function seedGraded() {
  setGradedRemoteForTests(null);
  await applyGradedCatalogPage([catalogRow(1, 'The Late Train'), catalogRow(2, 'Another Day')]);
  await db.graded_bodies.put({
    id: GID,
    title: 'The Late Train',
    sentences: GRADED_SENTENCES,
    glosses: [],
    fetched_at: 1,
  });
}

describe('library texts in the reader', () => {
  it('shows the text from its sentences, each sentence’s Turkish, and keeps the body', async () => {
    const user = userEvent.setup();
    await seedGraded();
    // A row made by v0.5 (empty body): it opens all the same.
    const id = await saveText({
      kind: 'graded',
      graded_id: GID,
      title: 'The Late Train',
      body: '',
    });
    openReader(id);
    expect(await screen.findByRole('heading', { name: 'The Late Train' })).toBeInTheDocument();
    expect(screen.getByTestId('reader-text')).toHaveTextContent(
      'The train was late. We waited at the station.',
    );
    expect(word('station')).toBeInTheDocument();
    expect(screen.queryByText('Bu metnin içeriği henüz bu cihazda yok.')).toBeNull();
    await waitFor(async () => expect((await getText(id))!.body).toBe(GRADED_BODY));

    await user.click(screen.getByTestId('reader-translate'));
    const tr = screen.getAllByTestId('reader-translation');
    expect(tr.map((p) => p.textContent)).toEqual([
      'Tren geç kaldı. İstasyonda bekledik.',
      'Sonra geldi.',
    ]);

    // A tapped word's sheet offers its sentence's Turkish.
    await user.click(word('station'));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Cümlenin Türkçesini göster' }));
    expect(within(sheet).getByTestId('reader-sentence-tr')).toHaveTextContent(
      'İstasyonda bekledik.',
    );
  });

  it('/oku/<library id> makes the reading row and opens it', async () => {
    await seedGraded();
    const { router } = renderRoute(<ReaderPage />, { path: '/oku/:textId', url: `/oku/${GID}` });
    expect(await screen.findByRole('heading', { name: 'The Late Train' })).toBeInTheDocument();
    const rows = await db.texts.toArray();
    expect(rows).toEqual([expect.objectContaining({ kind: 'graded', graded_id: GID })]);
    expect(router.state.location.pathname).toBe(`/oku/${rows[0]!.id}`);
  });

  it('a library text that is not on the device and cannot be fetched says so', async () => {
    setGradedRemoteForTests(null);
    const id = await saveText({ kind: 'graded', graded_id: GID, title: 'Gone', body: '' });
    openReader(id);
    expect(await screen.findByText('Bu metin henüz bu cihazda değil')).toBeInTheDocument();
  });
});

describe('reading position (v0.5.1)', () => {
  it('leaving saves the position on screen, not the end of the text', async () => {
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    const { unmount } = openReader(id);
    await screen.findByTestId('reader-coverage');
    unmount();
    await waitFor(async () => expect((await getText(id))!.read_ms).toBeGreaterThanOrEqual(0));
    await new Promise((r) => setTimeout(r, 50));
    expect((await getText(id))!.progress_offset).toBe(0);
  });

  it('a resumed text keeps its place when left without scrolling', async () => {
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    const third = BODY.indexOf('One day');
    await db.texts.update(id, { progress_offset: third });
    const { unmount } = openReader(id);
    expect(await screen.findByText('Kaldığın yerden')).toBeInTheDocument();
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect((await getText(id))!.progress_offset).toBe(third);
  });
});

describe('own words, the colour legend and the new words (v0.5.1)', () => {
  it('a word in the user’s cards shows its meaning at once; "Hep tahmin ettir" asks first', async () => {
    const user = userEvent.setup();
    await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] });
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    openReader(id);
    await waitFor(() => expect(word('cope')).toHaveAttribute('data-mark', 'learning'));
    await user.click(word('cope'));
    let sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('başa çıkmak')).toBeInTheDocument();
    expect(within(sheet).queryByTestId('reader-reveal')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await updateSettings({ reader_always_guess: true });
    await user.click(word('cope'));
    sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByTestId('reader-reveal')).toBeInTheDocument();
    expect(within(sheet).queryByText('başa çıkmak')).toBeNull();
  });

  it('shows the colour legend once', async () => {
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    const first = openReader(id);
    expect(await screen.findByTestId('reader-legend')).toHaveTextContent('Renklerin anlamı');
    first.unmount();
    openReader(id);
    await screen.findByTestId('reader-coverage');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('reader-legend')).toBeNull();
  });

  it('sums up the new words and adds several at once', async () => {
    const user = userEvent.setup();
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    openReader(id);
    const summary = await screen.findByTestId('reader-summary');
    expect(summary).toHaveTextContent(/Bu metinde \d+ yeni kelime gördün · 0 tanesini ekledin/);
    await user.click(within(summary).getByTestId('reader-new-words-open'));
    const sheet = await screen.findByRole('dialog', { name: 'Bu metindeki yeni kelimeler' });
    const list = await within(sheet).findByTestId('reader-new-words');
    expect(within(list).getByRole('checkbox', { name: /serendipity mutlu tesadüf/ })).toBeChecked();
    await user.click(within(sheet).getByTestId('reader-new-words-add'));
    await waitFor(async () =>
      expect((await db.notes.toArray()).map((n) => n.term_norm)).toContain('serendipity'),
    );
    const note = (await db.notes.toArray()).find((n) => n.term_norm === 'serendipity')!;
    expect((await db.senses.where('note_id').equals(note.id).toArray())[0]).toMatchObject({
      meaning_tr: 'mutlu tesadüf',
      source_sentence: 'One day I found serendipity in the park.',
    });
    await waitFor(() => expect(summary).toHaveTextContent(/· 1 tanesini ekledin/));
  });
});

describe('useListenAlong', () => {
  it('reads sentence by sentence, pre-generated audio first, device voice otherwise', () => {
    const played: string[] = [];
    const done: (() => void)[] = [];
    const deps: ListenAlongDeps = {
      ready: (t) => t.startsWith('B'),
      playReady: (t, _v, onDone) => (played.push(`mp3:${t}`), done.push(onDone), true),
      device: (t, _v, onDone) => (played.push(`tts:${t}`), done.push(onDone), true),
      prefetch: vi.fn(),
      playClip: vi.fn(() => true),
      prefetchClips: vi.fn(),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() =>
      useListenAlong(['A one.', '—', 'B two.', 'C three.'], 'en-US', true, deps),
    );
    act(() => void result.current.start(0));
    expect(result.current.current).toBe(0);
    act(() => done.shift()!());
    expect(result.current.current).toBe(2); // the dash is skipped
    act(() => done.shift()!());
    act(() => result.current.stop());
    expect(result.current.current).toBeNull();
    act(() => done.shift()!()); // a late "done" after stop does nothing
    expect(played).toEqual(['tts:A one.', 'mp3:B two.', 'tts:C three.']);
    expect(result.current.current).toBeNull();
    expect(deps.prefetch).toHaveBeenCalled();
  });
});

describe('useListenAlong with recorded sentences (library texts)', () => {
  it('plays each sentence’s clip, the device voice where a clip fails or is missing', () => {
    const played: string[] = [];
    const done: (() => void)[] = [];
    const deps: ListenAlongDeps = {
      ready: () => false,
      playReady: () => false,
      device: (t, _v, onDone) => (played.push(`tts:${t}`), done.push(onDone), true),
      prefetch: vi.fn(),
      playClip: (key, onDone, fallback) => {
        if (key === 'bad') return fallback();
        played.push(`clip:${key}`);
        done.push(onDone);
        return true;
      },
      prefetchClips: vi.fn(),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() =>
      useListenAlong(['One.', 'Two.', 'Three.'], 'en-GB', true, deps, ['a.mp3', 'bad', null]),
    );
    act(() => void result.current.start(0));
    act(() => done.shift()!());
    act(() => done.shift()!());
    act(() => done.shift()!());
    expect(played).toEqual(['clip:a.mp3', 'tts:Two.', 'tts:Three.']);
    expect(deps.prefetchClips).toHaveBeenCalledWith(['bad', null]);
    expect(result.current.current).toBeNull();
  });
});

describe('Okuma tab and Bugünün okuması', () => {
  it('lists my texts with their progress and deletes one', async () => {
    const user = userEvent.setup();
    const a = await saveText({ kind: 'paste', title: 'First text', body: BODY }, 1000);
    const b = await saveText(
      { kind: 'pdf', title: 'Book', body: BODY, source_url: 'book.pdf' },
      2000,
    );
    await setTextFinished(b, true, 3000);
    renderRoute(<ReadingTab />);
    const list = await screen.findByTestId('my-texts');
    expect(within(list).getByRole('link', { name: /First text/ })).toHaveAttribute(
      'href',
      `/oku/${a}`,
    );
    expect(within(list).getByText('Bitti')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: '“First text” metnini sil' }));
    await user.click(await screen.findByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /First text/ })).toBeNull());
    expect((await db.texts.get(a))!.deleted_at).not.toBeNull();
  });

  it('a library text I opened is listed once, as "Okunuyor %x · Devam et"', async () => {
    await seedGraded();
    const id = await saveText({
      kind: 'graded',
      graded_id: GID,
      title: 'The Late Train',
      body: GRADED_BODY,
    });
    await db.texts.update(id, { progress_offset: GRADED_BODY.indexOf('Then') });
    renderRoute(<ReadingTab />);
    const mine = await screen.findByTestId('my-texts');
    const link = within(mine).getByRole('link', { name: /The Late Train/ });
    expect(link).toHaveTextContent(/Okunuyor %\d+/);
    expect(link).toHaveTextContent('Devam et');
    const library = await screen.findByRole('list', { name: 'Metinler' });
    await waitFor(() => expect(within(library).getAllByRole('listitem')).toHaveLength(1));
    expect(library).toHaveTextContent('Another Day');
    expect(library).not.toHaveTextContent('The Late Train');
  });

  it('Kelimelerim has no Okuma segment any more (it lives in Keşfet › Okuma)', async () => {
    renderRoute(<DecksPage />, { path: '/decks', url: '/decks?tab=reading' });
    expect(screen.queryByRole('link', { name: 'Okuma' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Metinlerim' })).toBeNull();
    expect(READER_EXIT).toBe('/kesfet?f=okuma');
  });

  it('Bugün: continue the unfinished text, else invite a paste', async () => {
    const { unmount } = renderRoute(<TodayReadingCard />);
    expect(await screen.findByText(/Okumak istediğin bir metni yapıştır/)).toBeInTheDocument();
    unmount();
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    renderRoute(<TodayReadingCard />);
    expect(await screen.findByRole('link', { name: /A walk/ })).toHaveAttribute(
      'href',
      `/oku/${id}`,
    );
  });
});

describe('Okuyucuda aç', () => {
  const panel = () => renderRoute(<TextImportPanel />, { path: '*', url: '/add?tab=paste' });

  it('a guest pastes a text and it opens in the reader (no account, no AI)', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({ status: 'guest', user: null });
    const { router } = panel();
    // v0.5.1: the paste box is open for guests too; only extraction asks for sign-in.
    expect(screen.queryByTestId('capture-extract')).toBeNull();
    await user.click(screen.getByRole('textbox', { name: 'İngilizce metin' }));
    await user.paste('The cat sat on the mat.');
    await user.click(screen.getByRole('button', { name: /^Okuyucuda aç/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    const id = router.state.location.pathname.split('/')[2]!;
    expect(await getText(id)).toMatchObject({
      kind: 'paste',
      title: 'The cat sat on the mat.',
      body: 'The cat sat on the mat.',
    });
  });

  it('signed in: next to "Kelimeleri çıkar" in the paste form', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({
      status: 'signed_in',
      user: { id: 'u1', email: 'h@example.com', name: 'Hasan', avatarUrl: null },
    });
    const { router } = panel();
    await user.click(await screen.findByRole('textbox', { name: 'İngilizce metin' }));
    await user.paste('Dogs bark at night.');
    await user.click(screen.getByTestId('open-in-reader'));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    expect(await db.import_jobs.count()).toBe(0); // reading starts no AI import
  });
});
