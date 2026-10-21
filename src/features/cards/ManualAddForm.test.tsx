import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, findNoteByTerm } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { AddPage } from './AddPage';

beforeEach(resetDb);

describe('manual add (Elle)', () => {
  it('creates a new note with a sense, an example sentence span and its cards', async () => {
    const user = userEvent.setup();
    renderRoute(<AddPage />, { path: '/add' });

    await user.type(screen.getByLabelText('İngilizce kelime ya da kalıp'), 'bank');
    await user.type(screen.getByLabelText('Türkçe anlamı'), 'kıyı');
    await user.type(screen.getByLabelText(/Örnek cümle/), 'We sat on the bank of the river.');
    expect(await screen.findByText('bank', { selector: 'mark' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kartı kaydet' }));

    await waitFor(async () => expect(await db.notes.count()).toBe(1));
    const found = await findNoteByTerm('bank');
    expect(found?.note.term_type).toBe('word');
    expect(found?.senses).toHaveLength(1);
    const sense = found!.senses[0]!;
    expect(sense.meaning_tr).toBe('kıyı');
    expect(sense.source_sentence!.slice(...sense.span!)).toBe('bank');
    const cards = await db.cards.where('note_id').equals(found!.note.id).toArray();
    expect(cards.map((c) => c.card_type).sort()).toEqual(['cloze', 'production', 'recognition']);
    // The form is cleared for the next word.
    expect(screen.getByLabelText('İngilizce kelime ya da kalıp')).toHaveValue('');
  });

  it('shows required errors instead of saving an empty meaning', async () => {
    const user = userEvent.setup();
    renderRoute(<AddPage />, { path: '/add' });
    await user.type(screen.getByLabelText('İngilizce kelime ya da kalıp'), 'give up');
    await user.click(screen.getByRole('button', { name: 'Kartı kaydet' }));
    expect(await screen.findByText('Türkçe anlamı yaz.')).toBeInTheDocument();
    expect(await db.notes.count()).toBe(0);
  });

  it('detects an existing note and adds a new sense to it', async () => {
    const user = userEvent.setup();
    renderRoute(<AddPage />, { path: '/add' });
    const term = screen.getByLabelText('İngilizce kelime ya da kalıp');
    await user.type(term, 'bank');
    await user.type(screen.getByLabelText('Türkçe anlamı'), 'banka');
    await user.click(screen.getByRole('button', { name: 'Kartı kaydet' }));
    await waitFor(async () => expect(await db.notes.count()).toBe(1));

    await user.type(term, 'Bank');
    expect(await screen.findByText('Bu kelime zaten var; yeni anlam ekle')).toBeInTheDocument();
    expect(screen.getByText('1. banka')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Türkçe anlamı'), 'kıyı');
    await user.click(screen.getByRole('button', { name: 'Anlamı ekle' }));

    await waitFor(async () => expect((await findNoteByTerm('bank'))?.senses).toHaveLength(2));
    expect(await db.notes.count()).toBe(1);
    const senses = (await findNoteByTerm('bank'))!.senses.sort((a, b) => a.sense_no - b.sense_no);
    expect(senses.map((s) => s.meaning_tr)).toEqual(['banka', 'kıyı']);
  });

  it('picks "phrase" for a multi-word term and keeps the privacy note on the import tabs', async () => {
    const user = userEvent.setup();
    renderRoute(<AddPage />, { path: '/add' });
    await user.type(screen.getByLabelText('İngilizce kelime ya da kalıp'), 'give up');
    expect(screen.getByRole('radio', { name: 'Söz öbeği' })).toBeChecked();
    await user.click(screen.getByRole('tab', { name: /Metin yapıştır/ }));
    expect(await screen.findByText('Gizli iş belgelerini yükleme.')).toBeInTheDocument();
  });
});
