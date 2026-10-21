import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { buildHeatmap, emptyDay } from '@/domain/streak';
import { installDomPolyfills } from '@/test/ui';
import { Heatmap } from './Heatmap';

const day = (date: string, reviews: number, completed: boolean) => ({
  ...emptyDay(date),
  reviews,
  completed,
});

describe('heatmap', () => {
  const weeks = buildHeatmap(
    [day('2026-10-12', 45, true), day('2026-10-13', 1, false), day('2026-10-20', 12, false)],
    '2026-10-21',
  );

  it('labels every day in Turkish with its count and level', () => {
    installDomPolyfills();
    render(<Heatmap weeks={weeks} />);
    expect(
      screen.getByRole('grid', { name: 'Günlük tekrar takvimi, son 26 hafta' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(26 * 7);
    expect(
      screen.getByRole('gridcell', { name: '12 Ekim: 45 tekrar, tamamlandı' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '13 Ekim: 1 tekrar' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '14 Ekim: tekrar yok' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '21 Ekim: tekrar yok, bugün' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('gridcell', { name: '22 Ekim: henüz gelmedi' })).not.toHaveAttribute(
      'tabindex',
    );
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'PztPzt',
      'Sal',
      'ÇarÇar',
      'Per',
      'CumCum',
      'Cmt',
      'PazPaz',
    ]);
  });

  it('moves between days with the arrow keys and never past today', () => {
    installDomPolyfills();
    render(<Heatmap weeks={weeks} />);
    const today = screen.getByRole('gridcell', { name: /^21 Ekim/ });
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    expect(document.activeElement).toHaveAccessibleName('14 Ekim: tekrar yok');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAccessibleName('13 Ekim: 1 tekrar');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toHaveAccessibleName('20 Ekim: 12 tekrar');
    expect(screen.getByText('20 Ekim Salı')).toBeInTheDocument();
  });
});
