// "Eller serbest" (v0.5 İP9, ADR 0051), /practice?mode=audio: a listening round for walking or
// driving. The English word, a pause to recall it, the Turkish meaning, an example sentence;
// then the next word. Three large controls (Duraklat/Devam, Sonraki, Bitir), the same on the
// lock screen through the Media Session API; the screen is kept awake while it plays and can
// be blacked out. Practice only: it writes nothing (no FSRS state, no review or practice log,
// no encounter).
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { getSettings, logError } from '@/data';
import { getHandsFreeItems } from '@/data/handsFree';
import { type HandsFreeItem, revealedAt } from '@/domain/handsFree';
import { uuidv7 } from '@/domain/ids';
import { parsePracticeParams } from '@/features/extra/links';
import { Button, buttonClasses, Card, cn, EmptyState, Icon, ProgressBar, Skeleton } from '@/ui';
import { handsFreeVoice, type HandsFreeVoice } from './handsFreeVoice';
import { type HandsFreeTimers, useHandsFree } from './useHandsFree';

type Load = { phase: 'loading' } | { phase: 'ready'; items: HandsFreeItem[] };

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-(--page-reading) flex-col gap-4 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-5',
        className,
      )}
    >
      <h1 className="sr-only">{t('modes.handsFree.title')}</h1>
      {children}
    </div>
  );
}

/** Keeps the screen on while the round plays (where the browser allows it). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!active || !nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let live = true;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock!.request('screen').then(
        (l) => {
          if (live) lock = l;
          else void l.release().catch(() => {});
        },
        () => {},
      );
    };
    acquire();
    // The browser drops the lock when the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

interface MediaControls {
  playing: boolean;
  title: string | null;
  album: string;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onStop: () => void;
}

/** Lock-screen and headset controls (Media Session API). */
function useMediaSession(c: MediaControls) {
  const ref = useRef(c);
  useEffect(() => {
    ref.current = c;
  });
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  useEffect(() => {
    if (!ms) return;
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // an action this browser does not know
      }
    };
    set('play', () => ref.current.onPlay());
    set('pause', () => ref.current.onPause());
    set('nexttrack', () => ref.current.onNext());
    set('stop', () => ref.current.onStop());
    return () => {
      for (const a of ['play', 'pause', 'nexttrack', 'stop'] as MediaSessionAction[]) set(a, null);
      ms.metadata = null;
      ms.playbackState = 'none';
    };
  }, [ms]);
  useEffect(() => {
    if (!ms) return;
    ms.playbackState = c.playing ? 'playing' : 'paused';
    if (c.title && typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({ title: c.title, artist: 'Engapp', album: c.album });
    }
  }, [ms, c.playing, c.title, c.album]);
}

export function HandsFreeScreen({
  voice = handsFreeVoice,
  timers,
}: {
  voice?: HandsFreeVoice;
  /** Tests: the pauses' timers. */
  timers?: HandsFreeTimers;
}) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const searchKey = search.toString();
  const params = useMemo(() => parsePracticeParams(new URLSearchParams(searchKey)), [searchKey]);
  const settings = useLiveQuery(() => getSettings(), []);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    let live = true;
    const filter = {
      source: params.source,
      tag: params.tag,
      deckId: params.deck ?? null,
      noteIds: params.source === 'list' ? new Set(params.notes ?? []) : null,
    };
    getHandsFreeItems(filter, { size: params.size, seed: uuidv7() }).then(
      (items) => live && setLoad({ phase: 'ready', items }),
      (e: unknown) => {
        void logError(e, 'handsFree:load');
        if (live) setLoad({ phase: 'ready', items: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [params]);

  const items = load.phase === 'ready' ? load.items : [];
  const { state, steps, actions } = useHandsFree(items, voice, settings?.voice ?? 'en-US', timers);
  const playing = state.status === 'playing';
  const item = items[state.index] ?? null;
  useWakeLock(playing);
  useMediaSession({
    playing,
    title: state.status === 'ready' || state.status === 'done' ? null : (item?.term ?? null),
    album: t('modes.handsFree.title'),
    onPlay: () => (state.status === 'ready' ? actions.start() : actions.resume()),
    onPause: actions.pause,
    onNext: actions.next,
    onStop: actions.stop,
  });

  if (load.phase === 'loading') {
    return (
      <Frame>
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
        <Skeleton className="h-1 w-full" />
        <div className="flex min-h-[min(52dvh,26rem)] flex-col items-center justify-center gap-4 rounded-card border border-border bg-surface-raised shadow-raised">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="w-56" />
        </div>
      </Frame>
    );
  }

  if (items.length === 0) {
    return (
      <Frame className="pt-6 md:pt-12">
        <EmptyState
          tone="card"
          icon="cards"
          title={t('modes.handsFree.empty')}
          action={
            <Link to="/study/more" className={buttonClasses({ size: 'lg', className: 'min-w-60' })}>
              {t('practice.backToMore')}
            </Link>
          }
        />
      </Frame>
    );
  }

  if (state.status === 'ready') {
    return (
      <Frame className="justify-center">
        <Card padding="lg" className="flex flex-col gap-3">
          <h2 className="text-page font-semibold text-fg">{t('modes.handsFree.title')}</h2>
          <p className="text-body text-fg">{t('modes.handsFree.intro', { count: items.length })}</p>
          <p className="text-meta text-fg-muted">{t('modes.handsFree.practiceNote')}</p>
        </Card>
        <Button
          size="lg"
          fullWidth
          leadingIcon="play-solid"
          data-testid="hands-free-start"
          onClick={actions.start}
          className="h-16 text-lead"
        >
          {t('modes.handsFree.start')}
        </Button>
        <Link to="/study/more" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
          {t('common.cancel')}
        </Link>
      </Frame>
    );
  }

  if (state.status === 'done') {
    const heard = Math.min(items.length, state.index + 1);
    return (
      <Frame className="justify-center">
        <EmptyState
          tone="card"
          icon="check"
          title={t('modes.handsFree.doneTitle')}
          description={`${t('modes.handsFree.doneBody', { count: heard })} ${t('modes.handsFree.practiceNote')}`}
          action={
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Link
                to={`/practice?${searchKey}`}
                className={buttonClasses({ size: 'lg', fullWidth: true })}
                data-testid="hands-free-again"
              >
                {t('modes.handsFree.again')}
              </Link>
              <Link to="/study/more" className={buttonClasses({ variant: 'secondary', fullWidth: true })}>
                {t('practice.backToMore')}
              </Link>
            </div>
          }
        />
      </Frame>
    );
  }

  const shown = revealedAt(steps, state.step);
  // Large controls (80 px) for walking or driving.
  const big =
    'flex min-h-20 flex-1 flex-col items-center justify-center gap-1 rounded-card text-ui font-semibold transition-colors duration-(--duration-micro) motion-safe:active:scale-[0.98]';
  return (
    <Frame>
      <div className="flex items-center gap-3 pt-1">
        <ProgressBar
          value={state.index + 1}
          max={items.length}
          className="flex-1"
          label={t('modes.handsFree.title')}
          valueText={t('modes.handsFree.progress', { n: state.index + 1, total: items.length })}
        />
        <span className="tabular shrink-0 text-meta font-semibold text-fg-muted" aria-hidden="true">
          {state.index + 1} / {items.length}
        </span>
      </div>

      <section
        aria-live="polite"
        data-testid="hands-free-card"
        className="flex min-h-[min(46dvh,22rem)] flex-1 flex-col justify-center gap-4 rounded-card border border-border bg-surface-raised px-5 py-6 text-center shadow-raised"
      >
        <p lang="en" className="font-serif text-display leading-tight font-semibold break-words text-fg">
          {item?.term}
        </p>
        <p
          data-testid="hands-free-meaning"
          className={cn('text-heading font-semibold text-fg transition-opacity', shown.meaning ? 'opacity-100' : 'opacity-0')}
          aria-hidden={!shown.meaning}
        >
          {item?.meaning}
        </p>
        {item?.sentence && (
          <p
            lang="en"
            className={cn(
              'font-serif text-lead text-fg-muted italic transition-opacity',
              shown.sentence ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden={!shown.sentence}
          >
            {item.sentence.text}
          </p>
        )}
        <p className="text-meta text-fg-muted">
          {playing ? t('modes.handsFree.playing') : t('modes.handsFree.paused')}
        </p>
      </section>

      <div className="flex gap-2" role="group" aria-label={t('modes.handsFree.controls')}>
        <button
          type="button"
          data-testid="hands-free-toggle"
          onClick={playing ? actions.pause : actions.resume}
          className={cn(big, 'flex-[1.4] bg-accent text-accent-fg hover:bg-accent-hover')}
        >
          <Icon name={playing ? 'pause' : 'play-solid'} size={26} />
          {playing ? t('modes.handsFree.pause') : t('modes.handsFree.resume')}
        </button>
        <button
          type="button"
          data-testid="hands-free-next"
          onClick={actions.next}
          className={cn(big, 'border border-border bg-surface text-fg hover:bg-surface-hover')}
        >
          <Icon name="skip-next" size={26} />
          {t('modes.handsFree.next')}
        </button>
        <button
          type="button"
          data-testid="hands-free-stop"
          onClick={actions.stop}
          className={cn(big, 'border border-border bg-surface text-fg hover:bg-surface-hover')}
        >
          <Icon name="stop" size={26} />
          {t('modes.handsFree.stop')}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setDimmed(true)}
        className="min-h-11 self-center rounded-control px-3 text-meta font-semibold text-fg-muted hover:bg-hover hover:text-fg"
      >
        {t('modes.handsFree.dim')}
      </button>

      {dimmed && (
        <button
          type="button"
          data-testid="hands-free-dimmed"
          onClick={() => setDimmed(false)}
          className="fixed inset-0 z-50 flex items-end justify-center pb-[max(2rem,env(safe-area-inset-bottom))] text-meta"
          // A true black screen (OLED off) in both themes; the grey hint is readable on it (5.9:1).
          style={{ background: '#000', color: '#8a8a8a' }}
        >
          {t('modes.handsFree.undim')}
        </button>
      )}
    </Frame>
  );
}
