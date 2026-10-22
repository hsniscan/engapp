// "Anımsatıcı": suggestions are editable, rejectable and regenerable (plan acceptance
// criterion 9, device side); the chosen one shows on the card back; nothing but the lexicon
// sense id goes to the server.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MnemonicRequest, MnemonicResponse } from '@/ai/mnemonic';
import { AiClientError } from '@/ai/client';
import { addNoteWithSenses, db, ensureSettings, getCardView, getMnemonicView, type CardView } from '@/data';
import type { Id, Sense } from '@/domain/types';
import { setAuthStateForTesting } from '@/features/auth/session';
import { CardBack } from '@/features/review/CardFaces';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { Toaster } from '@/ui';
import { MnemonicHint } from './CardMnemonic';
import { MnemonicSection } from './MnemonicSection';
import { requestMnemonics, type MnemonicRequestDeps } from './request';

const T = Date.UTC(2026, 9, 23, 9);
const SOUND = 'Rölantide kalan motor gibi isteksiz: reluctant biri harekete geçmek istemez.';
const STORY = 'Annem beni yürüyüşe çağırdı, ben reluctant bir şekilde, isteksizce kalktım.';
const IMAGE = 'Kapının önünde ayaklarını sürüyen reluctant bir kedi düşün: hiç istekli değil.';

const sug = (id: string, type: 'sound' | 'story' | 'image', text: string, at: number) => ({
  id,
  sense_id: 'ls-rel',
  type,
  text_tr: text,
  why: type === 'sound' ? 'reluctant ile rölanti aynı seslerle başlar.' : null,
  updated_at: at,
});

function answer(p: Partial<MnemonicResponse>): MnemonicResponse {
  return {
    prompt_version: 'mnemonic-v1',
    ai_called: true,
    model: 'm',
    sense_id: 'ls-rel',
    suggestions: [],
    new_ids: [],
    none: false,
    exhausted: false,
    counts: { generated: 0, dropped: {} },
    usage: null,
    ...p,
  };
}

function fakeDeps(answers: MnemonicResponse[]): MnemonicRequestDeps & { calls: MnemonicRequest[] } {
  const calls: MnemonicRequest[] = [];
  return {
    calls,
    suggest: vi.fn(async (input: MnemonicRequest) => {
      calls.push(input);
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      return next;
    }),
    isOnline: () => true,
    isSignedIn: async () => true,
  };
}

let senses: Sense[] = [];

const signedIn = () =>
  setAuthStateForTesting({ status: 'signed_in', user: { id: 'u1', email: null, name: null, avatarUrl: null } });

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T);
  const res = await addNoteWithSenses({ term: 'reluctant', senses: [{ meaning_tr: 'isteksiz', lexicon_sense_id: 'ls-rel' }] }, T);
  senses = res.addedSenses;
  signedIn();
});
afterEach(() => setAuthStateForTesting({ status: 'guest', user: null }));

function renderSection(deps: MnemonicRequestDeps) {
  return renderRoute(
    <>
      <MnemonicSection termNorm="reluctant" senses={senses} requestDeps={deps} />
      <Toaster />
    </>,
  );
}

async function backView(): Promise<CardView> {
  const card = (await db.cards.toArray()).find((c) => c.card_type === 'recognition')!;
  return (await getCardView(card.id, T))!;
}

describe('Anımsatıcı section', () => {
  it('suggest, pick, edit, reject with undo, suggest another; the card back shows the pick', async () => {
    const user = userEvent.setup();
    const deps = fakeDeps([
      answer({ suggestions: [sug('pn-1', 'sound', SOUND, 1), sug('pn-2', 'story', STORY, 2)], new_ids: ['pn-1', 'pn-2'] }),
      answer({
        suggestions: [sug('pn-1', 'sound', SOUND, 1), sug('pn-2', 'story', STORY, 2), sug('pn-3', 'image', IMAGE, 3)],
        new_ids: ['pn-3'],
      }),
    ]);
    renderSection(deps);
    const section = await screen.findByTestId('mnemonic-section');
    expect(await within(section).findByText(/Henüz bir anımsatıcın yok/)).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Öner' }));
    expect(await within(section).findByText(SOUND)).toBeInTheDocument();
    expect(within(section).getByText('Ses benzerliği')).toBeInTheDocument();
    expect(within(section).getByText('Kısa hikâye')).toBeInTheDocument();
    expect(within(section).getByText('reluctant ile rölanti aynı seslerle başlar.')).toBeInTheDocument();
    // Only the lexicon sense id goes to the server.
    expect(deps.calls).toEqual([{ sense_id: 'ls-rel', more: false }]);

    // Pick the first one.
    const items = () => within(section).getAllByTestId('mnemonic-suggestion');
    await user.click(within(items()[0]!).getByRole('button', { name: 'Bunu seç' }));
    const chosen = await within(section).findByTestId('mnemonic-chosen');
    expect(within(chosen).getByText(SOUND)).toBeInTheDocument();
    expect(within(items()[0]!).getByRole('button', { name: 'Seçtin' })).toBeDisabled();

    // Edit it: the text becomes the user's own, marked "Düzenlendi".
    await user.click(within(chosen).getByRole('button', { name: 'Düzenle' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/yalnızca senin hesabında durur/)).toBeInTheDocument();
    const box = within(dialog).getByRole('textbox', { name: /Anımsatıcı/ });
    await user.clear(box);
    await user.type(box, 'Rölanti gibi ağır: reluctant.');
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(within(section).getByTestId('mnemonic-chosen')).toHaveTextContent('Rölanti gibi ağır: reluctant.'));
    expect(within(section).getByText('Düzenlendi')).toBeInTheDocument();

    // Reject the second one; undo brings it back.
    await user.click(within(items()[1]!).getByRole('button', { name: 'Reddet' }));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(within(section).getByText('Gizlediğin öneri: 1')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Geri al' }));
    await waitFor(() => expect(items()).toHaveLength(2));

    // "Başka öner" asks with more: true and shows the new one.
    await user.click(within(section).getByRole('button', { name: 'Başka öner' }));
    expect(await within(section).findByText(IMAGE)).toBeInTheDocument();
    expect(deps.calls[1]).toEqual({ sense_id: 'ls-rel', more: true });

    // The card back shows the user's mnemonic, small.
    renderRoute(<CardBack view={await backView()} isNew={false} speech={{ available: false, onSpeak: vi.fn() }} />);
    expect(await screen.findByTestId('card-mnemonic')).toHaveTextContent('Anımsatıcı: Rölanti gibi ağır: reluctant.');
  });

  it('says plainly when no good association was found and offers to write one', async () => {
    const user = userEvent.setup();
    const deps = fakeDeps([answer({ none: true })]);
    renderSection(deps);
    const section = await screen.findByTestId('mnemonic-section');
    await user.click(await within(section).findByRole('button', { name: 'Öner' }));
    expect(await within(section).findByText(/iyi bir çağrışım bulunamadı/)).toBeInTheDocument();
    expect(within(section).queryAllByTestId('mnemonic-suggestion')).toHaveLength(0);

    await user.click(within(section).getByRole('button', { name: 'Kendin yaz' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Anımsatıcı/ }), 'Gönülsüz giden reluctant olur.');
    await user.click(save);
    const chosen = await within(section).findByTestId('mnemonic-chosen');
    expect(within(chosen).getByText('Kendi yazdığın')).toBeInTheDocument();

    // "Kaldır" takes it away.
    await user.click(within(chosen).getByRole('button', { name: 'Kaldır' }));
    await waitFor(() => expect(within(section).queryByTestId('mnemonic-chosen')).toBeNull());
  });

  it('guests can write their own; suggestions need a sign-in', async () => {
    setAuthStateForTesting({ status: 'guest', user: null });
    renderSection(fakeDeps([]));
    const section = await screen.findByTestId('mnemonic-section');
    expect(await within(section).findByText(/öneri almak için Google ile giriş yap/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Öner' })).toBeDisabled();
    expect(within(section).getByRole('button', { name: 'Kendin yaz' })).toBeEnabled();
  });

  it('the front-of-card hint stays hidden until asked', async () => {
    const user = userEvent.setup();
    const { saveOwnMnemonic } = await import('@/data');
    await saveOwnMnemonic(senses[0]!.id, 'Gönülsüz giden reluctant olur.', {}, T);
    renderRoute(<MnemonicHint senseId={senses[0]!.id} />);
    const show = await screen.findByRole('button', { name: 'Anımsatıcıyı göster' });
    expect(screen.queryByText(/Gönülsüz giden/)).toBeNull();
    await user.click(show);
    expect(screen.getByText(/Gönülsüz giden/)).toBeInTheDocument();
  });
});

describe('requestMnemonics', () => {
  it('maps failures to what the user can do', async () => {
    const fail = (code: ConstructorParameters<typeof AiClientError>[0]) =>
      requestMnemonics(
        { lexiconSenseId: 'ls-rel', termNorm: 'reluctant', more: false },
        {
          ...fakeDeps([]),
          suggest: async () => {
            throw new AiClientError(code, code);
          },
        },
      );
    expect(await fail('daily_limit')).toEqual({ ok: false, error: 'daily_limit' });
    expect(await fail('quota_exceeded')).toEqual({ ok: false, error: 'busy' });
    expect(await fail('offline')).toEqual({ ok: false, error: 'offline' });
    expect(await fail('unauthorized')).toEqual({ ok: false, error: 'signed_out' });
    expect(await requestMnemonics({ lexiconSenseId: null, termNorm: 'x', more: false }, fakeDeps([]))).toEqual({
      ok: false,
      error: 'no_lexicon',
    });
    expect(
      await requestMnemonics({ lexiconSenseId: 'ls-rel', termNorm: 'x', more: false }, { ...fakeDeps([]), isOnline: () => false }),
    ).toEqual({ ok: false, error: 'offline' });
  });

  it('a second request for the same sense is answered from the shared table (no AI call): the device stores it the same way', async () => {
    const shared = answer({ ai_called: false, model: null, suggestions: [sug('pn-1', 'sound', SOUND, 1)] });
    const res = await requestMnemonics({ lexiconSenseId: 'ls-rel', termNorm: 'reluctant', more: false }, fakeDeps([shared]));
    expect(res).toEqual({ ok: true, newIds: [], none: false, exhausted: false, aiCalled: false });
    const v = await getMnemonicView(senses[0]!.id as Id);
    expect(v?.suggestions.map((s) => s.id)).toEqual(['pn-1']);
  });
});
