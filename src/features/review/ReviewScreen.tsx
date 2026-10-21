import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, getSettings } from '@/data';
import { Rating as R, type RatingValue } from '@/domain/types';
import { getNextDue, cfgOf } from '@/features/home/queries';
import { nextDueText } from '@/features/home/nextDueText';
import { requestSync } from '@/sync';
import {
  Button,
  buttonClasses,
  DropdownMenu,
  EmptyState,
  FlipCard,
  IconButton,
  ProgressBar,
  RatingButton,
  ratings,
  Skeleton,
  toast,
  type Rating,
} from '@/ui';
import { CardBack, CardFront } from './CardFaces';
import { EditSheet } from './EditSheet';
import { SessionSummary } from './SessionSummary';
import { useReviewSession } from './useReviewSession';
import { useSpeech } from './useSpeech';

const ratingValue: Record<Rating, RatingValue> = {
  again: R.Again,
  hard: R.Hard,
  good: R.Good,
  easy: R.Easy,
};

/** Elements whose own keyboard handling wins over the review shortcuts. */
const KEY_SCOPE_IGNORE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]';

export function ReviewScreen() {
  const { t } = useTranslation();
  const { state, start, actions: session } = useReviewSession();
  const settings = useLiveQuery(() => getSettings(), []);
  const speech = useSpeech(settings?.voice ?? 'en-US');
  const [editOpen, setEditOpen] = useState(false);
  const busy = useRef(false);
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const ratingGroupRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<'ratings' | 'show' | null>(null);

  const current = state.current;
  const currentId = current?.view.card.id ?? null;

  // A card deleted or suspended elsewhere (another tab, sync) while on screen is skipped.
  const watched = useLiveQuery(
    async () =>
      currentId ? { id: currentId, card: (await db.cards.get(currentId)) ?? null } : null,
    [currentId],
  );
  useEffect(() => {
    if (!watched || watched.id !== currentId || busy.current) return;
    const c = watched.card;
    if (!c || c.deleted_at !== null || c.suspended) {
      toast({ title: t('review.cardGone') });
      void session.skipCurrent();
    }
  }, [watched, currentId, session, t]);

  // Move focus sensibly for keyboard users after flipping and answering via buttons.
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
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof Element ? e.target : null;
      if (editOpenRef.current || target?.closest(KEY_SCOPE_IGNORE)) return;
      const s = stateRef.current;
      if (e.key === ' ' || e.code === 'Space') {
        // A focused button or link keeps its native Space activation.
        if (target?.closest('button, a')) return;
        e.preventDefault();
        if (s.phase === 'card' && !s.flipped) session.flip();
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

  if (state.phase === 'loading') return <ReviewSkeleton />;

  if (state.phase === 'done') {
    const answers = session.getAnswers();
    if (answers.length === 0) return <ReviewEmpty canUndo={state.canUndo} onUndo={doUndo} />;
    return (
      <SessionSummary
        answers={answers}
        start={start}
        settled={session.settled}
        canUndo={state.canUndo}
        onUndo={() => void doUndo()}
      />
    );
  }

  const total = state.answered + state.remaining;
  const speak = {
    available: speech.available,
    onSpeak: () => current && speech.speak(current.view.note.term),
    speakText: speech.speak,
  };
  const isNew = current?.kind === 'new';

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-5">
      <h1 className="sr-only">{t('review.title')}</h1>
      <div className="mb-4 flex items-center gap-2">
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
              { label: t('review.suspend'), icon: 'pause', onSelect: () => void doSuspend() },
            ]}
          />
        </div>
      </div>

      {current ? (
        <div
          key={current.view.card.id + ':' + state.answered}
          data-card-type={current.view.card.card_type}
          data-flipped={state.flipped}
          className="contents"
        >
          <FlipCard
            flipped={state.flipped}
            onFlip={state.flipped ? undefined : session.flip}
            front={<CardFront view={current.view} isNew={isNew} speech={speak} />}
            back={<CardBack view={current.view} isNew={isNew} speech={speak} />}
          />
        </div>
      ) : (
        <CardPlaceholder />
      )}

      <div className="mt-auto pt-6 md:mt-0 md:pt-8">
        {state.flipped && current ? (
          <div
            ref={ratingGroupRef}
            tabIndex={-1}
            role="group"
            aria-label={t('rating.group')}
            className="grid grid-cols-4 gap-2 outline-none"
          >
            {ratings.map((r, i) => (
              <RatingButton
                key={r}
                rating={r}
                interval={current.view.previews[ratingValue[r]].label}
                shortcut={String(i + 1)}
                onClick={(e) => {
                  if (e.detail === 0) focusAfter.current = 'show';
                  session.answer(ratingValue[r]);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Button
              ref={showAnswerRef}
              size="lg"
              fullWidth
              disabled={!current}
              onClick={(e) => {
                if (e.detail === 0) focusAfter.current = 'ratings';
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

      <EditSheet
        view={current?.view ?? null}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void session.refreshCurrent()}
      />
    </div>
  );
}

function CardPlaceholder() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-[min(52dvh,26rem)] flex-col items-center justify-center gap-4 rounded-card border border-border bg-surface-raised shadow-raised"
    >
      <Skeleton className="h-9 w-40" />
      <Skeleton className="w-56" />
    </div>
  );
}

function ReviewSkeleton() {
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

function ReviewEmpty({ canUndo, onUndo }: { canUndo: boolean; onUndo: () => void }) {
  const { t } = useTranslation();
  const info = useLiveQuery(async () => {
    const [next, settings, anyNote] = await Promise.all([
      getNextDue(),
      getSettings(),
      db.notes.filter((n) => n.deleted_at === null).first(),
    ]);
    return { next, tz: cfgOf(settings).timezone, hasCards: !!anyNote, now: Date.now() };
  }, []);
  if (!info) return <ReviewSkeleton />;
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-10 sm:px-6 md:pt-16">
      <h1 className="sr-only">{t('review.title')}</h1>
      <EmptyState
        icon={info.hasCards ? 'check' : 'cards'}
        title={info.hasCards ? t('review.emptyTitle') : t('review.noCardsTitle')}
        description={
          info.hasCards ? nextDueText(t, info.next, info.now, info.tz) : t('review.noCardsBody')
        }
        action={
          <>
            <Link
              to={info.hasCards ? '/' : '/add'}
              className={buttonClasses({ size: 'lg', className: 'min-w-60' })}
            >
              {info.hasCards ? t('review.backHome') : t('review.addCards')}
            </Link>
            {info.hasCards && (
              <Link
                to="/add"
                className={buttonClasses({ variant: 'ghost', className: 'min-w-60' })}
              >
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
