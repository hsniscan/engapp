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
import { resetKnowledgeCache } from '@/data/knowledge';
import { parseClientLevels } from '@/domain/level';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { setAuthStateForTesting } from '@/features/auth/session';
import { DecksPage } from '@/features/decks/DecksPage';
import { TextImportPanel } from '@/features/import/TextImportPanel';
import { ReaderPage } from './ReaderPage';
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
afterEach(() => setLevelDataForTests(null));

const openReader = (id: string) => renderRoute(<ReaderPage />, { path: '/oku/:textId', url: `/oku/${id}` });
const word = (text: string) =>
  within(screen.getByTestId('reader-text'))
    .getAllByText(text, { selector: '[data-t]' })
    .at(0)!;

describe('ReaderPage', () => {
  it('colours the text, shows the coverage and counts the encounters once per opening', async () => {
    const cope = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] });
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    const first = openReader(id);
    expect(await screen.findByRole('heading', { name: 'A walk' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('reader-coverage')).toHaveTextContent(/Bu metnin %\d+'sını biliyorsun/));
    await waitFor(() => expect(word('serendipity')).toHaveAttribute('data-mark', 'new'));
    expect(word('cope')).toHaveAttribute('data-mark', 'learning');
    expect(word('walk')).not.toHaveAttribute('data-mark');
    await waitFor(async () => expect(await db.encounters.where('note_id').equals(cope.note.id).count()).toBe(1));
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
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'walk my' })).toBeInTheDocument());
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

describe('useListenAlong', () => {
  it('reads sentence by sentence, pre-generated audio first, device voice otherwise', () => {
    const played: string[] = [];
    const done: (() => void)[] = [];
    const deps: ListenAlongDeps = {
      ready: (t) => t.startsWith('B'),
      playReady: (t, _v, onDone) => (played.push(`mp3:${t}`), done.push(onDone), true),
      device: (t, _v, onDone) => (played.push(`tts:${t}`), done.push(onDone), true),
      prefetch: vi.fn(),
      cancel: vi.fn(),
    };
    const { result } = renderHook(() => useListenAlong(['A one.', '—', 'B two.', 'C three.'], 'en-US', true, deps));
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

describe('Okuma tab and Bugünün okuması', () => {
  it('lists my texts with their progress and deletes one', async () => {
    const user = userEvent.setup();
    const a = await saveText({ kind: 'paste', title: 'First text', body: BODY }, 1000);
    const b = await saveText({ kind: 'pdf', title: 'Book', body: BODY, source_url: 'book.pdf' }, 2000);
    await setTextFinished(b, true, 3000);
    renderRoute(<ReadingTab />);
    const list = await screen.findByTestId('my-texts');
    expect(within(list).getByRole('link', { name: /First text/ })).toHaveAttribute('href', `/oku/${a}`);
    expect(within(list).getByText('Bitti')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: '"First text" metnini sil' }));
    await user.click(await screen.findByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /First text/ })).toBeNull());
    expect((await db.texts.get(a))!.deleted_at).not.toBeNull();
  });

  it('Desteler has the Okuma segment', async () => {
    renderRoute(<DecksPage />, { path: '/decks', url: '/decks?tab=reading' });
    const nav = screen.getByRole('navigation', { name: 'Deste görünümü' });
    expect(within(nav).getByRole('link', { name: 'Okuma' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Metinlerim' })).toBeInTheDocument();
  });

  it('Bugün: continue the unfinished text, else invite a paste', async () => {
    const { unmount } = renderRoute(<TodayReadingCard />);
    expect(await screen.findByText(/Okumak istediğin bir metni yapıştır/)).toBeInTheDocument();
    unmount();
    const id = await saveText({ kind: 'paste', title: 'A walk', body: BODY });
    renderRoute(<TodayReadingCard />);
    expect(await screen.findByRole('link', { name: /A walk/ })).toHaveAttribute('href', `/oku/${id}`);
  });
});

describe('Okuyucuda aç', () => {
  const panel = () =>
    renderRoute(<TextImportPanel />, { path: '*', url: '/add?tab=paste' });

  it('a guest pastes a text and it opens in the reader (no account, no AI)', async () => {
    const user = userEvent.setup();
    setAuthStateForTesting({ status: 'guest', user: null });
    const { router } = panel();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByTestId('reader-paste-open'));
    await user.click(screen.getByRole('textbox', { name: 'İngilizce metin' }));
    await user.paste('The cat sat on the mat.');
    await user.click(screen.getByRole('button', { name: 'Okuyucuda aç' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/oku\//));
    const id = router.state.location.pathname.split('/')[2]!;
    expect(await getText(id)).toMatchObject({ kind: 'paste', title: 'The cat sat on the mat.', body: 'The cat sat on the mat.' });
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
