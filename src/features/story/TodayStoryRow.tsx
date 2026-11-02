// "Bugünün hikâyesi" (v0.5 İP8, decision 0050; Çam look v0.5.2): one quiet line inside Bugün's
// "Bugünün okuması" card, or a card of its own on Keşfet (`variant="card"`). Today's story when
// there is one; otherwise, with at least five words to practise, an invitation to have it
// written (guests: to sign in first). Hidden when there are not enough words, so a new user's
// screens stay calm. Nothing is drawn until it knows its state, so Keşfet never shows an empty
// card (B11).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { logError } from '@/data';
import { createTodayStory, storyInputs, todayStory } from '@/data/story';
import { MIN_STORY_TARGETS } from '@/domain/story';
import { readerPath } from '@/domain/texts';
import type { Id } from '@/domain/types';
import { useAuth } from '@/features/auth/session';
import { isOnline, useOnline } from '@/lib/online';
import { Button, buttonClasses, Card, Eyebrow, Spinner, Term } from '@/ui';
import { storyError, type StoryError } from './storyError';

type RunState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: StoryError };
type Variant = 'row' | 'card';

function Row({
  variant,
  sub,
  action,
  title,
}: {
  variant: Variant;
  sub: ReactNode;
  action?: ReactNode;
  /** The story's own title (once it exists). */
  title?: ReactNode;
}) {
  const { t } = useTranslation();
  if (variant === 'card')
    return (
      <Card
        as="section"
        aria-labelledby="kf-story"
        className="flex flex-col gap-3"
        data-testid="today-story"
      >
        <Eyebrow as="h2" className="flex items-center gap-2">
          <span id="kf-story">{t('story.title')}</span>
        </Eyebrow>
        {title}
        <p className="text-ui text-fg-muted" aria-live="polite">
          {sub}
        </p>
        {action && <div className="flex pt-1">{action}</div>}
      </Card>
    );
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3"
      data-testid="today-story"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui font-medium text-fg">{t('story.title')}</span>
        <span className="text-meta text-fg-muted" aria-live="polite">
          {title ?? sub}
        </span>
      </span>
      {action}
    </div>
  );
}

export function TodayStoryRow({
  hideTextId = null,
  variant = 'row',
}: {
  hideTextId?: Id | null;
  /** row: a line inside Bugün's reading card · card: a card of its own (Keşfet). */
  variant?: Variant;
}) {
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
  const card = variant === 'card';

  if (story) {
    if (story.id === hideTextId) return null;
    return (
      <Row
        variant={variant}
        title={
          card ? (
            <Term as="p" size="title" className="text-fg">
              {story.title}
            </Term>
          ) : (
            <Term className="text-ui font-normal text-fg">{story.title}</Term>
          )
        }
        sub={t('story.about')}
        action={
          <Link
            to={readerPath(story.id)}
            className={buttonClasses({
              variant: card ? 'secondary' : 'ghost',
              size: 'sm',
              className: card ? undefined : '-mr-2',
            })}
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
        variant={variant}
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
        variant={variant}
        sub={t('story.loading')}
        action={
          <span role="status" className="flex items-center gap-2 text-meta text-fg-muted">
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
      variant={variant}
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
