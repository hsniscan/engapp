// Bugün, the home screen of the redesign (boards Main, HomeDone, HomeDark): the whole day's
// study on top (every mode, ADR 0055), at most one note, goals, the words learned under the
// stricter rule, shortcuts and decks that suit the user. One column on phones, two from 1024 px.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getGoalsView, logError, setMeta } from '@/data';
import { SyncIndicator } from '@/app/SyncIndicator';
import { openAddSheet } from '@/features/add/addSheetStore';
import { useAuth } from '@/features/auth/session';
import { FsrsOptOffer } from '@/features/fsrs/FsrsOptOffer';
import { LevelChangeLine, LevelTestOffer } from '@/features/leveltest/LevelHomeNotes';
import { LoadNotes } from '@/features/load/LoadNotes';
import { FirstRunGate } from '@/features/onboarding/FirstRunGate';
import { InterestsPrompt } from '@/features/profile/InterestsPrompt';
import { StreakFreezeNote } from '@/features/smart/StreakFreezeNote';
import { useNow } from '@/features/settings/useNow';
import { useTodayStudy } from '@/features/review/studyModes';
import { useWordStages } from '@/features/stats/useWordStages';
import { Button, cn, Icon, IconButton, Logo, Skeleton, Surface } from '@/ui';
import { DecksForYou } from './DecksForYou';
import { greetingKey, homeDate } from './greeting';
import { GoalsCard } from './GoalsCard';
import { HomeIcon } from './homeIcons';
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
  type HomeDeck,
  STAGE_RULE_NOTE_KEY,
  stageRuleNoteVisible,
} from './todayQueries';
import { useSettled } from './settle';
import { WordsCard } from './WordsCard';
import { TodayReadingCard } from '@/features/reader/TodayReadingCard';

export function HomeScreen() {
  const core = useLiveQuery(() => getHomeCore(), []);
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
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const at = useNow();
  const first = user?.name?.split(/\s+/)[0] ?? null;
  const greeting = t(greetingKey(at, timezone));
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-3.5 pb-8 md:pt-8 lg:max-w-5xl">
      <header className="flex items-center justify-between gap-3 px-1 pb-3 md:pb-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={34} wordmark={false} className="md:hidden" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[0.8125rem] text-fg-muted">{homeDate(at, timezone)}</span>
            <h1 className="truncate font-serif text-xl font-semibold md:text-3xl">
              {title ?? (first ? t('today.greetingName', { greeting, name: first }) : greeting)}
            </h1>
          </div>
        </div>
        <div className="md:hidden">
          <SyncIndicator compact />
        </div>
      </header>
      {children}
    </div>
  );
}

function Dashboard({ core }: { core: HomeCore }) {
  const study = useTodayStudy();
  const activity = useLiveQuery(() => getTodayActivity(), []);
  // The heavy, secondary reads (whole-history goals, extra-study queues, the weekly report and
  // the notes below the hero) start once the hero has its numbers: on a large collection they
  // otherwise share IndexedDB with the hero's queries and delay "Devam et" by seconds
  // (10,000-card profile, decision 0053). Once true it stays true (live queries keep values).
  // v0.5.1 (decision 0059): they wait until the hero has painted and the page is idle for a
  // moment, so a tap on "Çalışmaya başla" right away opens the session without them reading
  // the whole history in the background (10,000 cards: 2 s → under 1 s).
  const heroReady = useSettled(study !== undefined && activity !== undefined);
  const goals = useLiveQuery(() => (heroReady ? getHomeGoals() : undefined), [heroReady]);
  const goalsView = useLiveQuery(() => (heroReady ? getGoalsView() : undefined), [heroReady]);
  const stages = useWordStages(heroReady);
  const totalWords = useLiveQuery(() => (heroReady ? countWords() : undefined), [heroReady]);
  const moreResult = useLiveQuery(() => (heroReady ? getMoreOverview() : undefined), [heroReady]);
  const more = moreResult?.ok ? moreResult.more : null;
  const moreError = moreResult && !moreResult.ok ? moreResult.error : null;
  useEffect(() => {
    if (moreError) void logError(moreError, 'home.moreStudy');
  }, [moreError]);
  const report = useLiveQuery(() => (heroReady ? getReportShortcut() : undefined), [heroReady]);
  const shortcuts = moreResult && report !== undefined ? { more, report } : undefined;
  const decks = useHomeDecks(heroReady);

  const ready = study && activity;
  // "Biraz daha çalış" only once every mode is done for today (not just Kelime).
  const allDone = study ? study.left === 0 : false;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
      <div className="flex flex-col gap-4 lg:gap-5">
        {ready ? (
          <TodayHero
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
          <HeroSkeleton />
        )}
        {allDone && more && <MoreStudy more={more} />}
        {heroReady && <TodayReadingCard />}
        {heroReady && <Notes />}
      </div>
      <div className="flex flex-col gap-4 lg:gap-5">
        {goals && activity && (
          <GoalsCard
            goals={goals}
            view={goalsView}
            todayMinutes={activity.minutes}
            weekMinutes={activity.weekMinutes}
          />
        )}
        {stages && totalWords !== undefined && goals && (
          <WordsCard
            stages={stages}
            totalWords={totalWords}
            retention={core.streak.retentionRate}
            retentionGoal={goals.retentionGoal}
          />
        )}
        {shortcuts && <Shortcuts data={shortcuts} showHard={!allDone} />}
        {decks && <DecksForYou decks={decks} />}
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
    <aside
      aria-labelledby="stage-rule-title"
      className="flex items-start gap-3 rounded-[18px] border border-border bg-surface py-3 pr-1.5 pl-4"
      data-testid="stage-rule-note"
    >
      <HomeIcon name="info" size={20} strokeWidth={1.8} className="mt-0.5 text-accent-text" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        <h2 id="stage-rule-title" className="text-[0.9375rem] font-semibold">
          {t('today.ruleTitle')}
        </h2>
        <p className="text-sm text-fg-muted">{t('today.ruleBody')}</p>
      </div>
      <IconButton
        icon="x"
        label={t('common.close')}
        tooltip={false}
        className="-mt-1"
        onClick={() =>
          void setMeta(STAGE_RULE_NOTE_KEY, true).catch(
            (e: unknown) => void logError(e, 'home.ruleNote'),
          )
        }
      />
    </aside>
  );
}

function HeroSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 rounded-[20px] bg-surface p-5">
      <div className="flex items-center gap-5">
        <Skeleton className="size-23 rounded-full" />
        <Skeleton lines={3} className="flex-1" />
      </div>
      <Skeleton className="h-13 rounded-[14px]" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <HeroSkeleton />
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-37 rounded-[18px]" />
        ))}
      </div>
      <Surface padding="lg">
        <Skeleton lines={3} />
      </Surface>
    </div>
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
      <div className="flex flex-col gap-4">
        <Surface padding="lg" className="flex flex-col gap-6 rounded-[20px]">
          <p className="text-[0.9375rem] text-fg-muted">{t('home.emptyBody')}</p>
          <ol className="flex flex-col gap-5">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full font-serif text-lg font-semibold',
                    i === 0 ? 'bg-accent text-accent-fg' : 'border border-border text-fg-muted',
                  )}
                >
                  {i + 1}
                </span>
                <p className="pt-1.5 text-[0.9375rem] text-fg">{s}</p>
              </li>
            ))}
          </ol>
          <Button size="lg" fullWidth onClick={openAddSheet} aria-haspopup="dialog">
            <Icon name="plus" size={20} />
            {t('home.emptyAction')}
          </Button>
        </Surface>
        <LevelTestOffer />
        {decks && <DecksForYou decks={decks} />}
      </div>
    </HomeFrame>
  );
}
