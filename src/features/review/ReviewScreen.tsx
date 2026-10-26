// The study session (redesign, boards ReviewFront … ClozeResult): one study mode at a time
// ("Kelime çalışma", "Üretim", "Boşluk doldurma"), or all of them mixed. The card content
// scrolls on its own; the answer bar stays fixed at the bottom (above the keyboard on a phone).
// Keyboard on desktop: Space shows the answer, 1–4 answer, Z undoes.
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { db, getSettings } from '@/data';
import { STUDY_MODES, type StudyMode } from '@/domain/studyMode';
import type { Id, RatingValue } from '@/domain/types';
import { getNextDue, cfgOf } from '@/features/home/queries';
import { nextDueText } from '@/features/home/nextDueText';
import { AfterAgainBar, LeechSheet } from '@/features/leech';
import { requestSync } from '@/sync';
import {
  Badge,
  Button,
  buttonClasses,
  DropdownMenu,
  EmptyState,
  IconButton,
  ProgressBar,
  Skeleton,
  toast,
} from '@/ui';
import { ClozeStudy } from './ClozeStudy';
import { flipsWithSpace, learnedInSession, resetChoiceCandidates } from './study';
import { EditSheet } from './EditSheet';
import { type KindProps, RecognitionStudy } from './kinds';
import { ProductionStudy } from './ProductionStudy';
import { SessionSummary } from './SessionSummary';
import { type StudyModeCount, useStudyModeCounts } from './studyModes';
import { StudyFrame } from './StudyFrame';
import { useReviewSession } from './useReviewSession';
import { prefetchPronunciations } from './pronunciation';
import { useSpeech } from './useSpeech';

/** Elements whose own keyboard handling wins over the session shortcuts. */
const KEY_SCOPE_IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]';

/** "/review" stays as "Kelime çalışma"; "/review?mode=ahead" is tomorrow's cards, every type. */
export function ReviewRoute() {
  const location = useLocation();
  const [search] = useSearchParams();
  const ahead = search.get('mode') === 'ahead';
  return <ReviewScreen key={location.key} studyMode={ahead ? undefined : 'word'} ahead={ahead} />;
}

export interface ReviewScreenProps {
  /** Absent: the mixed queue of every card type ("Karışık çalış", tomorrow's cards). */
  studyMode?: StudyMode;
  /** "Yarının kartlarını şimdi tekrar et". */
  ahead?: boolean;
  /** Only this deck's words (Desteler → "Çalış", `&deck=<id>`). */
  deckId?: Id;
}

export function ReviewScreen({ studyMode, ahead = false, deckId }: ReviewScreenProps) {
  const { t } = useTranslation();
  const {
    state,
    start,
    actions: session,
  } = useReviewSession(ahead ? 'ahead' : 'normal', studyMode, deckId);
  const deckName = useLiveQuery(
    async () => (deckId ? ((await db.decks.get(deckId))?.name ?? null) : null),
    [deckId],
  );
  const settings = useLiveQuery(() => getSettings(), []);
  const speech = useSpeech(settings?.voice ?? 'en-US');
  const [editOpen, setEditOpen] = useState(false);
  // "Bu karta başka yoldan bakalım" (v0.3 İP6): which card, and whether it opens on the picker.
  const [leech, setLeech] = useState<{ cardId: Id; startWith: 'paths' | 'picker' } | null>(null);
  const leechRef = useRef(leech);
  // Cards the leech sheet suspended: the session moves on by itself, without "kart gitti".
  const leechHandled = useRef(new Set<Id>());
  const busy = useRef(false);
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const ratingGroupRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<'ratings' | 'show' | null>(null);

  useEffect(() => resetChoiceCandidates(), []);

  const current = state.current;
  const currentId = current?.view.card.id ?? null;

  // The word on screen: fetch its pre-generated audio now, so the speaker plays at once.
  const term = current?.view.note.term;
  const voice = settings?.voice;
  useEffect(() => {
    if (term && voice) prefetchPronunciations([term], voice);
  }, [term, voice]);

  // A card deleted or suspended elsewhere (another tab, sync) while on screen is skipped.
  const watched = useLiveQuery(
    async () =>
      currentId ? { id: currentId, card: (await db.cards.get(currentId)) ?? null } : null,
    [currentId],
  );
  useEffect(() => {
    if (!watched || watched.id !== currentId || busy.current) return;
    if (leechRef.current?.cardId === watched.id || leechHandled.current.has(watched.id)) return;
    const c = watched.card;
    if (!c || c.deleted_at !== null || c.suspended) {
      toast({ title: t('review.cardGone') });
      void session.skipCurrent();
    }
  }, [watched, currentId, session, t]);

  // Move focus sensibly for keyboard users after showing the answer and answering.
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'ratings') ratingGroupRef.current?.focus();
    else if (target === 'show') showAnswerRef.current?.focus();
  }, [state.flipped, currentId]);

  const doUndo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await session.undo()) toast({ title: t('review.undone') });
    } finally {
      busy.current = false;
    }
  }, [session, t]);

  const doSuspend = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const id = await session.suspendCurrent();
      if (id) {
        toast({
          title: t('review.suspended'),
          description: t('review.suspendedBody'),
          action: { label: t('common.undo'), onClick: () => void session.unsuspend(id) },
        });
      }
    } finally {
      busy.current = false;
    }
  }, [session, t]);

  // Push the session's review logs soon after it ends (and when leaving mid-session):
  // the sync engine's own triggers would otherwise wait for the next interval.
  useEffect(() => {
    if (state.phase !== 'done') return;
    void session.settled().then(() => requestSync(0));
  }, [state.phase, session]);
  useEffect(
    () => () => {
      if (session.getAnswers().length > 0) void session.settled().then(() => requestSync(0));
    },
    [session],
  );

  const stateRef = useRef(state);
  const editOpenRef = useRef(editOpen);
  useLayoutEffect(() => {
    stateRef.current = state;
    editOpenRef.current = editOpen;
    leechRef.current = leech;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      if (editOpenRef.current || leechRef.current || target?.closest(KEY_SCOPE_IGNORE)) return;
      const s = stateRef.current;
      if (e.key === ' ' || e.code === 'Space') {
        // A focused button or link keeps its native Space activation.
        if (target?.closest('button, a')) return;
        if (s.phase === 'card' && !s.flipped && s.current && flipsWithSpace(s.current.view)) {
          e.preventDefault();
          session.flip();
        }
      } else if (e.key >= '1' && e.key <= '4') {
        if (s.phase === 'card' && s.flipped) {
          e.preventDefault();
          session.answer(Number(e.key) as RatingValue);
        }
      } else if (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') {
        if (s.canUndo) {
          e.preventDefault();
          void doUndo();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, doUndo]);

  // After an "Again" answer: the leech flag or the "mixed it up?" prompt (v0.3 İP6), also
  // on the summary when that was the last card.
  const notice = state.notice;
  const afterAgain = notice ? (
    <AfterAgainBar
      notice={notice}
      onOpenSheet={() => setLeech({ cardId: notice.cardId, startWith: 'paths' })}
      onPickConfusion={() => setLeech({ cardId: notice.cardId, startWith: 'picker' })}
      onDismiss={session.dismissNotice}
    />
  ) : null;
  const leechSheet = (
    <LeechSheet
      cardId={leech?.cardId ?? null}
      startWith={leech?.startWith}
      onOpenChange={(open) => {
        if (open) return;
        setLeech(null);
        void session.refreshCurrent();
      }}
      onCardSuspended={(id) => {
        leechHandled.current.add(id);
        void session.cardSuspended(id);
      }}
      onCardsChanged={() => void session.reloadQueue()}
      speech={{ available: speech.available, speak: speech.speak }}
    />
  );

  if (state.phase === 'loading') return <StudySkeleton />;

  if (state.phase === 'done') {
    const answers = session.getAnswers();
    if (answers.length === 0)
      return (
        <StudyEmpty
          studyMode={studyMode}
          ahead={ahead}
          deckName={deckName ?? null}
          canUndo={state.canUndo}
          onUndo={doUndo}
        />
      );
    return (
      <>
        {afterAgain && (
          <div className="mx-auto w-full max-w-xl px-4 pt-3 sm:px-6">{afterAgain}</div>
        )}
        <SessionSummary
          answers={answers}
          start={start}
          settled={session.settled}
          canUndo={state.canUndo}
          onUndo={() => void doUndo()}
          learnedToday={learnedInSession(answers)}
          continueWith={studyMode && !ahead ? <OtherModes current={studyMode} /> : null}
        />
        {leechSheet}
      </>
    );
  }

  const total = state.answered + state.remaining;
  const speak = {
    available: speech.available,
    onSpeak: () => current && speech.speak(current.view.note.term),
    speakText: speech.speak,
  };

  const top = (
    <div className="flex flex-col gap-1 pt-2 pb-2">
      <h1 className="sr-only">
        {studyMode ? t(`study.mode.${studyMode}.name`) : t('review.title')}
      </h1>
      {ahead && (
        <div className="flex">
          <Badge tone="accent">{t('review.aheadBadge')}</Badge>
        </div>
      )}
      {deckName && (
        <div className="flex min-w-0">
          <Badge tone="accent" className="max-w-full truncate" data-testid="study-deck">
            {t('review.deckBadge', { name: deckName })}
          </Badge>
        </div>
      )}
      <div className="flex items-center gap-2">
        <ProgressBar
          value={state.answered}
          max={Math.max(1, total)}
          label={t('a11y.progress')}
          valueText={t('review.progress', { done: state.answered, total })}
        />
        <span aria-hidden="true" className="tabular shrink-0 pl-1 text-sm text-fg-muted">
          {state.answered} / {total}
        </span>
        <div className="-mr-2 flex shrink-0 items-center">
          {state.canUndo && (
            <IconButton icon="undo" label={t('review.undoLastKey')} onClick={() => void doUndo()} />
          )}
          <DropdownMenu
            label={t('review.menu')}
            trigger={<IconButton icon="more" label={t('review.menu')} disabled={!current} />}
            items={[
              {
                label: t('review.undoLast'),
                icon: 'undo',
                shortcut: 'Z',
                disabled: !state.canUndo,
                onSelect: () => void doUndo(),
              },
              { label: t('review.edit'), icon: 'pencil', onSelect: () => setEditOpen(true) },
              {
                label: t('leech.menu'),
                icon: 'layers',
                onSelect: () =>
                  current && setLeech({ cardId: current.view.card.id, startWith: 'paths' }),
              },
              { label: t('review.suspend'), icon: 'pause', onSelect: () => void doSuspend() },
            ]}
          />
        </div>
      </div>
      {afterAgain}
    </div>
  );

  const frame = (body: ReactNode, footer: ReactNode, scrollLabel?: string) => (
    <StudyFrame top={top} footer={footer} scrollLabel={scrollLabel}>
      {body}
    </StudyFrame>
  );

  let content: ReactNode;
  if (!current) {
    content = frame(
      <CardPlaceholder />,
      <Button size="lg" fullWidth disabled>
        {t('review.showAnswer')}
      </Button>,
    );
  } else {
    const kp: KindProps = {
      view: current.view,
      speech: speak,
      revealed: state.flipped,
      onReveal: (viaKeyboard) => {
        if (viaKeyboard) focusAfter.current = 'ratings';
        session.flip();
      },
      onAnswer: (rating, viaKeyboard) => {
        if (viaKeyboard) focusAfter.current = 'show';
        session.answer(rating);
      },
      ratingRef: ratingGroupRef,
      showRef: showAnswerRef,
      frame,
    };
    const { card, note } = current.view;
    const Kind =
      note.term_type === 'contrast'
        ? RecognitionStudy
        : card.card_type === 'production' || card.card_type === 'image'
          ? ProductionStudy
          : card.card_type === 'cloze' && current.view.cloze
            ? ClozeStudy
            : RecognitionStudy;
    content = (
      <div
        key={card.id + ':' + state.answered}
        data-card-type={card.card_type}
        data-flipped={state.flipped}
        className="contents"
      >
        <Kind {...kp} />
      </div>
    );
  }

  return (
    <>
      {content}
      <EditSheet
        view={current?.view ?? null}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void session.refreshCurrent()}
      />
      {leechSheet}
    </>
  );
}

function CardPlaceholder() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-[min(52dvh,26rem)] flex-1 flex-col items-center justify-center gap-4 rounded-[20px] border border-border bg-surface"
    >
      <Skeleton className="h-9 w-40" />
      <Skeleton className="w-56" />
    </div>
  );
}

function StudySkeleton() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col px-4 pt-3 sm:px-6 sm:pt-5">
      <h1 className="sr-only">{t('review.title')}</h1>
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div className="mb-4 flex h-11 items-center">
        <Skeleton className="h-1 w-full" />
      </div>
      <CardPlaceholder />
    </div>
  );
}

/** Links to the other study modes that still have cards today. */
export function OtherModes({ current }: { current?: StudyMode }) {
  const { t } = useTranslation();
  const counts = useStudyModeCounts();
  if (!counts) return null;
  const left = (c: StudyModeCount) => c.due + c.newCount;
  const others = STUDY_MODES.filter((m) => m !== current && left(counts[m]) > 0);
  if (!others.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[18px] border border-border bg-surface p-4 text-left">
      <h2 className="text-sm text-fg-muted">{t('study.empty.others')}</h2>
      {others.map((m) => (
        <Link
          key={m}
          to={`/study?mode=${m}`}
          className={buttonClasses({ variant: 'secondary', fullWidth: true })}
          data-testid={`study-other-${m}`}
        >
          {t('study.empty.otherCount', { mode: t(`study.mode.${m}.name`), count: left(counts[m]) })}
        </Link>
      ))}
    </div>
  );
}

function StudyEmpty({
  studyMode,
  ahead,
  deckName,
  canUndo,
  onUndo,
}: {
  studyMode?: StudyMode;
  ahead: boolean;
  /** A deck-scoped session (Desteler → "Çalış"). */
  deckName: string | null;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const info = useLiveQuery(async () => {
    const [next, settings, anyNote] = await Promise.all([
      getNextDue(),
      getSettings(),
      db.notes.filter((n) => n.deleted_at === null).first(),
    ]);
    return { next, tz: cfgOf(settings).timezone, hasCards: !!anyNote, now: Date.now() };
  }, []);
  if (!info) return <StudySkeleton />;
  const title = !info.hasCards
    ? t('review.noCardsTitle')
    : ahead
      ? t('review.aheadEmptyTitle')
      : deckName
        ? t('study.empty.deck', { name: deckName })
        : studyMode
          ? t(`study.empty.${studyMode}`)
          : t('review.emptyTitle');
  const description = !info.hasCards
    ? t('review.noCardsBody')
    : studyMode === 'production'
      ? t('study.empty.productionBody')
      : nextDueText(t, info.next, info.now, info.tz);
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-10 sm:px-6 md:pt-16">
      <h1 className="sr-only">
        {studyMode ? t(`study.mode.${studyMode}.name`) : t('review.title')}
      </h1>
      <EmptyState
        icon={info.hasCards ? 'check' : 'cards'}
        title={title}
        description={description}
        action={
          <>
            {info.hasCards ? (
              <>
                {studyMode && !ahead && <OtherModes current={studyMode} />}
                <Link
                  to="/study/more"
                  className={buttonClasses({ size: 'lg', className: 'min-w-60' })}
                >
                  {t('review.moreStudy')}
                </Link>
                <Link to="/" className={buttonClasses({ variant: 'ghost', className: 'min-w-60' })}>
                  {t('review.backHome')}
                </Link>
              </>
            ) : (
              <Link to="/add" className={buttonClasses({ size: 'lg', className: 'min-w-60' })}>
                {t('review.addCards')}
              </Link>
            )}
            {canUndo && (
              <Button variant="ghost" leadingIcon="undo" onClick={onUndo}>
                {t('review.undoLast')}
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
