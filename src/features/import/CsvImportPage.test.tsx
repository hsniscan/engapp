import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { CsvImportPage } from './CsvImportPage';

beforeEach(resetDb);

describe('CSV / word list: a Turkish-first list (ekle.md #7)', () => {
  it('is offered a column swap before anything is saved', async () => {
    renderRoute(<CsvImportPage />, { path: '/import/csv' });
    fireEvent.change(screen.getByLabelText('Ya da listeyi buraya yapıştır'), {
      target: { value: 'vazgeçmek,give up\nşemsiye;umbrella' },
    });
    expect(screen.getByTestId('word-list-reversed')).toHaveTextContent(
      'Türkçe kelimeler ilk sütunda',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sütunları değiştir' }));
    expect(screen.getByTestId('word-list-reversed')).toHaveTextContent('Sütunlar değiştirildi');
    fireEvent.click(screen.getByTestId('word-list-add'));
    await waitFor(async () => expect(await db.notes.count()).toBe(2));
    const terms = (await db.notes.toArray()).map((n) => n.term).sort();
    expect(terms).toEqual(['give up', 'umbrella']);
  });

  it('a normal list is not asked', () => {
    renderRoute(<CsvImportPage />, { path: '/import/csv' });
    fireEvent.change(screen.getByLabelText('Ya da listeyi buraya yapıştır'), {
      target: { value: 'give up - vazgeçmek\nbank;kıyı' },
    });
    expect(screen.getByText('2 kelime bulundu')).toBeInTheDocument();
    expect(screen.queryByTestId('word-list-reversed')).toBeNull();
  });
});
