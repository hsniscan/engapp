import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkloadView } from '@/data';
import { addDays, type DayKey } from '@/domain/day';
import { renderRoute } from '@/test/ui';
import { WorkloadChart } from './WorkloadChart';

describe('WorkloadChart', () => {
  it('calls the day after the study day "Yarın", also when it is the busiest day', () => {
    const start = '2026-11-26' as DayKey;
    const days = Array.from({ length: 30 }, (_, i) => addDays(start, i));
    const totals = days.map((_, i) => (i === 1 ? 86 : i === 0 ? 81 : 20));
    const view = {
      days,
      totals,
      capacity: 150,
      capacityMin: 20,
      secPerCard: 8,
      dailyNewLimit: 10,
    } as unknown as WorkloadView;
    renderRoute(<WorkloadChart view={view} />);
    expect(screen.getByText(/En yoğun gün yarın: yaklaşık 86 tekrar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Günlere göre liste' }));
    const rows = screen.getAllByRole('rowheader').map((r) => r.textContent);
    expect(rows.slice(0, 3)).toEqual(['Bugün', 'Yarın', expect.stringMatching(/^28 Kasım/)]);
  });
});
