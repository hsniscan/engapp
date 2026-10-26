// "Bugünün hikâyesi" on Bugün (v0.5 İP8, decision 0050): one quiet line inside the
// "Bugünün okuması" card. Today's story when there is one; otherwise, with at least five
// words to practise, an invitation to have it written (guests: to sign in first). Hidden when
// there are not enough words, so a new user's Bugün stays calm.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { logError } from '@/data';
import { createTodayStory, storyInputs, todayStory } from '@/data/story';
import { MIN_STORY_TARGETS } from '@/domain/story';
import { readerPath } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { Button, Spinner } from '@/ui';
import { storyError, type StoryError } from './storyError';

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

type RunState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: StoryError };

function Row({
  sub,
  action,
  title,
}: {
  sub: React.ReactNode;
  action?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3"
      data-testid="today-story"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[0.9375rem] font-medium text-fg">{title ?? t('story.title')}</span>
        <span className="text-sm text-fg-muted" aria-live="polite">
          {sub}
        </span>
      </span>
      {action}
    </div>
  );
}

export function TodayStoryRow({ hideTextId = null }: { hideTextId?: Id | null }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const story = useLiveQuery(() => todayStory(), []);
  const inputs = useLiveQuery(() => storyInputs(), []);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  if (auth.status === 'unavailable' || auth.status === 'loading' || story === undefined) return null;

  if (story) {
    if (story.id === hideTextId) return null;
    return (
      <Row
        sub={
          <span lang="en" className="font-serif text-base text-fg">
            {story.title}
          </span>
        }
        action={
          <Link
            to={readerPath(story.id)}
            className="text-sm font-medium text-accent-text hover:underline"
            data-testid="today-story-open"
          >
            {story.finished_at !== null ? t('story.again') : t('story.open')}
          </Link>
        }
      />
    );
  }

  if (inputs === undefined || inputs.targets.length < MIN_STORY_TARGETS) return null;
  const count = inputs.targets.length;

  if (auth.status === 'guest') {
    return (
      <Row
        sub={t('story.guest')}
        action={
          <Button variant="secondary" size="sm" onClick={() => void auth.signIn()}>
            {t('story.signIn')}
          </Button>
        }
      />
    );
  }

  if (run.status === 'loading') {
    return (
      <Row
        sub={t('story.loading')}
        action={
          <span role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner size={16} />
            <span className="sr-only">{t('story.loading')}</span>
          </span>
        }
      />
    );
  }

  const start = () => {
    if (!isOnline()) {
      setRun({ status: 'error', error: 'offline' });
      return;
    }
    setRun({ status: 'loading' });
    createTodayStory().then(
      (id) => {
        if (live.current) void navigate(readerPath(id));
      },
      (e: unknown) => {
        const error = storyError(e);
        if (error === 'generic') void logError(e, 'story.create');
        if (live.current) setRun({ status: 'error', error });
      },
    );
  };

  const error = run.status === 'error' ? run.error : !online ? 'offline' : null;
  const retryable = error === null || error === 'offline' || error === 'generic';
  return (
    <Row
      sub={error ? t(`story.errors.${error}`) : t('story.ready', { count })}
      action={
        retryable ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={start}
            disabled={!online}
            data-testid="today-story-make"
          >
            {error === 'generic' ? t('story.retry') : t('story.make')}
          </Button>
        ) : undefined
      }
    />
  );
}
