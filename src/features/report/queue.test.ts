// Weekly report on the local database: made once per week after Monday's day start, numbers
// at once, the comment later (offline → online), given up on permanent errors.
import { beforeEach, describe, expect, it } from 'vitest';
import { AiClientError } from '@/ai/client';
import type { ReportRequest, ReportResponse } from '@/ai/report';
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureWeeklyReport,
  getGoalsView,
  getReportNotice,
  listWeeklyReports,
  markReportSeen,
  REPORT_COMMENT_WAIT_MS,
  REPORT_MAX_ATTEMPTS,
  setGoals,
  updateSettings,
} from '@/data';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { processReports, type ReportQueueDeps } from './queue';

const DAY = 86_400_000;
const HOUR = 3_600_000;
// Monday 19 October 2026, 13:00 in Istanbul (UTC+3): the report is about 12–18 October.
const MON = Date.UTC(2026, 9, 19, 10);
const WEEK = '2026-10-12';

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul', day_start_hour: 4 }, MON - 60 * DAY);
});

/** Words added before the week and answered on Tuesday, Wednesday and Thursday of it. */
async function studyLastWeek(): Promise<string[]> {
  const terms = ['apple', 'harvest', 'reluctant'];
  for (const term of terms) {
    const { note } = await addNoteWithSenses(
      { term, senses: [{ meaning_tr: 'x' }] },
      MON - 20 * DAY,
    );
    const cards = await db.cards.where('note_id').equals(note.id).toArray();
    for (const [i, c] of cards.entries()) {
      for (const d of [6, 5, 4])
        await answerCard(
          { card_id: c.id, rating: Rating.Good, duration_ms: 20_000 },
          MON - d * DAY + i * 60_000,
        );
    }
  }
  return terms;
}

function deps(
  over: Partial<ReportQueueDeps> & { at?: number; seen?: ReportRequest[] } = {},
): ReportQueueDeps {
  const seen = over.seen ?? [];
  return {
    comment: async (input: ReportRequest): Promise<ReportResponse> => {
      seen.push(input);
      return {
        prompt_version: 'report-v1',
        model: 'test-model',
        comment: `Bu hafta ${input.active_days} gün çalıştın. Düzenli gitmen çok iyi. Böyle devam et.`,
        counts: { sentences: 3, dropped: {} },
        usage: null,
      };
    },
    hasBackend: () => true,
    isOnline: () => true,
    isSignedIn: async () => true,
    now: () => over.at ?? MON,
    ...over,
  };
}

describe('weekly report', () => {
  it('is not made before anything was studied', async () => {
    expect(await ensureWeeklyReport(MON)).toEqual({ status: 'no_history', week: WEEK });
    expect(await db.report_drafts.count()).toBe(0);
  });

  it("before Monday's day start the last report is still the week before", async () => {
    await studyLastWeek();
    // Monday 03:30 in Istanbul, before the 04:00 day start: still Sunday.
    const early = Date.UTC(2026, 9, 19, 0, 30);
    expect((await ensureWeeklyReport(early)).week).toBe('2026-10-05');
  });

  it('shows the numbers offline at once and adds the comment when the device is online', async () => {
    const terms = await studyLastWeek();
    const offline = await processReports(deps({ isOnline: () => false }));
    expect(offline).toBe('offline');
    const [pending] = await listWeeklyReports();
    expect(pending).toMatchObject({ week: WEEK, comment: null, pending: true });
    expect(pending!.summary).toMatchObject({ active_days: 3, week_end: '2026-10-18' });
    expect(pending!.summary.reviews).toBeGreaterThan(0);
    expect(await db.weekly_reports.count()).toBe(0);
    expect(await db.outbox.where('table').equals('weekly_reports').count()).toBe(0);

    // A second run does not make a second report.
    await processReports(deps({ isOnline: () => false, at: MON + HOUR }));
    expect(await db.report_drafts.count()).toBe(1);

    const seen: ReportRequest[] = [];
    expect(await processReports(deps({ seen, at: MON + 2 * HOUR }))).toBe('idle');
    expect(seen).toHaveLength(1);
    // Only numbers and fixed names go to the AI: never a word of the user.
    const body = JSON.stringify(seen[0]);
    for (const t of terms) expect(body).not.toContain(t);
    expect(seen[0]).toMatchObject({ week: WEEK, active_days: 3 });

    const [final] = await listWeeklyReports();
    expect(final).toMatchObject({
      week: WEEK,
      pending: false,
      comment: 'Bu hafta 3 gün çalıştın. Düzenli gitmen çok iyi. Böyle devam et.',
    });
    expect(await db.report_drafts.count()).toBe(0);
    const row = (await db.weekly_reports.toArray())[0]!;
    expect(row).toMatchObject({ comment_model: 'test-model', prompt_version: 'report-v1' });
    expect(await db.outbox.where('table').equals('weekly_reports').count()).toBe(1);
  });

  it('waits while signed out, then gives the comment up after a week', async () => {
    await studyLastWeek();
    expect(await processReports(deps({ isSignedIn: async () => false }))).toBe('signed_out');
    expect(await db.report_drafts.count()).toBe(1);
    await processReports(deps({ isSignedIn: async () => false, at: MON + REPORT_COMMENT_WAIT_MS }));
    // The next Monday's report is made too (no study that week: the focus is coming back).
    const reports = await listWeeklyReports();
    expect(reports.find((r) => r.week === WEEK)).toMatchObject({ pending: false, comment: null });
    expect(reports.find((r) => r.week === '2026-10-19')).toMatchObject({ pending: true });
    expect(reports.find((r) => r.week === '2026-10-19')!.summary.focus).toBe('come_back');
  });

  it('a guest-only build keeps the report without a comment at once', async () => {
    await studyLastWeek();
    await processReports(deps({ hasBackend: () => false }));
    expect(await db.report_drafts.count()).toBe(0);
    expect((await db.weekly_reports.toArray())[0]).toMatchObject({ week: WEEK, comment: null });
  });

  it('a permanent error keeps the numbers without a comment', async () => {
    await studyLastWeek();
    await processReports(
      deps({
        comment: async () => {
          throw new AiClientError('bad_response', 'numbers');
        },
      }),
    );
    expect((await db.weekly_reports.toArray())[0]).toMatchObject({ comment: null });
  });

  it('a passing failure is retried later, at most a few times', async () => {
    await studyLastWeek();
    let calls = 0;
    const failing = (at: number) =>
      deps({
        at,
        comment: async () => {
          calls++;
          throw new AiClientError('ai_failed', 'model');
        },
      });
    await processReports(failing(MON));
    expect(await db.report_drafts.get(WEEK)).toMatchObject({
      attempts: 1,
      last_error: 'ai_failed',
    });
    // Not again before the backoff.
    await processReports(failing(MON + 60_000));
    expect(calls).toBe(1);
    for (let i = 1; i < REPORT_MAX_ATTEMPTS; i++) await processReports(failing(MON + i * 7 * HOUR));
    expect(calls).toBe(REPORT_MAX_ATTEMPTS);
    await processReports(failing(MON + REPORT_MAX_ATTEMPTS * 7 * HOUR));
    expect(await db.report_drafts.count()).toBe(0);
    expect((await db.weekly_reports.toArray())[0]).toMatchObject({ comment: null });
  });

  it('the daily AI limit postpones the comment without counting as a failure', async () => {
    await studyLastWeek();
    await processReports(
      deps({
        comment: async () => {
          throw new AiClientError('daily_limit', 'limit');
        },
      }),
    );
    expect(await db.report_drafts.get(WEEK)).toMatchObject({
      attempts: 0,
      last_error: 'daily_limit',
    });
  });

  it('the home note shows a new report until it is opened', async () => {
    await studyLastWeek();
    expect(await getReportNotice(MON)).toBeNull();
    await processReports(deps({ isOnline: () => false }));
    expect(await getReportNotice(MON)).toEqual({ week: WEEK });
    await markReportSeen(WEEK);
    expect(await getReportNotice(MON)).toBeNull();
  });
});

describe('goals', () => {
  it('are optional settings; progress counts this week and month; suggestions start modest', async () => {
    await studyLastWeek();
    let view = await getGoalsView(MON + 2 * DAY);
    expect(view.goals).toEqual({});
    expect(view.progress).toEqual([]);
    expect(view.suggestions.week_active_days).toMatchObject({ value: 4, basis: 'default' });

    await setGoals({ week_active_days: 5, week_minutes: null, month_new_terms: 20 }, MON + 2 * DAY);
    expect((await db.settings.get('settings'))?.goals).toEqual({
      week_active_days: 5,
      month_new_terms: 20,
    });
    // Study on Tuesday of this week.
    const card = (await db.cards.toArray())[0]!;
    await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 5000 }, MON + DAY);
    // Last week's words were recalled on two days only: none is learned yet (ADR 0041). A word
    // first studied in September and recalled again on Tuesday after 30 days is learned now.
    const { note } = await addNoteWithSenses({ term: 'orchard', senses: [{ meaning_tr: 'meyve bahçesi' }] }, MON - 31 * DAY);
    const rec = (await db.cards.where('note_id').equals(note.id).toArray()).find((c) => c.card_type === 'recognition')!;
    for (const at of [MON - 30 * DAY, MON - 30 * DAY + 12 * 60_000, MON + DAY + 60_000])
      await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 5000 }, at);
    view = await getGoalsView(MON + 2 * DAY);
    expect(view.progress.map((p) => [p.key, p.target, p.value])).toEqual([
      ['week_active_days', 5, 1],
      ['month_new_terms', 20, 1],
    ]);

    await setGoals(null, MON + 3 * DAY);
    expect((await db.settings.get('settings'))?.goals).toBeNull();
    // The goals change is synced like the other settings.
    expect(await db.outbox.where('table').equals('settings').count()).toBeGreaterThan(0);
  });

  it('out-of-range values are refused', async () => {
    await expect(setGoals({ week_active_days: 9 }, MON)).rejects.toThrow();
  });
});
