// Settings → Hakkında → Kaynaklar: every licence that asks for credit is named (ADR 0074 adds
// Tatoeba and Wiktionary).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/ui';
import { SourcesPage } from './SourcesPage';

describe('Kaynaklar', () => {
  it('credits the word lists, Tatoeba and Wiktionary, and says where example sentences come from', () => {
    renderRoute(<SourcesPage />, { path: '/settings/kaynaklar' });
    const list = screen.getByRole('list', { name: 'Kaynaklar' });
    const card = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('li')!;
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(card('Tatoeba')).getByText('CC BY 2.0 FR')).toBeInTheDocument();
    expect(within(card('Tatoeba')).getByRole('link')).toHaveAttribute('href', 'https://tatoeba.org/downloads');
    expect(within(card('Wiktionary')).getByText('CC BY-SA 4.0')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Örnek cümleler' })).toBeInTheDocument();
    expect(screen.getByText(/eksik kalanları Claude \(Anthropic\) bir kez yazdı/)).toBeInTheDocument();
  });
});
