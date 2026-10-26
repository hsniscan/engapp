import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSettings, getStreakSummary, updateSettings } from '@/data';
import { addDays, dayKeyOf } from '@/domain/day';
import { emptyDay } from '@/domain/streak';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { StreakFreezeNote } from './StreakFreezeNote';

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await ensureSettings(Date.now() - 40 * DAY);
  await updateSettings({ timezone: 'Europe/Istanbul' });
});

async function studiedUntil(daysAgo: number, run = 8) {
  const today = dayKeyOf(Date.now(), { timezone: 'Europe/Istanbul', day_start_hour: 4 });
  const rows = Array.from({ length: run }, (_, i) => ({ ...emptyDay(addDays(today, -daysAgo - i)), reviews: 2, time_ms: 30_000 }));
  await db.daily_activity.bulkPut(rows);
}

describe('StreakFreezeNote', () => {
  it('covers a missed day on open, shows a calm note and closes', async () => {
    await studiedUntil(2); // yesterday was missed
    renderRoute(<StreakFreezeNote />);
    const note = await screen.findByTestId('streak-freeze-note');
    expect(note).toHaveTextContent('Serin korundu');
    expect(note).toHaveTextContent('Dün çalışılmadı.');
    expect(note).toHaveTextContent('Bu ay 1 koruma daha var.');
    expect(note).not.toHaveTextContent(/kaybett|üzül|kaçırdın/i);
    expect((await getStreakSummary()).currentStreak).toBe(8);
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByTestId('streak-freeze-note')).toBeNull());
  });

  it('shows nothing when yesterday was studied', async () => {
    await studiedUntil(1);
    renderRoute(<StreakFreezeNote />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('streak-freeze-note')).toBeNull();
    expect((await db.settings.get('settings'))!.streak_freezes ?? null).toBeNull();
  });
});
