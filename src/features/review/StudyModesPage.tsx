// "Çalış" (redesign board StudyModes): the three study types with what each has left today, a
// "Karışık çalış" switch, and a button that starts the main one.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { STUDY_MODES, type StudyMode } from '@/domain/studyMode';
import { flags } from '@/features/settings/platform';
import { cn, Icon, Skeleton, Switch } from '@/ui';
import { type StudyModeCount, useStudyModeCounts } from './studyModes';

const MIXED_FLAG = 'study.mixed';

const left = (c: StudyModeCount) => c.due + c.newCount;

function ModeIcon({ mode }: { mode: StudyMode }) {
  const common = {
    'aria-hidden': true,
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (mode === 'word')
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M7 10h6M7 14h10" />
      </svg>
    );
  if (mode === 'production')
    return (
      <svg {...common}>
        <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
        <path d="M13.5 6.5l4 4" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 12h3M18 12h3" />
      <rect x="8" y="9" width="8" height="6" rx="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ModeCard({
  mode,
  count,
  main,
}: {
  mode: StudyMode;
  count: StudyModeCount;
  main: boolean;
}) {
  const { t } = useTranslation();
  const n = left(count);
  const note =
    mode === 'word'
      ? t('study.split', { due: count.due, new: count.newCount })
      : mode === 'production'
        ? n > 0
          ? t('study.split', { due: count.due, new: count.newCount })
          : t('study.mode.production.note')
        : t('study.mode.cloze.note');
  return (
    <Link
      to={`/study?mode=${mode}`}
      data-testid={`study-mode-${mode}`}
      className={cn(
        'flex flex-col gap-2.5 rounded-[20px] bg-surface px-4 py-3.5 text-fg no-underline transition-colors hover:bg-surface-hover',
        main ? 'border-[1.5px] border-accent' : 'border border-border',
      )}
    >
      <span className="flex items-start gap-3.5">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-[12px]',
            main ? 'bg-accent-soft text-accent-text' : 'bg-surface-sunken text-fg-muted',
          )}
        >
          <ModeIcon mode={mode} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="font-serif text-xl font-semibold">{t(`study.mode.${mode}.name`)}</span>
            {mode === 'word' && (
              <span className="rounded-[6px] bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-text">
                {t('study.mainBadge')}
              </span>
            )}
          </span>
          <span className="text-[0.8125rem] text-fg-muted">{t(`study.mode.${mode}.dir`)}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="tabular font-serif text-[1.625rem] leading-none font-semibold">{n}</span>
          <span className="text-xs text-fg-muted">{t('study.cardsUnit')}</span>
        </span>
      </span>
      <span className="text-[0.9375rem] leading-snug">{t(`study.mode.${mode}.desc`)}</span>
      <span className="flex items-center justify-between gap-2.5 text-[0.8125rem] text-fg-muted">
        <span>{note}</span>
        {count.estMinutes > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <ClockIcon />
            {t('study.minutes', { count: count.estMinutes })}
          </span>
        )}
      </span>
    </Link>
  );
}

export function StudyModesPage() {
  const { t } = useTranslation();
  const counts = useStudyModeCounts();
  const [mixed, setMixed] = useState(() => flags.get(MIXED_FLAG) === '1');

  const total = counts ? STUDY_MODES.reduce((n, m) => n + left(counts[m]), 0) : 0;
  const minutes = counts ? STUDY_MODES.reduce((n, m) => n + counts[m].estMinutes, 0) : 0;
  const main: StudyMode = counts
    ? (STUDY_MODES.find((m) => left(counts[m]) > 0) ?? 'word')
    : 'word';
  const startTo = mixed ? '/study?mode=mixed' : `/study?mode=${main}`;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col gap-3.5 px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="flex flex-col gap-1 px-1">
        <h1 className="font-serif text-[1.75rem] leading-tight font-semibold">
          {t('study.pickerTitle')}
        </h1>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {!counts
            ? ' '
            : total > 0
              ? t('study.leftToday', { count: total, min: minutes })
              : t('study.allDone')}
        </p>
      </div>

      {counts ? (
        STUDY_MODES.map((m) => (
          <ModeCard key={m} mode={m} count={counts[m]} main={m === main && !mixed} />
        ))
      ) : (
        <>
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
        </>
      )}

      <Switch
        className="px-1 pt-1"
        label={<span className="font-semibold">{t('study.mixed')}</span>}
        description={t('study.mixedHint')}
        checked={mixed}
        onCheckedChange={(v) => {
          setMixed(v);
          flags.set(MIXED_FLAG, v ? '1' : '0');
        }}
      />

      <Link
        to={startTo}
        data-testid="study-start"
        className="mt-auto flex h-14 items-center justify-center gap-2 rounded-[14px] bg-accent text-[1.0625rem] font-semibold text-accent-fg no-underline transition-colors hover:bg-accent-hover"
      >
        {t(`study.start.${mixed ? 'mixed' : main}`)}
        <Icon name="arrow-right" size={20} />
      </Link>
    </div>
  );
}
