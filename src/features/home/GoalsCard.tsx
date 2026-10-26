// "Hedeflerin" (board Main): minutes today and this week, new words this month, and the level
// path towards the target level. Goals are set on Profil ("Düzenle"). With no goal set, one
// line "Günlük hedef koy" with three presets instead of three empty rings (v0.5.1).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type GoalsView, logError, updateGoals } from '@/data';
import { CEFR_ORDER } from '@/domain/deckFilter';
import type { GoalKey } from '@/domain/goals';
import { cn, toast } from '@/ui';
import { HomeIcon } from './homeIcons';
import { Ring } from './Ring';
import { levelPath, type HomeGoals } from './todayQueries';

export const GOALS_EDIT_HREF = '/progress?edit=goals';

/** Daily minutes offered in one tap when no goal is set. */
const DAY_GOAL_PRESETS = [10, 15, 20] as const;

function SetDayGoal() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<number | null>(null);
  const set = async (minutes: number) => {
    setBusy(minutes);
    try {
      await updateGoals({ day_minutes: minutes });
    } catch (e) {
      void logError(e, 'home.dayGoal');
      toast({ title: t('today.goalSetFailed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="goal-presets">
      <span className="text-[0.9375rem]">{t('today.goalSetDay')}</span>
      <div className="flex gap-1.5" role="group" aria-label={t('today.goalSetDay')}>
        {DAY_GOAL_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy !== null}
            onClick={() => void set(n)}
            className="inline-flex h-11 min-w-14 items-center justify-center rounded-xl border border-border bg-surface px-2.5 text-sm font-semibold text-accent-text transition-colors duration-(--duration-micro) hover:bg-hover disabled:opacity-60"
          >
            {t('today.goalPreset', { count: n })}
          </button>
        ))}
      </div>
    </div>
  );
}

function GoalRing({
  value,
  target,
  unit,
  label,
  soft,
  testId,
}: {
  value: number | null;
  target: number | null;
  unit?: string;
  label: string;
  soft?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const ratio = value !== null && target ? value / target : 0;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testId}>
      <Ring
        ratio={ratio}
        size={40}
        stroke={5}
        trackClass="stroke-surface-sunken"
        fillClass={soft ? 'stroke-stage-consolidating' : 'stroke-accent'}
      />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="tabular font-serif text-[1.0625rem] leading-tight font-semibold">
          {value === null ? '—' : target ? `${value}/${target}` : value}
          {unit && <span className="text-xs font-normal text-fg-muted"> {unit}</span>}
        </span>
        <span className="text-xs leading-tight text-fg-muted">
          {label}
          {target === null && <span className="sr-only">, {t('today.goalNotSet')}</span>}
        </span>
      </span>
    </div>
  );
}

export function GoalsCard({
  goals,
  view,
  todayMinutes,
  weekMinutes,
}: {
  goals: HomeGoals;
  view: GoalsView | undefined;
  todayMinutes: number;
  weekMinutes: number;
}) {
  const { t } = useTranslation();
  const progress = (key: GoalKey) => view?.progress.find((p) => p.key === key);
  const week = progress('week_minutes');
  const month = progress('month_new_terms');
  const dayDone = goals.dayTarget !== null && todayMinutes >= goals.dayTarget;
  const path = levelPath(goals.level, goals.target);
  const reached = CEFR_ORDER.indexOf(goals.level);
  const targetIndex = CEFR_ORDER.indexOf(goals.target);
  const noGoals = goals.dayTarget === null && !week?.target && !month?.target;

  return (
    <section
      aria-labelledby="goals-title"
      className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-surface px-4.5 pt-4 pb-1.5"
      data-testid="home-goals"
    >
      <div className="flex items-center justify-between">
        <h2 id="goals-title" className="font-serif text-[1.1875rem] font-semibold">
          {t('today.goalsTitle')}
        </h2>
        <Link
          to={GOALS_EDIT_HREF}
          className="-my-3 flex min-h-11 items-center text-sm text-accent-text hover:underline"
          aria-label={t('today.goalsEditLabel')}
        >
          {t('today.edit')}
        </Link>
      </div>
      {noGoals ? (
        <SetDayGoal />
      ) : (
      <div className="grid grid-cols-3 gap-2">
        <GoalRing
          value={todayMinutes}
          target={goals.dayTarget}
          unit={t('today.minUnit')}
          label={dayDone ? t('today.goalTodayDone') : t('today.goalToday')}
          testId="goal-day"
        />
        <GoalRing
          value={week?.value ?? weekMinutes}
          target={week?.target ?? null}
          unit={t('today.minUnit')}
          label={t('today.goalWeek')}
          testId="goal-week"
        />
        <GoalRing
          value={month?.value ?? null}
          target={month?.target ?? null}
          label={t('today.goalMonth')}
          soft
          testId="goal-month"
        />
      </div>
      )}
      <div className="flex flex-col gap-2 border-t border-surface-sunken pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[0.8125rem] font-semibold text-accent-text">
            {t('today.levelEstimate', { level: goals.level })}
          </span>
          {targetIndex > reached && (
            <span className="text-sm">
              {t('today.levelTarget')} <strong className="font-semibold">{goals.target}</strong>
            </span>
          )}
        </div>
        <ol
          aria-label={
            targetIndex > reached
              ? t('today.levelPathLabel', { level: goals.level, target: goals.target })
              : t('today.levelPathReached', { level: goals.level })
          }
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))` }}
        >
          {path.map((l, i) => {
            const isNow = i === reached;
            const isTarget = i === targetIndex && targetIndex > reached;
            return (
              <li key={l} aria-hidden="true" className="flex min-w-0 flex-col gap-1">
                <span
                  className={cn(
                    'h-1.5 rounded-[3px]',
                    i <= reached
                      ? 'bg-accent'
                      : 'border border-dashed border-accent bg-surface-sunken',
                  )}
                />
                <span
                  className={cn(
                    'truncate text-xs',
                    isNow
                      ? 'font-semibold text-fg'
                      : isTarget
                        ? 'font-semibold text-accent-text'
                        : 'text-fg-muted',
                  )}
                >
                  {isNow
                    ? t('today.levelNow', { level: l })
                    : isTarget
                      ? t('today.levelGoal', { level: l })
                      : l}
                </span>
              </li>
            );
          })}
        </ol>
        {goals.levelSource !== 'test' ? (
          <Link
            to="/level-test"
            className="flex min-h-11 items-center justify-between text-sm text-accent-text hover:underline"
          >
            <span>{t('today.levelTest')}</span>
            <HomeIcon name="chevron" size={16} strokeWidth={2} />
          </Link>
        ) : (
          <span className="h-2.5" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}
