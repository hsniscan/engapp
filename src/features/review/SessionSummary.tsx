// End of a study session (v0.5.2 "Çam", docs/design.md §4.4, ADR 0066): a full ring with a
// check, what was studied ("15 kelime çalıştın · 3 kelime Pekişiyor'a geçti"), Kelime · Süre ·
// Hatırlama (recall on reviews only, ADR 0055), the answers per rating from the one rating map,
// the words that moved up a stage, the streak, and the next step: the next mode that still has
// cards today, else "Bitir"; "Biraz daha çalış" only once the whole day is done.
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getSettings, getStreakSummary } from '@/data';
import { cfgOf, getNextDue, type NextDue } from '@/features/home/queries';
import { nextDueText } from '@/features/home/nextDueText';
import { formatDuration, formatPercent } from '@/features/stats/format';
import type { StudyMode } from '@/domain/studyMode';
import { Rating } from '@/domain/types';
import {
  buttonClasses,
  Button,
  Card,
  cn,
  duration,
  ease,
  Icon,
  ListGroup,
  ListRow,
  ProgressRing,
  ratingLook,
  ratings,
  SectionHeader,
  StagePill,
  StatRow,
  StatTile,
  type Rating as RatingName,
} from '@/ui';
import { sessionFacts, stageChanges } from './study';
import { modeLeft, useTodayStudy } from './studyModes';
import { durationText } from './intervalText';
import { useNow } from '@/features/settings/useNow';
import type { SessionAnswer, SessionStart } from './useReviewSession';

const ratingValue: Record<RatingName, number> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** At most this many rows under "Aşama değişenler" (the rest as "+N kelime daha"). */
const MAX_CHANGES = 8;

export interface SessionSummaryProps {
  answers: readonly SessionAnswer[];
  start: SessionStart | null;
  /** Resolves when all answers are stored, so streak and next-due figures are final. */
  settled: () => Promise<void>;
  canUndo: boolean;
  onUndo: () => void;
  /** Words whose recognition card reached Öğrenildi with this session's answers (spec 5.2). */
  learnedToday?: number;
  /** The session's study mode (absent: mixed or tomorrow's cards). */
  studyMode?: StudyMode;
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
  studyMode,
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
  const facts = sessionFacts(answers);
  const changes = stageChanges(answers);
  const today = useTodayStudy();
  // The next mode with cards studiable now ("Üretime geç (29)"); the session's own mode only if
  // it still has cards. Learning steps due later keep the day open (v0.5.2, review B1): the
  // summary says when they come back, and offers "Devam et" by itself once they are due.
  const next = today?.nextReady ?? null;
  const allDone = !!today && today.left === 0;
  const waiting = !!today && !next && today.later > 0;
  const now = useNow();
  const byRating = Object.fromEntries(
    ratings.map((r) => [r, answers.filter((a) => a.rating === ratingValue[r]).length]),
  ) as Record<RatingName, number>;
  const maxRating = Math.max(1, ...ratings.map((r) => byRating[r]));
  const extended = !!start && !start.todayActive && total > 0;
  const streak = after?.streak ?? start?.streak ?? 0;

  const item = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: duration.medium, ease: ease.standard, delay: 0.05 * i },
        };

  return (
    <section
      aria-labelledby="summary-title"
      className="mx-auto flex w-full max-w-(--page-reading) flex-col gap-8 px-4 pt-4 pb-10 sm:px-6 md:pt-10"
    >
      <motion.div {...item(0)} className="flex flex-col items-center gap-4 text-center">
        <ProgressRing value={1} max={1} size={96} label={t('review.summary.title')}>
          <Icon name="check" size={36} strokeWidth={2} className="text-accent-text" />
        </ProgressRing>
        <div className="flex flex-col gap-1.5">
          <h1 id="summary-title" className="text-page font-semibold text-fg md:text-page-lg">
            {t('review.summary.title')}
          </h1>
          <p className="text-lead text-fg" data-testid="summary-words">
            {t('review.summary.studied', { count: facts.words })}
            {facts.consolidated > 0 &&
              ` · ${t('review.summary.consolidated', { count: facts.consolidated })}`}
          </p>
          {waiting && today && (
            <p className="text-ui text-fg-muted" data-testid="summary-waiting" aria-live="polite">
              {t('review.summary.waiting', {
                count: today.later,
                time: durationText(t, Math.max(60_000, (today.nextLearningDue ?? now) - now)),
              })}
            </p>
          )}
          {allDone && (
            <p className="text-ui text-fg-muted" aria-live="polite">
              {after ? nextDueText(t, after.next, after.now, after.timezone) : ' '}
            </p>
          )}
          {learnedToday > 0 && (
            <p className="text-ui font-semibold text-success-text" data-testid="learned-today">
              {t('study.learnedToday', { count: learnedToday })}
            </p>
          )}
        </div>
      </motion.div>

      <motion.div {...item(1)}>
        <StatRow>
          <StatTile bare label={t('review.summary.words')} value={String(facts.words)} />
          <StatTile bare label={t('review.summary.time')} value={formatDuration(timeMs)} />
          <StatTile
            bare
            label={t('review.summary.retention')}
            value={facts.reviews ? formatPercent(facts.recalled / facts.reviews) : '—'}
          />
        </StatRow>
      </motion.div>

      {total > 0 && (
        <motion.section {...item(2)} aria-labelledby="summary-ratings">
          <SectionHeader id="summary-ratings" title={t('review.summary.ratings')} />
          <Card>
            <ul className="flex flex-col gap-3">
              {ratings.map((r) => (
                <li key={r} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3">
                  <span className={cn('text-meta font-semibold', ratingLook[r].text)}>
                    {t(`rating.${r}`)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2.5 overflow-hidden rounded-full bg-surface-sunken"
                  >
                    {byRating[r] > 0 && (
                      <span
                        className={cn('block h-full rounded-full', ratingLook[r].dot)}
                        style={{ width: `${Math.max(4, (byRating[r] / maxRating) * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className="tabular text-right text-ui font-semibold text-fg">
                    {byRating[r]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </motion.section>
      )}

      {changes.length > 0 && (
        <motion.section {...item(3)} aria-labelledby="summary-stages">
          <SectionHeader id="summary-stages" title={t('review.summary.stages')} />
          <ListGroup
            footer={
              changes.length > MAX_CHANGES
                ? t('review.summary.stagesMore', { count: changes.length - MAX_CHANGES })
                : undefined
            }
          >
            {changes.slice(0, MAX_CHANGES).map((c) => (
              <ListRow key={c.noteId} term title={c.term} trailing={<StagePill stage={c.to} />} />
            ))}
          </ListGroup>
        </motion.section>
      )}

      <motion.div {...item(4)}>
        <Card className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-warn-soft text-warn-text">
            <Icon name="flame" size={20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-ui font-semibold text-fg">{t('home.streakTitle')}</span>
            <span className="text-meta text-fg-muted">
              {extended ? t('review.summary.streakExtended') : t('review.summary.streakKept')}
            </span>
          </div>
          <span className="tabular text-heading font-semibold text-fg">{streak}</span>
        </Card>
      </motion.div>

      <motion.div {...item(5)} className="flex flex-col gap-2">
        {next && today ? (
          <>
            <Link
              to={`/study?mode=${next}`}
              data-testid="summary-next"
              className={buttonClasses({ size: 'lg', fullWidth: true })}
            >
              {next === studyMode
                ? t('review.summary.continueMode')
                : t(`today.goTo.${next}`, { count: modeLeft(today.counts[next]) })}
            </Link>
            <Link to="/" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
              {t('review.summary.finish')}
            </Link>
          </>
        ) : (
          <>
            <Link to="/" className={buttonClasses({ size: 'lg', fullWidth: true })}>
              {t('review.summary.finish')}
            </Link>
            {allDone && (
              <Link to="/study/more" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
                {t('review.moreStudy')}
              </Link>
            )}
          </>
        )}
        {canUndo && (
          <Button variant="ghost" leadingIcon="undo" onClick={onUndo}>
            {t('review.undoLast')}
          </Button>
        )}
      </motion.div>
    </section>
  );
}
