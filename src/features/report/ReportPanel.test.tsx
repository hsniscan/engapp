import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getMeta, reportSeenKey, updateSettings } from '@/data';
import type { ReportDraft, WeeklyReport, WeeklyReportSummary } from '@/domain/types';
import { resetDb } from '@/test/db';
import { renderRoute } from '@/test/ui';
import { GoalsSection } from './GoalsSection';
import { ReportPanel } from './ReportPanel';

function summary(week: string, over: Partial<WeeklyReportSummary> = {}): WeeklyReportSummary {
  return {
    v: 1,
    week,
    week_end: `${week.slice(0, 8)}${String(Number(week.slice(8)) + 6).padStart(2, '0')}`,
    active_days: 5,
    reviews: 212,
    minutes: 64,
    new_cards: 30,
    new_learned: 18,
    retention: { n: 100, passed: 85 },
    groups_days: 7,
    strongest: { dimension: 'topic', key: 'travel', n: 40, passed: 38 },
    weakest: { dimension: 'level', key: 'C1', n: 30, passed: 21 },
    streak: 12,
    goals: [{ key: 'week_active_days', target: 6, value: 5 }],
    focus: 'practice_weakest',
    focus_note_ids: ['n1', 'n2', 'n3'],
    focus_value: null,
    ...over,
  };
}

function report(
  week: string,
  comment: string | null,
  over: Partial<WeeklyReportSummary> = {},
): WeeklyReport {
  return {
    id: `r-${week}`,
    user_id: null,
    week,
    summary: summary(week, over),
    comment,
    comment_model: comment ? 'm' : null,
    prompt_version: comment ? 'report-v1' : null,
    device_id: 'dev',
    created_at: 1,
    hlc: '001761000000000:00000:dev',
  };
}

const noop = () => {};

beforeEach(async () => {
  await resetDb();
});

describe('weekly report tab', () => {
  it('says when the first report comes', async () => {
    renderRoute(<ReportPanel onOpen={noop} />);
    expect(await screen.findByText(/İlk raporun/)).toBeInTheDocument();
  });

  it('shows the numbers, the comment, the focus button and the earlier reports', async () => {
    await db.weekly_reports.bulkPut([
      report(
        '2026-10-12',
        'Bu hafta 5 gün çalıştın. C1 kelimeleri biraz zorluyor. Kısa bir pratik iyi gelir.',
      ),
      report('2026-10-05', 'Önceki haftanın yorumu.', { active_days: 3, reviews: 90 }),
    ]);
    renderRoute(<ReportPanel onOpen={noop} />);
    const card = await screen.findByRole('region', { name: 'Geçen haftanın raporu' });
    expect(within(card).getByText('12 Ekim – 18 Ekim')).toBeInTheDocument();
    expect(within(card).getByText('5 / 7')).toBeInTheDocument();
    expect(within(card).getByText('212')).toBeInTheDocument();
    expect(within(card).getByText('64 dk')).toBeInTheDocument();
    expect(within(card).getByText('%85')).toBeInTheDocument();
    expect(within(card).getByText('En çok zorlandığın: C1 (seviye), %70')).toBeInTheDocument();
    expect(within(card).getByText('En iyi hatırladığın: Seyahat (konu), %95')).toBeInTheDocument();
    expect(within(card).getByText('Haftada çalışma günü: 5 / 6')).toBeInTheDocument();
    expect(within(card).getByTestId('report-comment')).toHaveTextContent(
      'C1 kelimeleri biraz zorluyor',
    );
    const link = within(card).getByRole('link', { name: '3 kelimeyle pratik yap' });
    expect(link.getAttribute('href')).toBe('/practice?source=list&size=10&notes=n1%2Cn2%2Cn3');

    const past = screen.getByRole('region', { name: 'Önceki raporlar' });
    expect(within(past).getByText('5 Ekim – 11 Ekim')).toBeInTheDocument();
    expect(within(past).getByText(/3 gün · 90 tekrar/)).toBeInTheDocument();

    // Opening the tab marks the report as seen (the home note goes away).
    await waitFor(async () => expect(await getMeta(reportSeenKey(null))).toBe('2026-10-12'));
  });

  it('a report waiting for its comment shows the numbers and says the comment comes later', async () => {
    const draft: ReportDraft = {
      week: '2026-10-12',
      report: report('2026-10-12', null, {
        focus: 'lower_new_limit',
        focus_value: 6,
        focus_note_ids: [],
      }),
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
    };
    await db.report_drafts.put(draft);
    await updateSettings({ daily_new_limit: 10 });
    renderRoute(<ReportPanel onOpen={noop} />);
    expect(await screen.findByTestId('report-comment-missing')).toHaveTextContent(
      'Yorum, internete bağlanınca eklenecek.',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Sınırı 6 yap' }));
    await waitFor(async () => expect((await db.settings.get('settings'))?.daily_new_limit).toBe(6));
    expect(
      await screen.findByText('Günlük yeni kart sınırın artık 6.', { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('"Sınırı N yap" never raises a limit the user already lowered', async () => {
    await db.weekly_reports.put(
      report('2026-10-12', null, { focus: 'lower_new_limit', focus_value: 6, focus_note_ids: [] }),
    );
    await updateSettings({ daily_new_limit: 4 });
    renderRoute(<ReportPanel onOpen={noop} />);
    const focus = await screen.findByTestId('report-focus');
    expect(
      await within(focus).findByText('Günlük yeni kart sınırın zaten 4; değiştirmen gerekmiyor.'),
    ).toBeInTheDocument();
    expect(within(focus).queryByRole('button', { name: /Sınırı/ })).toBeNull();
  });

  it('an unknown focus from a newer app reads as "keep going"', async () => {
    await db.weekly_reports.put(
      report('2026-10-12', null, { focus: 'something_new', focus_note_ids: [] }),
    );
    renderRoute(<ReportPanel onOpen={noop} />);
    const focus = await screen.findByTestId('report-focus');
    expect(within(focus).getByText('Her şey yolunda. Böyle devam et.')).toBeInTheDocument();
    expect(within(focus).getByRole('link', { name: 'Çalışmaya başla' })).toHaveAttribute(
      'href',
      '/study?mode=word',
    );
    expect(screen.getByText('Bu hafta için yorum yok.')).toBeInTheDocument();
  });
});

describe('goals', () => {
  it('are set in the dialog with a suggestion and shown as rings', async () => {
    await updateSettings({ timezone: 'Europe/Istanbul' });
    renderRoute(<GoalsSection />);
    expect(await screen.findByText(/Kendine bir hedef koy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hedef koy' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Önerimiz: 4 gün/)).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Öneriyi kullan: Haftada çalışma günü' }),
    );
    const minutes = within(dialog).getByLabelText('Haftada çalışma süresi (dakika)');
    await userEvent.type(minutes, '7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    // 7 minutes is not a multiple of 5: nothing is saved.
    expect(await within(dialog).findByText(/5 ve katları olan bir sayı/)).toBeInTheDocument();
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '90');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () =>
      expect((await db.settings.get('settings'))?.goals).toEqual({
        week_active_days: 4,
        week_minutes: 90,
      }),
    );
    expect(
      await screen.findByRole('img', { name: 'Bu hafta çalıştığın gün: 0 / 4 gün' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Bu hafta çalışma süresi: 0 / 90 dk' }),
    ).toBeInTheDocument();
  });

  it('keep the home goals, set the daily minutes and the target level, and clear all', async () => {
    const user = userEvent.setup();
    await updateSettings({
      timezone: 'Europe/Istanbul',
      level: 'B1',
      goals: { week_active_days: 5, day_minutes: 20, target_level: 'C1' },
    });
    renderRoute(<GoalsSection />);
    await user.click(await screen.findByRole('button', { name: 'Hedefleri değiştir' }));
    let dialog = await screen.findByRole('dialog');
    const day = within(dialog).getByLabelText('Günlük hedef (dakika)');
    expect(day).toHaveValue('20');
    const level = within(dialog).getByRole('combobox', { name: 'Hedef seviye' });
    expect(level).toHaveTextContent('C1');

    // Saving the report goals alone keeps the home goals.
    await user.type(within(dialog).getByLabelText('Haftada çalışma süresi (dakika)'), '90');
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () =>
      expect((await db.settings.get('settings'))?.goals).toEqual({
        week_active_days: 5,
        week_minutes: 90,
        day_minutes: 20,
        target_level: 'C1',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      await screen.findByRole('img', { name: 'Bu hafta çalışma süresi: 0 / 90 dk' }),
    ).toBeInTheDocument();

    // Daily minutes follow the same validation; the levels offered are those above B1.
    await user.click(screen.getByRole('button', { name: 'Hedefleri değiştir' }));
    dialog = await screen.findByRole('dialog');
    const day2 = within(dialog).getByLabelText('Günlük hedef (dakika)');
    await user.clear(day2);
    await user.type(day2, '7');
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByText(/5 ile 240 arasında, 5 ve katları/)).toBeInTheDocument();
    await user.clear(day2);
    await user.type(day2, '30');
    await user.click(within(dialog).getByRole('combobox', { name: 'Hedef seviye' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Bir sonraki seviye', 'B2 · İyi orta', 'C1 · İleri', 'C2 · Ustalık']);
    await user.click(screen.getByRole('option', { name: 'C2 · Ustalık' }));
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () =>
      expect((await db.settings.get('settings'))?.goals).toEqual({
        week_active_days: 5,
        week_minutes: 90,
        day_minutes: 30,
        target_level: 'C2',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // "Hedefleri kaldır" clears every goal, the home ones too.
    await user.click(screen.getByRole('button', { name: 'Hedefleri değiştir' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hedefleri kaldır' }));
    await waitFor(async () => expect((await db.settings.get('settings'))?.goals).toBeNull());
  });
});
