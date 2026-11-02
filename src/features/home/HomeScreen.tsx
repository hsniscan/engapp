// Bugün (v0.5.2 "Çam", docs/design.md §4.1, ADR 0066): the date and a greeting, the Today card
// with the whole day (every mode, ADR 0055/0062), "Biraz daha çalış" once the day is done, at
// most one note, the reading of the day, then "Kelimelerin" and "Kısayollar". One column on
// phones; from 1024 px a main column and a 20rem side column, both starting at the top.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { logError, setMeta } from '@/data';
import { openAddSheet } from '@/features/add/addSheetStore';
import { useAuth } from '@/features/auth/session';
import { FsrsOptOffer } from '@/features/fsrs/FsrsOptOffer';
import { LevelChangeLine, LevelTestOffer } from '@/features/leveltest/LevelHomeNotes';
import { LoadNotes } from '@/features/load/LoadNotes';
import { FirstRunGate } from '@/features/onboarding/FirstRunGate';
import { InterestsPrompt } from '@/features/profile/InterestsPrompt';
import { TodayReadingCard } from '@/features/reader/TodayReadingCard';
import { StreakFreezeNote } from '@/features/smart/StreakFreezeNote';
import { useNow } from '@/features/settings/useNow';
import { formatNumber } from '@/features/stats/format';
import { useTodayStudy } from '@/features/review/studyModes';
import { useStudyTick } from '@/features/review/studyClock';
import { useWordStages } from '@/features/stats/useWordStages';
import {
  Button,
  buttonClasses,
  Card,
  ListGroup,
  ListRow,
  PageFrame,
  SectionHeader,
  Skeleton,
} from '@/ui';
import { GoalPrompt } from './GoalPrompt';
import { greetingKey, homeDate } from './greeting';
import { HomeNote } from './HomeNote';
import { hasMoreStudy } from '@/features/extra/links';
import { MoreStudy } from './MoreStudy';
import { getHomeCore, type HomeCore } from './queries';
import { Shortcuts } from './Shortcuts';
import { TodayHero } from './TodayHero';
import {
  countWords,
  getHomeDecks,
  getHomeGoals,
  getMoreOverview,
  getReportShortcut,
  getTodayActivity,
  HOME_FREQ_SIZE,
  type HomeDeck,
  STAGE_RULE_NOTE_KEY,
  stageRuleNoteVisible,
} from './todayQueries';
import { useSettled } from './settle';
import { WordsCard } from './WordsCard';

/** Keşfet filtered to decks. */
export const DISCOVER_DECKS_HREF = '/kesfet?f=desteler';

export function HomeScreen() {
  // Time-dependent (streak day, "what comes next"): recomputed at the day change and on resume.
  const tick = useStudyTick();
  const core = useLiveQuery(() => getHomeCore(), [tick]);
  // A brand-new user gets the guided first run (features/onboarding, v0.5.1).
  if (core && !core.hasCards)
    return (
      <FirstRunGate>
        <HomeWelcome />
      </FirstRunGate>
    );
  return (
    <HomeFrame timezone={core?.timezone}>
      {core ? <Dashboard core={core} /> : <DashboardSkeleton />}
    </HomeFrame>
  );
}

/** Page frame with the greeting header ("Pazar, 25 Ekim" / "İyi akşamlar, Hasan"). */
function HomeFrame({
  timezone,
  title,
  children,
}: {
  timezone: string | undefined;
  /** Replaces the greeting (the welcome screen says "Hoş geldin"). */
  title?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const at = useNow();
  const first = user?.name?.split(/\s+/)[0] ?? null;
  const greeting = t(greetingKey(at, timezone));
  return (
    <PageFrame
      eyebrow={homeDate(at, timezone)}
      title={title ?? (first ? t('today.greetingName', { greeting, name: first }) : greeting)}
    >
      {children}
    </PageFrame>
  );
}

/** Two columns from 1024 px (main | 20rem side), one column below. */
const gridClass =
  'flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10';

function Dashboard({ core }: { core: HomeCore }) {
  const study = useTodayStudy();
  const tick = useStudyTick();
  const activity = useLiveQuery(() => getTodayActivity(), [tick]);
  // The heavy, secondary reads (whole-history goals, extra-study queues, the weekly report and
  // the notes below the card) start once the Today card has painted and the page is idle for a
  // moment (decisions 0053, 0059), so a tap on "Çalışmaya başla" right away opens the session.
  const heroReady = useSettled(study !== undefined && activity !== undefined);
  const goals = useLiveQuery(() => (heroReady ? getHomeGoals() : undefined), [heroReady]);
  const stages = useWordStages(heroReady);
  const totalWords = useLiveQuery(() => (heroReady ? countWords() : undefined), [heroReady]);
  const moreResult = useLiveQuery(
    () => (heroReady ? getMoreOverview() : undefined),
    [heroReady, tick],
  );
  const more = moreResult?.ok ? moreResult.more : null;
  const moreError = moreResult && !moreResult.ok ? moreResult.error : null;
  useEffect(() => {
    if (moreError) void logError(moreError, 'home.moreStudy');
  }, [moreError]);
  const report = useLiveQuery(() => (heroReady ? getReportShortcut() : undefined), [heroReady]);
  const shortcuts = moreResult && report !== undefined ? { more, report } : undefined;

  const ready = study && activity;
  // "Biraz daha çalış" only once every mode is done for today (not just Kelime), the learning
  // steps that come back later today included (v0.5.2, review B1).
  const allDone = study ? study.left === 0 : false;
  const moreBelow = allDone && !!more && hasMoreStudy(more);

  return (
    <div className={gridClass}>
      <div className="flex min-w-0 flex-col gap-8">
        {ready ? (
          <TodayHero
            moreBelow={moreBelow}
            data={{
              study,
              activity,
              streak: core.streak,
              next: allDone ? core.next : null,
              now: core.now,
              timezone: core.timezone,
            }}
          />
        ) : (
          <TodaySkeleton />
        )}
        {allDone && more && <MoreStudy more={more} />}
        {heroReady && <Notes />}
        {heroReady && goals && goals.dayTarget === null && <GoalPrompt />}
        {heroReady && <TodayReadingCard />}
      </div>
      <div className="flex min-w-0 flex-col gap-8">
        {stages && totalWords !== undefined && goals && (
          <WordsCard
            stages={stages}
            totalWords={totalWords}
            retention={core.streak.retentionRate}
            retentionGoal={goals.retentionGoal}
          />
        )}
        {shortcuts && activity && (
          <Shortcuts
            data={shortcuts}
            showHard={!allDone}
            goals={goals}
            todayMinutes={activity.minutes}
          />
        )}
      </div>
    </div>
  );
}

/** Decks for the user, read once per visit (the word bank is large and rarely changes). */
function useHomeDecks(enabled: boolean): HomeDeck[] | undefined {
  const [decks, setDecks] = useState<HomeDeck[]>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getHomeDecks()
      .then((d) => live && setDecks(d))
      .catch((e: unknown) => void logError(e, 'home.decks'));
    return () => {
      live = false;
    };
  }, [enabled]);
  return decks;
}

/**
 * Occasional notes, at most one at a time (v0.5.1): the stricter "öğrenildi" rule, a covered
 * streak day, load (catch-up, vacation), the FSRS offer, interests, a level change. Every note
 * stays mounted and decides by itself whether it renders; the container shows only the first
 * one that does, so the next comes up once it is closed. The guest backup reminder is a banner
 * of its own above the page (RootLayout) and does not hold these back.
 */
function Notes() {
  return (
    <div
      className="flex flex-col empty:hidden [&>:empty]:hidden [&>:not(:empty)~*]:hidden"
      data-testid="home-notes"
    >
      <StageRuleNote />
      <StreakFreezeNote />
      <LoadNotes />
      <FsrsOptOffer />
      <InterestsPrompt />
      <LevelChangeLine />
    </div>
  );
}

/** Shown once after the update (docs/plan "Öğrenme modeli" 6), until closed. */
function StageRuleNote() {
  const { t } = useTranslation();
  const visible = useLiveQuery(() => stageRuleNoteVisible(), []);
  if (!visible) return null;
  return (
    <HomeNote
      titleId="stage-rule-title"
      icon="info"
      title={t('today.ruleTitle')}
      data-testid="stage-rule-note"
      onClose={() =>
        void setMeta(STAGE_RULE_NOTE_KEY, true).catch(
          (e: unknown) => void logError(e, 'home.ruleNote'),
        )
      }
    >
      <p>{t('today.ruleBody')}</p>
    </HomeNote>
  );
}

/** Mirrors the Today card: ring + two lines, a chip row, the button, the week strip. */
function TodaySkeleton() {
  return (
    <Card padding="lg" aria-busy="true" className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Skeleton className="size-19 rounded-full" />
        <Skeleton lines={2} className="flex-1" />
      </div>
      <Skeleton className="h-9 w-3/4 rounded-full" />
      <Skeleton className="h-13 rounded-control" />
      <Skeleton className="h-2.5 w-36 rounded-full" />
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className={gridClass}>
      <TodaySkeleton />
      <Card>
        <Skeleton lines={3} />
      </Card>
    </div>
  );
}

/** "Senin için desteler": ready-made decks that suit a new user (Keşfet owns the full list). */
function DecksForYou({ decks }: { decks: HomeDeck[] }) {
  const { t } = useTranslation();
  if (decks.length === 0) return null;
  return (
    <section aria-labelledby="decks-for-you-title">
      <SectionHeader
        id="decks-for-you-title"
        title={t('today.decksTitle')}
        action={
          <Link to={DISCOVER_DECKS_HREF} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            {t('today.decksDiscover')}
          </Link>
        }
      />
      <ListGroup>
        {decks.map((d) => (
          <ListRow
            key={d.key}
            to={`/decks/suggested/${d.key}`}
            leadingIcon="layers"
            leadingTone="accent"
            title={
              d.kind === 'freq'
                ? t('today.deckFreq', { count: HOME_FREQ_SIZE })
                : t('today.deckLevelVerbs', { level: d.level })
            }
            description={
              d.have !== null && d.size !== null
                ? t('today.deckHave', { have: formatNumber(d.have), size: formatNumber(d.size) })
                : t('today.deckReady')
            }
          />
        ))}
      </ListGroup>
    </section>
  );
}

/** No words yet: three steps, the Add sheet, the level test and decks to start from. */
function HomeWelcome() {
  const { t } = useTranslation();
  const decks = useHomeDecks(true);
  // A first-time user learns the counting rule as it is: the "rule changed" note is not for them.
  useEffect(() => {
    void setMeta(STAGE_RULE_NOTE_KEY, true).catch(
      (e: unknown) => void logError(e, 'home.ruleNote'),
    );
  }, []);
  const steps = [t('home.emptyStep1'), t('home.emptyStep2'), t('home.emptyStep3')];
  return (
    <HomeFrame timezone={undefined} title={t('home.emptyTitle')}>
      <div className={gridClass}>
        <div className="flex min-w-0 flex-col gap-8">
          <Card padding="lg" className="flex flex-col gap-6">
            <p className="text-lead text-fg-muted">{t('home.emptyBody')}</p>
            <ol className="flex flex-col gap-4">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-ui font-semibold text-accent-text"
                  >
                    {i + 1}
                  </span>
                  <p className="pt-1 text-ui text-fg">{s}</p>
                </li>
              ))}
            </ol>
            <Button
              size="lg"
              fullWidth
              leadingIcon="plus"
              onClick={openAddSheet}
              aria-haspopup="dialog"
            >
              {t('home.emptyAction')}
            </Button>
          </Card>
          <LevelTestOffer />
        </div>
        <div className="flex min-w-0 flex-col gap-8">{decks && <DecksForYou decks={decks} />}</div>
      </div>
    </HomeFrame>
  );
}
