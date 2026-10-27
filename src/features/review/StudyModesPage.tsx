// "Çalış" (redesign board StudyModes): the study types with what each has left today, a
// "Karışık çalış" switch, and a button that starts the next one. "Dikte" (v0.5 İP9) is the
// fourth type; its cards open with the word's spoken example sentences, and it is listed only
// when this device can read them. The totals are the same as on Bugün (ADR 0055). A new user
// with no words gets a real empty state instead of a start button with nothing to study.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db } from '@/data';
import type { StudyMode } from '@/domain/studyMode';
import { openAddSheet } from '@/features/add/addSheetStore';
import { DISCOVER_DECKS_HREF } from '@/features/home/DecksForYou';
import { flags } from '@/features/settings/platform';
import { buttonClasses, cn, EmptyState, Icon, Skeleton, Switch } from '@/ui';
import { reconcileDictationCards } from '@/data/dictation';
import { mixedHint, modeText, startLabel } from './modeText';
import { type StudyModeCount, useTodayStudy } from './studyModes';

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
  if (mode === 'dictation')
    return (
      <svg {...common}>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="3" y="14" width="4" height="6" rx="1.5" />
        <rect x="17" y="14" width="4" height="6" rx="1.5" />
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
      : mode === 'production' || mode === 'dictation'
        ? n > 0
          ? t('study.split', { due: count.due, new: count.newCount })
          : modeText(t, mode, 'note')
        : modeText(t, mode, 'note');
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
            <span className="font-serif text-xl font-semibold">{modeText(t, mode, 'name')}</span>
            {mode === 'word' && (
              <span className="rounded-[6px] bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-text">
                {t('study.mainBadge')}
              </span>
            )}
          </span>
          <span className="text-[0.8125rem] text-fg-muted">{modeText(t, mode, 'dir')}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="tabular font-serif text-[1.625rem] leading-none font-semibold">{n}</span>
          <span className="text-xs text-fg-muted">{t('study.cardsUnit')}</span>
        </span>
      </span>
      <span className="text-[0.9375rem] leading-snug">{modeText(t, mode, 'desc')}</span>
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
  const study = useTodayStudy();
  const hasWords = useLiveQuery(
    async () => (await db.notes.filter((n) => n.deleted_at === null).first()) !== undefined,
    [],
  );
  const [mixed, setMixed] = useState(() => flags.get(MIXED_FLAG) === '1');
  // Dictation cards of words whose example sentences arrived since the last visit (cheap
  // when nothing changed; the counts follow through the live query).
  useEffect(() => {
    void reconcileDictationCards().catch(() => {});
  }, []);

  if (hasWords === false) return <StudyWelcome />;
  const counts = study?.counts;
  const total = study?.left ?? 0;
  const minutes = study?.minutes ?? 0;
  const main: StudyMode = study?.next ?? 'word';
  const startTo = mixed ? '/study?mode=mixed' : `/study?mode=${main}`;
  const done = !!study && total === 0;

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

      {study && counts ? (
        study.modes.map((m) => (
          <ModeCard key={m} mode={m} count={counts[m]} main={m === main && !mixed} />
        ))
      ) : (
        <>
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
        </>
      )}

      <Switch
        className="px-1 pt-1"
        label={<span className="font-semibold">{t('study.mixed')}</span>}
        description={study ? mixedHint(t, study.modes) : t('study.mixedHint')}
        checked={mixed}
        onCheckedChange={(v) => {
          setMixed(v);
          flags.set(MIXED_FLAG, v ? '1' : '0');
        }}
      />

      {done ? (
        <Link
          to="/study/more"
          data-testid="study-more"
          className="mt-auto flex h-14 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface text-[1.0625rem] font-semibold text-accent-text no-underline transition-colors hover:bg-surface-hover"
        >
          {t('review.moreStudy')}
          <Icon name="arrow-right" size={20} />
        </Link>
      ) : (
        <Link
          to={startTo}
          data-testid="study-start"
          aria-disabled={!study || undefined}
          className={cn(
            'mt-auto flex h-14 items-center justify-center gap-2 rounded-[14px] bg-accent text-[1.0625rem] font-semibold text-accent-fg no-underline transition-colors hover:bg-accent-hover',
            !study && 'pointer-events-none opacity-60',
          )}
        >
          {startLabel(t, mixed ? 'mixed' : main)}
          <Icon name="arrow-right" size={20} />
        </Link>
      )}
    </div>
  );
}

/** No words yet: the first steps instead of "Bugünlük bitti" and a start button with 0 cards. */
function StudyWelcome() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3.5 px-4 pt-3 pb-8 sm:px-6">
      <h1 className="px-1 font-serif text-[1.75rem] leading-tight font-semibold">
        {t('study.pickerTitle')}
      </h1>
      <div data-testid="study-welcome">
        <EmptyState
          icon="cards"
          title={t('study.welcomeTitle')}
          description={t('study.welcomeBody')}
          action={
            <>
              <button
                type="button"
                onClick={() => openAddSheet()}
                aria-haspopup="dialog"
                className={buttonClasses({ size: 'lg', className: 'min-w-60' })}
              >
                <Icon name="plus" size={20} />
                {t('home.emptyAction')}
              </button>
              <Link
                to={DISCOVER_DECKS_HREF}
                className={buttonClasses({ variant: 'secondary', className: 'min-w-60' })}
              >
                {t('study.welcomeDecks')}
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
