// /share — "Paylaş → Engapp" (v0.4 İP6, docs/decisions/0034-share-target.md). Reached from the
// Android share sheet (src/native/share.ts) and from the installed PWA's Web Share Target
// (manifest share_target, GET). Where the text goes is decided by routeShared (route.ts).
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { CaptureActions } from '@/features/add/CaptureActions';
import { SignInNeeded } from '@/features/add/SignInNeeded';
import { ArticleFetch } from '@/features/article/ArticleFetch';
import { useAuth } from '@/features/auth/session';
import { firstWords } from '@/features/import/shared';
import { EmptyState, Icon, Page, Spinner, Surface, buttonClasses } from '@/ui';
import { countWords, MAX_TERM_WORDS, routeShared, shareHref } from './route';

/**
 * A shared passage (v0.5.1, decision 0056): nothing starts on its own. The same two ways as every
 * capture, reading first: open it in the reader (no account) or pick out its words (signed in).
 */
function SharedText({ text, title }: { text: string; title: string | null }) {
  const { t } = useTranslation();
  return (
    <Page title={t('share.textTitle')} description={t('share.textLead')}>
      <Surface tone="sunken" padding="sm" className="mb-6 px-4">
        <p
          lang="en"
          data-testid="shared-text"
          className="line-clamp-6 font-serif text-[1.0625rem] whitespace-pre-line text-fg"
        >
          {text}
        </p>
      </Surface>
      <CaptureActions
        input={() => ({
          kind: 'paste',
          title: title || firstWords(text) || t('share.defaultTitle'),
          body: text,
        })}
      />
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
          <SignInNeeded
            title={t('article.errors.not_signed_in')}
            body={t('article.guestBody')}
            testId="article-signin"
          />
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
