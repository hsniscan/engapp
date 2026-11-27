import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WordBankRow } from '../../../supabase/functions/_shared/wordbank-contract';
import { db } from '@/data';
import { entryFromRow } from '@/domain/wordBank';
import { readQuickAddSenses } from '@/features/add/addSheetStore';
import { resetDb } from '@/test/db';
import { installDomPolyfills } from '@/test/ui';
import { TooltipProvider } from '@/ui';
import { SharePage } from './SharePage';

beforeEach(resetDb);

const bankRow: WordBankRow = {
  lemma_norm: 'postpone',
  pos: 'verb',
  lemma: 'postpone',
  cefr: 'B2',
  list_source: 'cefrj',
  zipf: 3.4,
  lexicon_term_id: null,
  senses: [
    { meaning_tr: 'ertelemek', example_en: 'They postponed it.', example_tr: '', sense_id: null },
  ],
  retired: false,
  server_seq: 1,
};

function renderShare(url: string) {
  installDomPolyfills();
  const router = createMemoryRouter(
    [
      { path: '/share', element: <SharePage /> },
      { path: '/add', element: <p>add form</p> },
    ],
    { initialEntries: [url] },
  );
  render(
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>,
  );
  return router;
}

describe('a shared word (review 2026-11 3.5)', () => {
  it('opens the form with the bank meaning, in its dictionary form', async () => {
    await db.word_bank.put(entryFromRow(bankRow));
    const router = renderShare('/share?text=postponed');
    await screen.findByText('add form');
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('term')).toBe('postpone');
    expect(readQuickAddSenses(params).map((s) => s.meaning_tr)).toEqual(['ertelemek']);
  });

  it('an unknown word: the form with only the word', async () => {
    const router = renderShare('/share?text=zyzzyva');
    await waitFor(() => expect(router.state.location.pathname).toBe('/add'));
    expect(router.state.location.search).toBe('?term=zyzzyva');
  });
});
