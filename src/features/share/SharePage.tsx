// /share — "Paylaş → Engapp" (v0.4 İP6, docs/decisions/0034-share-target.md). Reached from the
// Android share sheet (src/native/share.ts) and from the installed PWA's Web Share Target
// (manifest share_target, GET). Where the text goes is decided by routeShared (route.ts).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { createImportJob, getSettings, logError } from '@/data';
import { chunkText } from '@/domain/chunking';
import { ArticleFetch } from '@/features/article/ArticleFetch';
import { useAuth } from '@/features/auth/session';
import { ImportGate } from '@/features/import/ImportGate';
import { ImportPrivacyNote } from '@/features/import/PrivacyNote';
import { kickImportQueue } from '@/features/import/queue';
import { firstWords } from '@/features/import/shared';
import { Button, EmptyState, Icon, Page, Spinner, Surface, buttonClasses } from '@/ui';
import { countWords, MAX_TERM_WORDS, routeShared, shareHref } from './route';

/**
 * One import job per shared text, even when the page renders twice (StrictMode, going back to
 * it): the promise is kept for the session.
 */
const started = new Map<string, Promise<string>>();

function startJob(
  text: string,
  title: string,
  level: Parameters<typeof createImportJob>[0]['level'],
) {
  let p = started.get(text);
  if (!p) {
    p = createImportJob({ kind: 'text', title, chunks: chunkText(text), level }).then((job) => {
      kickImportQueue();
      return job.id;
    });
    p.catch(() => started.delete(text));
    started.set(text, p);
  }
  return p;
}

/** Signed in: starts the extraction at once and opens its preview (acceptance criterion 10). */
function StartExtraction({ text, title }: { text: string; title: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The user's level (the AI skips words below it); undefined while settings load.
  const level = useLiveQuery(async () => (await getSettings()).level, []);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failed = failedAttempt === attempt;

  useEffect(() => {
    if (!level) return;
    let live = true;
    // startJob de-duplicates, so a second render or a retry never makes two jobs.
    startJob(text, title, level).then(
      (id) => {
        if (live) void navigate(`/import/${id}`, { replace: true });
      },
      (e: unknown) => {
        void logError(e, 'share.startJob');
        if (live) setFailedAttempt(attempt);
      },
    );
    return () => {
      live = false;
    };
  }, [text, title, level, attempt, navigate]);
  const run = () => setAttempt((n) => n + 1);

  if (failed)
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-danger-text">
          {t('share.textFailed')}
        </p>
        <Button onClick={run} leadingIcon="search">
          {t('share.textStart')}
        </Button>
      </div>
    );
  return (
    <p role="status" className="flex items-center gap-2 text-[0.9375rem] text-fg-muted">
      <Spinner size={16} /> {t('share.textStarting')}
    </p>
  );
}

function SharedText({ text, title }: { text: string; title: string | null }) {
  const { t } = useTranslation();
  return (
    <Page title={t('share.textTitle')} description={t('share.textLead')}>
      <ImportPrivacyNote />
      <Surface tone="sunken" padding="sm" className="mb-6 px-4">
        <p
          lang="en"
          data-testid="shared-text"
          className="line-clamp-6 font-serif text-[1.0625rem] whitespace-pre-line text-fg"
        >
          {text}
        </p>
      </Surface>
      <ImportGate>
        <StartExtraction text={text} title={title || firstWords(text) || t('share.defaultTitle')} />
      </ImportGate>
    </Page>
  );
}

/** The title-only actions of a shared link: the fallback when the article cannot be fetched. */
function TitleOnly({ title }: { title: string | null }) {
  const { t } = useTranslation();
  const titleWords = title ? countWords(title) : 0;
  return (
    <div className="flex flex-col gap-3">
      {title && titleWords > 0 && <p className="text-sm text-fg-muted">{t('article.titleOnly')}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        {title && titleWords > 0 && (
          <Link
            to={
              titleWords <= MAX_TERM_WORDS
                ? `/add?term=${encodeURIComponent(title)}`
                : shareHref({ text: title })
            }
            className={buttonClasses({ variant: 'secondary', size: 'lg' })}
          >
            {titleWords <= MAX_TERM_WORDS ? t('share.linkTermFromTitle') : t('share.linkFromTitle')}
          </Link>
        )}
        <Link to="/" className={buttonClasses({ variant: 'ghost', size: 'lg' })}>
          {t('share.toHome')}
        </Link>
      </div>
    </div>
  );
}

/**
 * A shared link (v0.5 İP2, decision 0044): the full article through fetch-article, opened in
 * the reader or sent to word extraction. Offline, signed out or on any failure, a clear
 * message, the copy-paste way and the title-only actions remain.
 */
function SharedLink({ url, title }: { url: string; title: string | null }) {
  const { t } = useTranslation();
  const auth = useAuth();
  return (
    <Page title={t('share.linkTitle')}>
      <Surface padding="md" className="mb-6 flex flex-col gap-2">
        {title && (
          <p
            lang="en"
            className="font-serif text-xl font-semibold text-fg"
            data-testid="shared-title"
          >
            {title}
          </p>
        )}
        <p
          className="flex items-start gap-2 text-sm break-all text-fg-muted"
          data-testid="shared-url"
        >
          <Icon name="link" size={16} className="mt-0.5 shrink-0" />
          {url}
        </p>
      </Surface>
      {auth.status === 'signed_in' ? (
        <ArticleFetch url={url} fallback={<TitleOnly title={title} />} />
      ) : auth.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-[0.9375rem] text-fg-muted">
          <Spinner size={16} /> {t('article.fetching')}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-[0.9375rem] text-fg" data-testid="article-error-message">
            {t('article.errors.not_signed_in')} {t('article.pasteHint')}
          </p>
          <TitleOnly title={title} />
        </div>
      )}
    </Page>
  );
}

export function SharePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const route = useMemo(
    () =>
      routeShared({ text: params.get('text'), title: params.get('title'), url: params.get('url') }),
    [params],
  );

  switch (route.kind) {
    case 'term':
      // The manual form looks the term up in the lexicon and shows its meanings: the card preview.
      return <Navigate to={`/add?term=${encodeURIComponent(route.term)}`} replace />;
    case 'text':
      return <SharedText text={route.text} title={route.title} />;
    case 'link':
      return <SharedLink url={route.url} title={route.title} />;
    default:
      return (
        <Page title={t('share.title')} hideTitle>
          <EmptyState
            icon="info"
            title={t('share.emptyTitle')}
            description={t('share.emptyBody')}
            action={
              <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
                {t('share.toHome')}
              </Link>
            }
          />
        </Page>
      );
  }
}
