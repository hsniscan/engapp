// The word detail sheet's examples (2026-11-26 #5): the word bank's example leads where the
// user's own sentence is a fragment without a translation; the own sentence stays below.
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addNoteWithSenses, applyWordBankPage, ensureSettings } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { NoteDetailSheet } from './NoteDetailSheet';

const bankRow = {
  lemma_norm: 'ugly',
  pos: 'adjective',
  lemma: 'ugly',
  cefr: 'A2',
  list_source: 'cefrj',
  zipf: 4.5,
  lexicon_term_id: null,
  senses: [
    {
      meaning_tr: 'çirkin',
      example_en: 'What an ugly old building!',
      example_tr: 'Ne çirkin, eski bir bina!',
      sense_id: null,
    },
  ],
  retired: false,
  server_seq: 1,
};

beforeEach(async () => {
  await resetDb();
  await ensureSettings();
  await applyWordBankPage([bankRow]);
});

describe('NoteDetailSheet examples', () => {
  it('shows the bank example first and the weak own sentence as "Senin örneğin"', async () => {
    const { note } = await addNoteWithSenses({
      term: 'ugly',
      senses: [{ meaning_tr: 'çirkin', pos: 'adjective', source_sentence: 'ugly face', span: [0, 4] }],
    });
    renderRoute(<NoteDetailSheet noteId={note.id} onClose={vi.fn()} />);
    const bank = await screen.findByTestId('bank-example');
    expect(within(bank).getByRole('heading', { name: 'Örnek' })).toBeInTheDocument();
    expect(bank).toHaveTextContent('What an ugly old building!');
    expect(bank).toHaveTextContent('Ne çirkin, eski bir bina!');
    const own = screen.getByRole('heading', { name: 'Senin örneğin' });
    // Bank example above the user's sentence.
    expect(bank.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('ugly face')).toBeInTheDocument();
  });

  it('a full sentence the user translated stays the only example', async () => {
    const { note } = await addNoteWithSenses({
      term: 'ugly',
      senses: [
        {
          meaning_tr: 'çirkin',
          pos: 'adjective',
          source_sentence: 'The ugly duckling became a swan.',
          source_sentence_tr: 'Çirkin ördek yavrusu kuğu oldu.',
        },
      ],
    });
    renderRoute(<NoteDetailSheet noteId={note.id} onClose={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Senin örneğin' })).toBeInTheDocument();
    expect(screen.queryByTestId('bank-example')).toBeNull();
  });
});
