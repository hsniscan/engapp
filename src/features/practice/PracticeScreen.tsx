// Practice round screen: the same cards as a review, but two answers ("Bilemedim" /
// "Bildim") and a banner that says the schedule does not change. Keyboard: Space flips,
// 1 = Bilemedim, 2 = Bildim.
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { getSettings } from '@/data';
import type { PracticeResult } from '@/domain/practice';
import { parsePracticeParams } from '@/features/extra/links';
import { CardBack, CardFront } from '@/features/review/CardFaces';
import { useSpeech } from '@/features/review/useSpeech';
import { requestSync } from '@/sync';
import {
  Badge,
  Button,
  buttonClasses,
  EmptyState,
  FlipCard,
  ProgressBar,
  RatingButton,
  Skeleton,
} from '@/ui';
import { HandsFreeScreen } from './HandsFreeScreen';
import { PracticeSummary } from './PracticeSummary';
import { usePracticeSession } from './usePracticeSession';

const KEY_SCOPE_IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]';

/**
 * A new round for every navigation (also "Bir tur daha" to the same URL). `mode=audio` is the
 * hands-free listening round ("Eller serbest", v0.5 İP9).
 */
export function PracticeRoute() {
  const location = useLocation();
  const [search] = useSearchParams();
  if (search.get('mode') === 'audio') return <HandsFreeScreen key={location.key} />;
  return <PracticeScreen key={location.key} />;
}

export function PracticeScreen() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const searchKey = search.toString();
  const params = useMemo(() => parsePracticeParams(new URLSearchParams(searchKey)), [searchKey]);
  const session = usePracticeSession(params);
  const { state } = session;
  const settings = useLiveQuery(() => getSettings(), []);
  const speech = useSpeech(settings?.voice ?? 'en-US');
  const showRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<'answers' | 'show' | null>(null);

  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const cardId = state.view?.card.id ?? null;
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'answers') groupRef.current?.focus();
    else if (target === 'show') showRef.current?.focus();
  }, [state.flipped, cardId, state.round.answers.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(KEY_SCOPE_IGNORE)) return;
      const s = stateRef.current;
      if (e.key === ' ' || e.code === 'Space') {
        if (target?.closest('button, a')) return;
        e.preventDefault();
        if (s.phase === 'card' && !s.flipped) session.flip();
      } else if ((e.key === '1' || e.key === '2') && s.phase === 'card' && s.flipped) {
        e.preventDefault();
        session.answer(e.key === '1' ? 'unknown' : 'known');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  // Practice logs sync like everything else; push them soon after the round.
  useEffect(() => {
    if (state.phase === 'done') void session.settled().then(() => requestSync(0));
  }, [state.phase, session]);

  if (state.phase === 'loading') {
    return (
      <Frame>
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
        <div className="mb-4 flex h-11 items-center">
          <Skeleton className="h-1 w-full" />
        </div>
        <div className="flex min-h-[min(52dvh,26rem)] flex-col items-center justify-center gap-4 rounded-card border border-border bg-surface-raised shadow-raised">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="w-56" />
        </div>
      </Frame>
    );
  }

  if (state.phase === 'empty') {
    return (
      <Frame className="pt-10 md:pt-16">
        <EmptyState
          icon="cards"
          title={t('practice.empty')}
          action={
            <Link to="/study/more" className={buttonClasses({ size: 'lg', className: 'min-w-60' })}>
              {t('practice.backToMore')}
            </Link>
          }
        />
      </Frame>
    );
  }

  if (state.phase === 'done') {
    return (
      <PracticeSummary
        round={state.round}
        views={session.views}
        timeMs={session.timeMs()}
        params={params}
      />
    );
  }

  const view = state.view!;
  const answered = state.round.answers.length;
  const total = answered + state.round.queue.length;
  const speak = {
    available: speech.available,
    onSpeak: () => speech.speak(view.note.term),
    speakText: speech.speak,
  };
  const choose = (result: PracticeResult, keyboard: boolean) => {
    if (keyboard) focusAfter.current = 'show';
    session.answer(result);
  };

  return (
    <Frame>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Badge tone="accent">{t('practice.badge')}</Badge>
        {state.repeat && <span className="text-sm text-fg-muted">{t('practice.repeat')}</span>}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <ProgressBar
          value={answered}
          max={Math.max(1, total)}
          label={t('a11y.progress')}
          valueText={t('review.progress', { done: answered, total })}
        />
        <span aria-hidden="true" className="tabular shrink-0 pl-1 text-sm text-fg-muted">
          {answered} / {total}
        </span>
      </div>

      <div
        key={`${view.card.id}:${answered}`}
        data-card-type={view.card.card_type}
        data-flipped={state.flipped}
        className="contents"
      >
        <FlipCard
          flipped={state.flipped}
          onFlip={state.flipped ? undefined : session.flip}
          front={<CardFront view={view} isNew={false} speech={speak} />}
          back={<CardBack view={view} isNew={false} speech={speak} />}
        />
      </div>

      <div className="mt-auto pt-6 md:mt-0 md:pt-8">
        {state.flipped ? (
          <div
            ref={groupRef}
            tabIndex={-1}
            role="group"
            aria-label={t('practice.group')}
            className="grid grid-cols-2 gap-2 outline-none"
          >
            <RatingButton
              rating="again"
              label={t('practice.dontKnow')}
              shortcut="1"
              onClick={(e) => choose('unknown', e.detail === 0)}
            />
            <RatingButton
              rating="good"
              label={t('practice.know')}
              shortcut="2"
              onClick={(e) => choose('known', e.detail === 0)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Button
              ref={showRef}
              size="lg"
              fullWidth
              onClick={(e) => {
                if (e.detail === 0) focusAfter.current = 'answers';
                session.flip();
              }}
            >
              {t('review.showAnswer')}
            </Button>
            <p className="text-sm text-fg-muted">
              <span className="pointer-fine:hidden">{t('review.tapToFlip')}</span>
              <span className="hidden pointer-fine:inline">{t('review.spaceToFlip')}</span>
            </p>
          </div>
        )}
      </div>
    </Frame>
  );
}

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={
        'mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-5 ' +
        (className ?? '')
      }
    >
      <h1 className="sr-only">{t('practice.title')}</h1>
      {children}
    </div>
  );
}
