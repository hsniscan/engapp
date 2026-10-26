// "Kısa yollar" (board Main): the hard words (a practice round that never moves the plan) and
// last week's report until it is opened (İlerleme marks it seen). Hidden when there is nothing to offer.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { practiceHref } from '@/features/extra/links';
import { REPORT_TAB_PARAM } from '@/features/report/links';
import { cn } from '@/ui';
import { HomeIcon, type HomeIconName } from './homeIcons';
import type { Shortcuts as ShortcutsData } from './todayQueries';

function Row({
  to,
  icon,
  tone,
  title,
  body,
  first,
  testId,
}: {
  to: string;
  icon: HomeIconName;
  tone: string;
  title: string;
  body: string;
  first: boolean;
  testId: string;
}) {
  return (
    <li className={cn(!first && 'border-t border-surface-sunken')}>
      <Link
        to={to}
        data-testid={testId}
        className="flex min-h-16 items-center gap-3.5 px-4 py-3.5 text-fg transition-colors duration-(--duration-micro) hover:bg-hover"
      >
        <span
          aria-hidden="true"
          className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone)}
        >
          <HomeIcon name={icon} size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-semibold">{title}</span>
          <span className="text-[0.8125rem] text-fg-muted">{body}</span>
        </span>
        <HomeIcon name="chevron" size={18} strokeWidth={1.8} className="text-fg-subtle" />
      </Link>
    </li>
  );
}

export function Shortcuts({ data, showHard }: { data: ShortcutsData; showHard: boolean }) {
  const { t } = useTranslation();
  const hard = showHard ? (data.more?.practice.hard ?? 0) : 0;
  const report = data.report;
  if (hard === 0 && !report) return null;
  return (
    <section aria-label={t('today.shortcuts')}>
      <ul className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface">
        {hard > 0 && (
          <Row
            to={practiceHref({ source: 'hard', size: 10, tag: null })}
            icon="loop"
            tone="bg-warn-soft text-warn-text"
            title={t('today.hardTitle', { count: hard })}
            body={t('today.hardBody')}
            first
            testId="shortcut-hard"
          />
        )}
        {report && (
          <Row
            to={`/progress?tab=${REPORT_TAB_PARAM}`}
            icon="report"
            tone="bg-accent-soft text-accent-text"
            title={t('today.reportTitle')}
            body={
              report.activeDays > 0
                ? t('today.reportBody', {
                    count: report.activeDays,
                    fresh: report.newCards,
                  })
                : t('today.reportBodyEmpty')
            }
            first={hard === 0}
            testId="report-note"
          />
        )}
      </ul>
    </section>
  );
}
