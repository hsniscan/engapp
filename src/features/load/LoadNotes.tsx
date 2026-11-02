// Home screen notes of load management (docs/decisions/0021): vacation, the offer to review
// ahead before one, catch-up ("Telafi: 3 günde biter"), the new-card ramp, and the gentle
// warning when the forecast goes over capacity, with its one-tap new-card limit.
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  dismissLoadWarning,
  getLoadStatus,
  isLoadWarningSnoozed,
  logError,
  updateSettings,
  type LoadStatus,
  type WorkloadView,
} from '@/data';
import { formatDayLong } from '@/features/stats/format';
import { HomeNote } from '@/features/home/HomeNote';
import { Button, buttonClasses, cn, Icon, type IconName, toast } from '@/ui';
import { useWorkload } from './useWorkload';

function Note({
  id,
  icon,
  title,
  children,
  actions,
  tone = 'accent',
}: {
  id: string;
  icon: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: 'accent' | 'warn';
}) {
  return (
    <HomeNote
      titleId={`${id}-title`}
      data-testid={id}
      icon={icon}
      title={title}
      actions={actions}
      tone={tone === 'warn' ? 'warn' : 'calm'}
    >
      {children}
    </HomeNote>
  );
}

export function LoadNotes({ className }: { className?: string }) {
  const status = useLiveQuery(() => getLoadStatus(), []);
  const snoozed = useLiveQuery(() => isLoadWarningSnoozed(), []);
  if (!status) return null;
  const note = statusNote(status);
  return (
    <div className={cn('flex flex-col gap-4 empty:hidden', className)}>
      {note}
      {status.plan.mode !== 'catchup' && status.plan.mode !== 'vacation' && snoozed === false && (
        <LoadWarning />
      )}
    </div>
  );
}

function statusNote(s: LoadStatus): ReactNode {
  if (s.onVacation && s.vacation) return <VacationNow end={s.vacation.end} />;
  if (s.plan.mode === 'catchup') return <CatchupNote status={s} />;
  if (s.aheadDays > 0 && s.vacation) return <VacationSoon status={s} />;
  if (s.plan.mode === 'ramp') return <RampNote status={s} />;
  return null;
}

function VacationNow({ end }: { end: string }) {
  const { t } = useTranslation();
  return (
    <Note id="load-vacation" icon="sun" title={t('load.vacationTitle')}>
      <p>{t('load.vacationNow', { end: formatDayLong(end) })}</p>
    </Note>
  );
}

function VacationSoon({ status }: { status: LoadStatus }) {
  const { t } = useTranslation();
  return (
    <Note
      id="load-vacation-soon"
      icon="sun"
      title={t('load.vacationSoon', { date: formatDayLong(status.vacation!.start) })}
      actions={
        status.aheadCount > 0 && (
          <Link to="/study?mode=ahead" className={buttonClasses({ variant: 'secondary' })}>
            {t('load.vacationAheadAction')}
            <Icon name="chevron-right" size={18} />
          </Link>
        )
      }
    >
      {status.aheadCount > 0 && <p>{t('load.vacationAhead', { count: status.aheadCount })}</p>}
    </Note>
  );
}

function CatchupNote({ status }: { status: LoadStatus }) {
  const { t } = useTranslation();
  return (
    <Note
      id="load-catchup"
      icon="refresh"
      title={
        status.catchupDays === null
          ? t('load.catchupTitle')
          : t('load.catchupDays', { count: status.catchupDays })
      }
    >
      <p>
        {t('load.catchupBody', {
          backlog: status.backlogToday,
          cap: status.capacity,
        })}
      </p>
      {status.catchupDays === null && <p>{t('load.catchupLong')}</p>}
    </Note>
  );
}

function RampNote({ status }: { status: LoadStatus }) {
  const { t } = useTranslation();
  return (
    <Note id="load-ramp" icon="info" title={t('load.catchupTitle')}>
      <p>
        {status.plan.newFactor === 0
          ? t('load.rampZero')
          : t('load.rampHalf', { count: status.newLimitToday })}
      </p>
    </Note>
  );
}

function LoadWarning() {
  const view = useWorkload();
  if (!view || view.advice.overDay === null) return null;
  return <LoadWarningNote view={view} />;
}

function LoadWarningNote({ view }: { view: WorkloadView }) {
  const { t } = useTranslation();
  const day = view.advice.overDay!;
  const to = view.advice.suggestedLimit;
  const apply = () => {
    if (to === null) return;
    updateSettings({ daily_new_limit: to })
      .then(() => toast({ title: t('load.warningApplied', { to }) }))
      .catch((e: unknown) => {
        void logError(e, 'load.applyLimit');
        toast({ title: t('settings.saveFailed'), tone: 'danger' });
      });
  };
  const dismiss = () =>
    void dismissLoadWarning().catch((e: unknown) => void logError(e, 'load.dismiss'));
  return (
    <Note
      id="load-warning"
      icon="alert"
      tone="warn"
      title={t('load.warningTitle')}
      actions={
        <>
          <Button variant="ghost" onClick={dismiss}>
            {t('load.warningDismiss')}
          </Button>
          {to !== null ? (
            <Button variant="tonal" onClick={apply}>
              {t('load.warningApply', { to })}
            </Button>
          ) : (
            <Link to="/settings/yuk" className={buttonClasses({ variant: 'secondary' })}>
              {t('load.warningSettings')}
            </Link>
          )}
        </>
      }
    >
      <p>
        {t('load.warningBody', {
          day: formatDayLong(view.days[day]!),
          count: Math.round(view.totals[day]!),
          cap: view.capacity,
        })}
      </p>
      <p className="text-fg">
        {to !== null
          ? t('load.warningSuggest', { from: view.dailyNewLimit, to })
          : t('load.warningNoSuggest')}
      </p>
    </Note>
  );
}
