// "Geçen haftanın raporu hazır" on the home screen (v0.3 İP7) until the report is opened or
// the note is closed (data/weeklyReport.ts getReportNotice, per account on this device).
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getReportNotice, logError, markReportSeen } from '@/data';
import { REPORT_TAB_PARAM } from './links';
import { cn, IconButton } from '@/ui';

export function ReportHomeNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  // A live query: it re-reads when a report, a draft or the "seen" mark changes.
  const notice = useLiveQuery(() => getReportNotice(Date.now()), []);
  if (!notice) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-12 items-center gap-2 rounded-card border border-border bg-surface py-1 pr-1 pl-4',
        className,
      )}
      data-testid="report-note"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
      <p className="min-w-0 flex-1 text-[0.9375rem] text-fg">
        {t('report.homeNote')}{' '}
        <Link
          to={`/progress?tab=${REPORT_TAB_PARAM}`}
          className="font-medium text-accent-text underline underline-offset-4 hover:no-underline"
        >
          {t('report.homeOpen')}
        </Link>
      </p>
      <IconButton
        icon="x"
        label={t('common.close')}
        tooltip={false}
        onClick={() =>
          void markReportSeen(notice.week).catch((e: unknown) => void logError(e, 'report.seen'))
        }
      />
    </div>
  );
}
