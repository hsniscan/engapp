// The Today card of Bugün (v0.5.2 "Çam", docs/design.md §4.1, ADR 0066): the whole day in one
// card — a ring with what is left, "Bugünün çalışması" with the split and the time estimate, a
// chip per study mode, the one primary button, and the week strip with the streak. Three states
// (ADR 0062): ready (cards now), waiting (learning steps later today) and done.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { getStreakFreezeView } from '@/data';
import type { StreakSummary } from '@/domain/streak';
import type { StudyMode } from '@/domain/studyMode';
import { modeLeft, modeLeftToday, type TodayStudy } from '@/features/review/studyModes';
import { durationText } from '@/features/review/intervalText';
import { useNow } from '@/features/settings/useNow';
import { formatClock, formatDayLong } from '@/features/stats/format';
import {
  buttonClasses,
  Card,
  Chip,
  ChipRow,
  Dialog,
  HeatStrip,
  Icon,
  ProgressRing,
  type HeatLevel,
} from '@/ui';
import { nextDueText } from './nextDueText';
import type { NextDue } from './queries';
import type { TodayActivity, WeekDot } from './todayQueries';

export const WORD_STUDY_HREF = '/study?mode=word';

const studyHref = (mode: StudyMode) => `/study?mode=${mode}`;

export interface HeroData {
  study: TodayStudy;
  activity: TodayActivity;
  streak: StreakSummary;
  next: NextDue | null;
  now: number;
  timezone: string;
}

export interface TodayHeroProps {
  data: HeroData;
  /** Done state: the "Biraz daha çalış" section follows right under the card (no button then). */
  moreBelow?: boolean;
}

export function TodayHero({ data, moreBelow = false }: TodayHeroProps) {
  // v0.5.2 (ADR 0062): learning steps due later today keep the day open ("5 kart 10 dk sonra").
  if (data.study.ready > 0) return <ReadyCard data={data} />;
  if (data.study.later > 0) return <WaitingCard data={data} />;
  return <DoneCard data={data} moreBelow={moreBelow} />;
}

/** Answers given today over the modes shown. */
function answeredToday(data: HeroData): number {
  return data.study.modes.reduce((n, m) => n + data.activity.answers[m], 0);
}

/** The card itself: one layout for every state, so nothing jumps when the day moves on. */
function TodayFrame({
  testId,
  ring,
  title,
  meta,
  children,
}: {
  testId: string;
  ring: ReactNode;
  title: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      as="section"
      padding="lg"
      aria-labelledby="today-hero-title"
      data-testid={testId}
      className="flex flex-col gap-5"
    >
      <div className="flex items-center gap-4">
        {ring}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="today-hero-title" className="text-title font-semibold text-fg">
            {title}
          </h2>
          {meta}
        </div>
      </div>
      {children}
    </Card>
  );
}

function RingCentre({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <span aria-hidden="true" className="flex flex-col items-center leading-none">
      <span className="tabular text-title font-semibold text-fg">{children}</span>
      {caption && <span className="mt-0.5 text-caption text-fg-muted">{caption}</span>}
    </span>
  );
}

function WeekStrip({ week }: { week: WeekDot[] }) {
  const { t } = useTranslation();
  const active = week.filter((d) => d.active).length;
  const days = week.map((d) => ({
    level: (d.active ? 'completed' : 'empty') satisfies HeatLevel as HeatLevel,
    label: `${formatDayLong(d.date)}: ${d.active ? t('today.dayActive') : t('today.dayIdle')}`,
  }));
  return (
    <HeatStrip
      days={days}
      label={t('today.weekDots', { count: active })}
      className="w-32 shrink-0 sm:w-36"
    />
  );
}

function StreakText({ streak, done }: { streak: StreakSummary; done: boolean }) {
  const { t } = useTranslation();
  if (streak.currentStreak === 0) return <span>{t('today.streakStart')}</span>;
  const extra = done
    ? t('today.streakGoesOn')
    : streak.longestStreak > streak.currentStreak
      ? t('today.streakLongest', { count: streak.longestStreak })
      : null;
  return (
    <span>
      <span className="font-semibold text-fg">
        {t('today.streakDays', { count: streak.currentStreak })}
      </span>
      {extra && <span className="font-normal text-fg-muted"> {extra}</span>}
    </span>
  );
}

/** Hairline, the week strip and the streak; the streak opens a short sheet. */
function StreakFooter({ data, done }: { data: HeroData; done: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-4 border-t border-border pt-4">
      <WeekStrip week={data.activity.week} />
      <button
        type="button"
        data-testid="today-streak"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="-my-2 -mr-2 ml-auto flex min-h-11 min-w-0 items-center gap-1.5 rounded-control px-2 text-left text-meta text-fg hover:bg-hover"
      >
        <Icon name="flame" size={16} className="shrink-0 text-warn" />
        <StreakText streak={data.streak} done={done} />
        <span className="sr-only">{t('today.streakMore')}</span>
      </button>
      <StreakSheet open={open} onOpenChange={setOpen} streak={data.streak} />
    </div>
  );
}

function StreakSheet({
  open,
  onOpenChange,
  streak,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streak: StreakSummary;
}) {
  const { t } = useTranslation();
  const view = useLiveQuery(() => (open ? getStreakFreezeView() : undefined), [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('today.streakSheet.title')}
      description={t('today.streakDays', { count: streak.currentStreak })}
    >
      <div className="flex flex-col gap-4 pb-1 text-body" data-testid="streak-sheet">
        <p>{t('today.streakSheet.rule')}</p>
        <p className="text-fg-muted">
          {t('today.streakSheet.longest', {
            count: Math.max(streak.longestStreak, streak.currentStreak),
          })}
        </p>
        {view && (
          <Card tone="sunken" padding="md" inset className="flex flex-col gap-1">
            <p className="text-ui font-semibold">{t('today.streakSheet.protectTitle')}</p>
            <p className="text-ui text-fg-muted" data-testid="streak-protection">
              {t('today.streakSheet.protectLeft', { left: view.left, perMonth: view.perMonth })}
            </p>
            <p className="text-meta text-fg-muted">
              {t('today.streakSheet.protectRule', { perMonth: view.perMonth })}
            </p>
          </Card>
        )}
        <p className="text-meta text-fg-muted">{t('today.streakSheet.practice')}</p>
      </div>
    </Dialog>
  );
}

/** "Kelime 12 · Üretim ✓ · Boşluk doldurma 3": a chip per mode; each starts that mode. */
function ModeChips({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { study, activity } = data;
  const lockedHint = study.locked.some((m) => m === 'production' || m === 'cloze');
  return (
    <div className="flex flex-col gap-2">
      <ChipRow label={t('today.typesTitle')} bleed={false} className="flex-wrap overflow-visible">
        {study.modes.map((m) => {
          const c = study.counts[m];
          const n = modeLeftToday(c);
          const done = n === 0;
          // Catch-up moved this mode's reviews to later days: not "done", "ertelendi".
          const deferred = done && c.deferred > 0;
          const studied = activity.answers[m] > 0;
          const spoken = deferred
            ? t('today.typeDeferredLong', { count: c.deferred })
            : done
              ? studied
                ? t('today.typeDone')
                : study.locked.includes(m)
                  ? t('today.typeLocked')
                  : t('today.typeNone')
              : t('today.chipCount', { count: n });
          return (
            <Chip
              key={m}
              data-testid={`study-type-${m}`}
              data-done={done || undefined}
              onClick={() => void navigate(studyHref(m))}
              className={done ? 'text-fg-muted' : undefined}
            >
              {/* The name is "Kelime 2 kart" / "Üretim Bugün yok"; the eye sees "Kelime 2". */}
              <span>{t(`today.mode.${m}`)}</span>
              <span className="sr-only"> {spoken}</span>
              {deferred ? (
                <span aria-hidden="true" className="font-medium">
                  {t('today.typeDeferred')}
                </span>
              ) : done ? (
                studied ? (
                  <Icon name="check" size={16} strokeWidth={2} className="text-accent-text" />
                ) : (
                  <span aria-hidden="true">–</span>
                )
              ) : (
                <span aria-hidden="true" className="tabular text-fg-muted">
                  {n}
                </span>
              )}
            </Chip>
          );
        })}
      </ChipRow>
      {lockedHint && (
        <p data-testid="today-locked-hint" className="text-meta text-fg-muted">
          {t('today.lockedHint')}
        </p>
      )}
    </div>
  );
}

function ReadyCard({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const { study } = data;
  // The ring counts cards (v0.5.2, review B3): cards done for today over cards done + left.
  const done = study.doneCards;
  const planned = done + study.left;
  const answered = answeredToday(data);
  const review = study.modes.reduce((n, m) => n + study.counts[m].left.review, 0);
  const steps = study.modes.reduce((n, m) => n + study.counts[m].left.learning, 0);
  const fresh = study.modes.reduce((n, m) => n + study.counts[m].newCount, 0);
  const next = study.nextReady ?? study.next ?? 'word';
  const nextLeft = modeLeft(study.counts[next]);
  // The first mode keeps "Çalışmaya başla" / "Devam et"; after it, the button names the next one.
  const cta =
    next === study.modes[0]
      ? answered > 0
        ? t('today.continue')
        : t('today.start')
      : t(`today.goTo.${next}`, { count: nextLeft });
  const ringText = t('today.ringLabel', { done, total: planned });
  return (
    <TodayFrame
      testId="today-hero"
      ring={
        <ProgressRing
          value={done}
          max={Math.max(1, planned)}
          size={76}
          label={t('today.heroCaption')}
          valueText={ringText}
        >
          <RingCentre caption={t('today.ringLeft')}>{study.left}</RingCentre>
        </ProgressRing>
      }
      title={t('today.heroCaption')}
      meta={
        <p data-testid="today-split" className="text-ui text-fg-muted">
          {t('today.cardsLeft', { count: study.left })}
          {' · '}
          {t('today.split', { due: review, fresh })}
          {steps > 0 && ` · ${t('today.splitSteps', { count: steps })}`}
          {study.minutes > 0 && ` · ${t('today.aboutMinutes', { count: study.minutes })}`}
        </p>
      }
    >
      <ModeChips data={data} />
      <Link
        to={studyHref(next)}
        data-testid="start-study"
        className={buttonClasses({ size: 'lg', fullWidth: true })}
      >
        {cta}
        <Icon name="arrow-right" size={20} />
      </Link>
      <StreakFooter data={data} done={false} />
    </TodayFrame>
  );
}

/**
 * Nothing to study right now, but learning steps come back later today (v0.5.2, review B1):
 * "5 kart 10 dk sonra". Not "Bugünlük tamam", and no "Biraz daha çalış" yet. The numbers
 * refresh by themselves when the steps fall due (studyClock.ts).
 */
function WaitingCard({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const now = useNow();
  const { study } = data;
  const at = study.nextLearningDue;
  const time = at === null ? '' : durationText(t, Math.max(60_000, at - now));
  const done = study.doneCards;
  return (
    <TodayFrame
      testId="today-hero-waiting"
      ring={
        <ProgressRing
          value={done}
          max={Math.max(1, done + study.later)}
          size={76}
          label={t('today.heroCaption')}
          valueText={t('today.ringLabel', { done, total: done + study.later })}
        >
          <Icon name="clock" size={24} className="text-accent-text" />
        </ProgressRing>
      }
      title={t('today.waitingTitle', { count: study.later, time })}
      meta={
        <p className="text-ui text-fg-muted" role="status">
          {at === null
            ? t('today.waitingBodyNoClock')
            : t('today.waitingBody', { clock: formatClock(at, data.timezone) })}
        </p>
      }
    >
      <ModeChips data={data} />
      <StreakFooter data={data} done={data.streak.todayActive} />
    </TodayFrame>
  );
}

function DoneCard({ data, moreBelow }: { data: HeroData; moreBelow: boolean }) {
  const { t } = useTranslation();
  const { activity } = data;
  const done = data.study.doneCards;
  const studied = answeredToday(data) > 0;
  return (
    <TodayFrame
      testId="today-hero-done"
      ring={
        <ProgressRing
          value={1}
          max={1}
          size={76}
          label={t('today.heroCaption')}
          valueText={studied ? t('today.ringLabel', { done, total: done }) : undefined}
        >
          <Icon name="check" size={26} strokeWidth={2} className="text-accent-text" />
        </ProgressRing>
      }
      title={studied ? t('today.doneTitle') : t('today.nothingTitle')}
      meta={
        <p className="text-ui text-fg-muted">
          {studied
            ? t('today.doneSplit', {
                reviewed: activity.all.reviewed,
                fresh: activity.all.fresh,
              })
            : t('today.nothingBody')}
          {studied && (
            <span className="tabular">
              {' · '}
              {done} / {done}
            </span>
          )}
        </p>
      }
    >
      {studied && <ModeChips data={data} />}
      {data.next && (
        <p className="flex items-center gap-2 text-meta text-fg-muted" role="status">
          <Icon name="calendar" size={16} className="shrink-0" />
          <span>{nextDueText(t, data.next, data.now, data.timezone)}</span>
        </p>
      )}
      {!moreBelow && studied && (
        <Link
          to="/study/more"
          className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}
        >
          {t('home.moreStudy')}
        </Link>
      )}
      <StreakFooter data={data} done={data.streak.todayActive} />
    </TodayFrame>
  );
}
