import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getSettings, getStreakSummary } from '@/data';
import { cfgOf, getNextDue, type NextDue } from '@/features/home/queries';
import { nextDueText } from '@/features/home/nextDueText';
import { formatDuration, formatPercent } from '@/features/stats/format';
import { Rating } from '@/domain/types';
import {
  buttonClasses,
  Button,
  cn,
  duration,
  ease,
  Icon,
  ratings,
  type Rating as RatingName,
} from '@/ui';
import type { SessionAnswer, SessionStart } from './useReviewSession';

const ratingValue: Record<RatingName, number> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};
const barClass: Record<RatingName, string> = {
  again: 'bg-rating-again',
  hard: 'bg-rating-hard',
  good: 'bg-rating-good',
  easy: 'bg-rating-easy',
};

export interface SessionSummaryProps {
  answers: readonly SessionAnswer[];
  start: SessionStart | null;
  /** Resolves when all answers are stored, so streak and next-due figures are final. */
  settled: () => Promise<void>;
  canUndo: boolean;
  onUndo: () => void;
  /** Words whose recognition card reached Öğrenildi with this session's answers (spec 5.2). */
  learnedToday?: number;
  /** Links to the other study modes that still have cards today. */
  continueWith?: ReactNode;
}

interface After {
  streak: number;
  next: NextDue;
  now: number;
  timezone: string;
}

export function SessionSummary({
  answers,
  start,
  settled,
  canUndo,
  onUndo,
  learnedToday = 0,
  continueWith,
}: SessionSummaryProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [after, setAfter] = useState<After | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      await settled();
      const [streak, next, settings] = await Promise.all([
        getStreakSummary(),
        getNextDue(),
        getSettings(),
      ]);
      if (live)
        setAfter({
          streak: streak.currentStreak,
          next,
          now: Date.now(),
          timezone: cfgOf(settings).timezone,
        });
    })();
    return () => {
      live = false;
    };
  }, [settled, answers.length]);

  const total = answers.length;
  const timeMs = answers.reduce((a, x) => a + x.durationMs, 0);
  const passed = answers.filter((a) => a.rating !== Rating.Again).length;
  const byRating = Object.fromEntries(
    ratings.map((r) => [r, answers.filter((a) => a.rating === ratingValue[r]).length]),
  ) as Record<RatingName, number>;
  const extended = !!start && !start.todayActive && total > 0;

  const item = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: duration.large, ease: ease.standard, delay: 0.06 * i },
        };

  const stats = [
    { label: t('review.summary.cards'), value: String(total) },
    { label: t('review.summary.time'), value: formatDuration(timeMs) },
    { label: t('review.summary.retention'), value: total ? formatPercent(passed / total) : '—' },
  ];

  return (
    <section
      aria-labelledby="summary-title"
      className="mx-auto flex w-full max-w-xl flex-col px-4 pt-8 pb-10 sm:px-6 md:pt-14"
    >
      <motion.div {...item(0)} className="flex flex-col items-center text-center">
        <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-success-soft text-success-text">
          <Icon name="check" size={26} strokeWidth={2} />
        </span>
        <h1
          id="summary-title"
          className="font-serif text-3xl font-semibold tracking-[-0.01em] md:text-4xl"
        >
          {t('review.summary.title')}
        </h1>
        <p className="mt-2 text-[0.9375rem] text-fg-muted" aria-live="polite">
          {after ? nextDueText(t, after.next, after.now, after.timezone) : ' '}
        </p>
        {learnedToday > 0 && (
          <p
            className="mt-1 text-[0.9375rem] font-medium text-success-text"
            data-testid="learned-today"
          >
            {t('study.learnedToday', { count: learnedToday })}
          </p>
        )}
      </motion.div>

      <motion.dl
        {...item(1)}
        className="mt-8 grid grid-cols-3 divide-x divide-border rounded-card border border-border bg-surface"
      >
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-1 px-2 py-5">
            <dt className="text-sm text-fg-muted">{s.label}</dt>
            <dd className="tabular font-serif text-3xl leading-none font-semibold">{s.value}</dd>
          </div>
        ))}
      </motion.dl>

      {total > 0 && (
        <motion.div {...item(2)} className="mt-4 rounded-card border border-border bg-surface p-5">
          <h2 className="text-sm text-fg-muted">{t('review.summary.ratings')}</h2>
          <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {ratings.map((r) =>
              byRating[r] ? (
                <span key={r} className={barClass[r]} style={{ flexGrow: byRating[r] }} />
              ) : null,
            )}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            {ratings.map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className={cn('size-2 rounded-full', barClass[r])} />
                <span className="text-fg-muted">{t(`rating.${r}`)}</span>
                <span className="tabular ml-auto font-medium text-fg sm:ml-0">{byRating[r]}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      <motion.div
        {...item(3)}
        className="mt-4 flex items-center gap-4 rounded-card border border-border bg-surface p-5"
      >
        <span className="tabular font-serif text-4xl leading-none font-semibold">
          {after?.streak ?? start?.streak ?? 0}
        </span>
        <div className="flex flex-col">
          <span className="font-medium text-fg">{t('home.streakTitle')}</span>
          <span className="text-sm text-fg-muted">
            {extended ? t('review.summary.streakExtended') : t('review.summary.streakKept')}
          </span>
        </div>
      </motion.div>

      {continueWith && (
        <motion.div {...item(4)} className="mt-4">
          {continueWith}
        </motion.div>
      )}

      <motion.div {...item(4)} className="mt-8 flex flex-col gap-2">
        <Link to="/" className={buttonClasses({ size: 'lg', fullWidth: true })}>
          {t('review.backHome')}
        </Link>
        <Link to="/study/more" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
          {t('review.moreStudy')}
        </Link>
        {canUndo && (
          <Button variant="ghost" leadingIcon="undo" onClick={onUndo}>
            {t('review.undoLast')}
          </Button>
        )}
      </motion.div>
    </section>
  );
}
