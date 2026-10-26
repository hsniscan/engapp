// "Haftalık rapor" tab of the stats screen (v0.3 İP7). The numbers are the device's
// (domain/weeklyReport.ts); the comment is ai-report's, shown only as text under them; the
// suggestion is one fixed focus with one button.
import { useLiveQuery } from 'dexie-react-hooks';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  db,
  getSettings,
  listWeeklyReports,
  logError,
  markReportSeen,
  type ReportListItem,
  updateSettings,
} from '@/data';
import type { ReportGroupStat, WeeklyReportSummary } from '@/domain/types';
import { shownRetention } from '@/domain/weeklyReport';
import { newLimitAction } from '@/domain/progressView';
import { practiceHref } from '@/features/extra/links';
import { formatDayMonth, formatNumber, formatPercent } from '@/features/stats/format';
import { groupLabel } from '@/features/stats/groupLabel';
import { Button, buttonClasses, Skeleton, Surface, toast } from '@/ui';
import { kickReports } from './queue';

/**
 * `onOpen` runs once when the tab opens (default: the report runner, so this week's report and
 * a missing comment are made now instead of at the next hourly run).
 */
export function ReportPanel({ onOpen = kickReports }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  useEffect(() => onOpen(), [onOpen]);
  const view = useLiveQuery(async () => {
    const [reports, sources] = await Promise.all([listWeeklyReports(), db.sources.toArray()]);
    return { reports, sourceTitles: Object.fromEntries(sources.map((s) => [s.id, s.title])) };
  }, []);
  const latest = view?.reports[0];
  const latestWeek = latest?.week;

  // Opening the tab is seeing the report: the home note goes away.
  useEffect(() => {
    if (latestWeek)
      void markReportSeen(latestWeek).catch((e: unknown) => void logError(e, 'report.seen'));
  }, [latestWeek]);

  if (!view) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">{t('report.loading')}</span>
        <Surface padding="lg">
          <Skeleton lines={5} />
        </Surface>
      </div>
    );
  }
  if (!latest) {
    return (
      <Surface padding="lg">
        <p className="text-[0.9375rem] text-fg">{t('report.empty')}</p>
      </Surface>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <ReportCard report={latest} sourceTitles={view.sourceTitles} />
      <PastReports reports={view.reports.slice(1)} />
    </div>
  );
}

function weekRange(s: Pick<WeeklyReportSummary, 'week' | 'week_end'>, t: TFunction): string {
  return t('report.weekRange', { from: formatDayMonth(s.week), to: formatDayMonth(s.week_end) });
}

function groupText(t: TFunction, g: ReportGroupStat, sourceTitles: Record<string, string>): string {
  return t('report.groupName', {
    name: groupLabel(t, g, sourceTitles),
    dimension: t(`progress.groups.dimensions.${g.dimension}`).toLocaleLowerCase('tr'),
  });
}

function ReportCard({
  report,
  sourceTitles,
}: {
  report: ReportListItem;
  sourceTitles: Record<string, string>;
}) {
  const { t } = useTranslation();
  const s = report.summary;
  const retention = shownRetention(s.retention);
  const numbers = [
    {
      key: 'active',
      label: t('report.activeDays'),
      value: t('report.activeDaysValue', { count: s.active_days }),
    },
    { key: 'reviews', label: t('report.reviews'), value: formatNumber(s.reviews) },
    {
      key: 'minutes',
      label: t('report.minutes'),
      value: t('report.minutesValue', { count: s.minutes }),
    },
    { key: 'learned', label: t('report.newLearned'), value: formatNumber(s.new_learned) },
    {
      key: 'retention',
      label: t('report.retention'),
      value: retention === null ? t('report.retentionFew') : formatPercent(retention),
      muted: retention === null,
    },
    {
      key: 'streak',
      label: t('report.streak'),
      value: t('report.streakValue', { count: s.streak }),
    },
  ];
  return (
    <Surface as="section" aria-labelledby="report-title" padding="lg" data-testid="weekly-report">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="report-title" className="font-serif text-xl font-semibold">
          {t('report.title')}
        </h2>
        <p className="text-sm text-fg-muted">{weekRange(s, t)}</p>
      </div>

      <dl
        aria-label={t('report.numbersLabel')}
        className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3"
      >
        {numbers.map((n) => (
          <div key={n.key} className="flex min-w-0 flex-col">
            <dt className="text-sm text-fg-muted">{n.label}</dt>
            <dd
              className={
                n.muted
                  ? 'mt-1 font-serif text-xl leading-tight text-fg-muted'
                  : 'tabular mt-1 font-serif text-3xl leading-tight font-semibold'
              }
            >
              {n.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-fg-muted">{t('report.retentionHint')}</p>

      <div className="mt-5 flex flex-col gap-1.5 text-[0.9375rem] text-fg">
        {s.strongest ? (
          <p>
            {t('report.strongest', {
              group: groupText(t, s.strongest, sourceTitles),
              rate: formatPercent(s.strongest.passed / s.strongest.n),
            })}
          </p>
        ) : null}
        {s.weakest ? (
          <p>
            {t('report.weakest', {
              group: groupText(t, s.weakest, sourceTitles),
              rate: formatPercent(s.weakest.passed / s.weakest.n),
            })}
          </p>
        ) : (
          <p className="text-fg-muted">{t('report.noGroups')}</p>
        )}
        {s.weakest && s.groups_days === 28 ? (
          <p className="text-xs text-fg-muted">{t('report.groups28')}</p>
        ) : null}
      </div>

      {s.goals.length > 0 ? (
        <div className="mt-5">
          <h3 className="font-medium">{t('report.goalsTitle')}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
            {s.goals.map((g) => (
              <li key={g.key} className="tabular">
                {t('report.goalLine', {
                  label: t(`goals.${g.key}`),
                  value: formatNumber(g.value),
                  target: formatNumber(g.target),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 rounded-card bg-surface-sunken p-4">
        <h3 className="font-medium">{t('report.commentTitle')}</h3>
        {report.comment ? (
          <>
            <p className="mt-1 text-[0.9375rem] text-fg" data-testid="report-comment">
              {report.comment}
            </p>
            <p className="mt-2 text-xs text-fg-muted">{t('report.commentNote')}</p>
          </>
        ) : (
          <p className="mt-1 text-[0.9375rem] text-fg-muted" data-testid="report-comment-missing">
            {report.pending ? t('report.commentPending') : t('report.commentNone')}
          </p>
        )}
      </div>

      <FocusBlock summary={s} />
    </Surface>
  );
}

const PRACTICE_FOCUS = new Set(['practice_weakest', 'practice_gap']);
const KNOWN_FOCUS = new Set([
  'lower_new_limit',
  'come_back',
  'practice_weakest',
  'practice_gap',
  'mnemonic_hard',
  'add_words',
  'keep_going',
]);

/** The focus of the week and its one button. An unknown key (a newer app) reads as keep_going. */
function FocusBlock({ summary: s }: { summary: WeeklyReportSummary }) {
  const { t } = useTranslation();
  const limit = useLiveQuery(async () => (await getSettings()).daily_new_limit, []);
  const [busy, setBusy] = useState(false);
  let focus = KNOWN_FOCUS.has(s.focus) ? s.focus : 'keep_going';
  const ids = s.focus_note_ids;
  if ((PRACTICE_FOCUS.has(focus) || focus === 'mnemonic_hard') && ids.length === 0)
    focus = 'keep_going';
  if (focus === 'lower_new_limit' && s.focus_value === null) focus = 'keep_going';
  const value = s.focus_value ?? 0;

  const actionClass = buttonClasses({
    className: 'h-auto! min-h-11 max-w-full py-2 text-center whitespace-normal!',
  });
  let action: React.ReactNode;
  const limitAction = focus === 'lower_new_limit' ? newLimitAction(limit, value) : null;
  if (focus === 'lower_new_limit') {
    // "Sınırı N yap" only when it really lowers the limit (v0.5.1): a limit the user already
    // lowered further must not be raised back by this button.
    action =
      limitAction === null ? null : limitAction === 'done' ? (
        <p className="text-sm text-fg-muted">{t('report.action.lower_new_limitDone', { value })}</p>
      ) : limitAction === 'already' ? (
        <p className="text-sm text-fg-muted">
          {t('report.action.lower_new_limitAlready', { limit })}
        </p>
      ) : (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            updateSettings({ daily_new_limit: value })
              .then(() =>
                toast({
                  title: t('report.action.lower_new_limitDone', { value }),
                  tone: 'success',
                }),
              )
              .catch((e: unknown) => void logError(e, 'report.limit'))
              .finally(() => setBusy(false));
          }}
        >
          {t('report.action.lower_new_limit', { value })}
        </Button>
      );
  } else if (PRACTICE_FOCUS.has(focus)) {
    action = (
      <Link
        to={practiceHref({
          source: 'list',
          size: ids.length > 10 ? 20 : 10,
          tag: null,
          notes: ids,
        })}
        className={actionClass}
      >
        {t(`report.action.${focus as 'practice_gap'}`, { count: ids.length })}
      </Link>
    );
  } else {
    const to =
      focus === 'mnemonic_hard'
        ? `/library?note=${encodeURIComponent(ids[0]!)}`
        : focus === 'add_words'
          ? '/add'
          : '/study?mode=word';
    action = (
      <Link to={to} className={actionClass}>
        {t(`report.action.${focus as 'come_back'}`)}
      </Link>
    );
  }
  return (
    <div
      className="mt-5 flex flex-col items-start gap-3 border-t border-border pt-5"
      data-testid="report-focus"
    >
      <h3 className="font-medium">{t('report.focusTitle')}</h3>
      <p className="text-[0.9375rem] text-fg">
        {t(`report.focus.${focus as 'come_back'}`, { value })}
      </p>
      {action}
    </div>
  );
}

function PastReports({ reports }: { reports: ReportListItem[] }) {
  const { t } = useTranslation();
  return (
    <Surface as="section" aria-labelledby="past-reports-title" padding="lg">
      <h2 id="past-reports-title" className="font-serif text-xl font-semibold">
        {t('report.pastTitle')}
      </h2>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{t('report.pastEmpty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {reports.map((r) => (
            <li key={r.week}>
              <details className="group py-3">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-control text-[0.9375rem]">
                  <span className="font-medium text-fg">{weekRange(r.summary, t)}</span>
                  <span className="tabular text-sm text-fg-muted">
                    {t('report.pastSummary', {
                      days: r.summary.active_days,
                      reviews: formatNumber(r.summary.reviews),
                      learned: r.summary.new_learned,
                    })}
                    {shownRetention(r.summary.retention) !== null
                      ? ` · ${formatPercent(shownRetention(r.summary.retention)!)}`
                      : ''}
                  </span>
                </summary>
                {r.comment ? <p className="mt-2 text-sm text-fg">{r.comment}</p> : null}
              </details>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
