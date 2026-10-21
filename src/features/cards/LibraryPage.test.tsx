import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db } from '@/data';
import { CardState } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { LibraryPage } from './LibraryPage';

beforeEach(async () => {
  await resetDb();
  await addNoteWithSenses(
    {
      term: 'bank',
      senses: [
        { meaning_tr: 'banka' },
        { meaning_tr: 'kıyı', source_sentence: 'We sat on the bank.', span: [14, 18] },
      ],
      tags: ['su'],
    },
    1000,
  );
  await addNoteWithSenses(
    { term: 'give up', senses: [{ meaning_tr: 'vazgeçmek' }], tags: ['iş'] },
    2000,
  );
  await addNoteWithSenses({ term: 'tide', senses: [{ meaning_tr: 'gelgit' }] }, 3000);
});

const rowTerms = () =>
  within(screen.getByRole('list', { name: 'Notlar' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[lang="en"]')?.textContent);

describe('library', () => {
  it('lists notes newest first with their senses', async () => {
    renderRoute(<LibraryPage />, { path: '/library' });
    await waitFor(() => expect(rowTerms()).toEqual(['tide', 'give up', 'bank']));
    expect(screen.getByText(/1\. banka\s+·\s+2\. kıyı/)).toBeInTheDocument();
    expect(screen.getByText('3 not · 8 kart')).toBeInTheDocument();
  });

  it('searches terms and Turkish meanings, ignoring case and Turkish letters', async () => {
    const user = userEvent.setup();
    renderRoute(<LibraryPage />, { path: '/library' });
    await screen.findByRole('list', { name: 'Notlar' });
    await user.type(screen.getByRole('searchbox'), 'KIYI');
    await waitFor(() => expect(rowTerms()).toEqual(['bank']));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'vazgec');
    await waitFor(() => expect(rowTerms()).toEqual(['give up']));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('Eşleşen not yok')).toBeInTheDocument();
  });

  it('filters by state, card type, suspension and tag from the URL', async () => {
    const tide = (await db.notes.where('term_norm').equals('tide').first())!;
    const rec = (await db.cards
      .where('note_id')
      .equals(tide.id)
      .filter((c) => c.card_type === 'recognition')
      .first())!;
    await db.cards.update(rec.id, { state: CardState.Review });
    const bank = (await db.notes.where('term_norm').equals('bank').first())!;
    await db.cards.where('note_id').equals(bank.id).modify({ suspended: true });

    const r1 = renderRoute(<LibraryPage />, { path: '/library', url: '/library?state=review' });
    await waitFor(() => expect(rowTerms()).toEqual(['tide']));
    r1.unmount();

    const r2 = renderRoute(<LibraryPage />, { path: '/library', url: '/library?type=cloze' });
    await waitFor(() => expect(rowTerms()).toEqual(['bank']));
    r2.unmount();

    const r3 = renderRoute(<LibraryPage />, {
      path: '/library',
      url: '/library?suspended=suspended',
    });
    await waitFor(() => expect(rowTerms()).toEqual(['bank']));
    expect(screen.getByText('Askıda')).toBeInTheDocument();
    r3.unmount();

    renderRoute(<LibraryPage />, {
      path: '/library',
      url: '/library?tag=i%C5%9F&suspended=active',
    });
    await waitFor(() => expect(rowTerms()).toEqual(['give up']));
  });

  it('bulk-suspends the selected notes', async () => {
    const user = userEvent.setup();
    renderRoute(<LibraryPage />, { path: '/library' });
    await screen.findByRole('list', { name: 'Notlar' });
    await user.click(screen.getByRole('checkbox', { name: '“tide” notunu seç' }));
    await user.click(screen.getByRole('checkbox', { name: '“bank” notunu seç' }));
    const bar = screen.getByRole('region', { name: 'Seçili notlar için işlemler' });
    expect(within(bar).getByText('2 not seçili')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Askıya al' }));
    await waitFor(async () => expect(await db.cards.filter((c) => c.suspended).count()).toBe(6));
  });

  it('opens the detail sheet, edits a meaning and confirms deleting with focus on Vazgeç', async () => {
    const user = userEvent.setup();
    renderRoute(<LibraryPage />, { path: '/library' });
    await screen.findByRole('list', { name: 'Notlar' });
    await user.click(screen.getByRole('button', { name: /^tide/ }));
    const dialog = await screen.findByRole('dialog', { name: 'tide' });
    const meaning = within(dialog).getByLabelText('Türkçe anlamı');
    await user.clear(meaning);
    await user.type(meaning, 'gelgit, met-cezir');
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () =>
      expect(await db.senses.filter((s) => s.meaning_tr === 'gelgit, met-cezir').count()).toBe(1),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^bank/ }));
    const sheet = await screen.findByRole('dialog', { name: 'bank' });
    await user.click(within(sheet).getByRole('button', { name: 'Notu sil' }));
    const confirm = await screen.findByRole('dialog', { name: '“bank” silinsin mi?' });
    expect(within(confirm).getByRole('button', { name: 'Vazgeç' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Sil' }));
    await waitFor(async () =>
      expect((await db.notes.where('term_norm').equals('bank').first())?.deleted_at).not.toBeNull(),
    );
  });
});
