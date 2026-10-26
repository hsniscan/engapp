// The article of one address: fetched through fetch-article, then shown with TextResult; a
// failure gets its own Turkish message and the copy-paste way, plus an optional fallback
// (the share screen keeps its title-only actions there).
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Icon, Spinner, Surface, buttonClasses } from '@/ui';
import { TextResult } from './TextResult';
import { useArticleFetch, type ArticleError } from './useArticle';

const RETRYABLE: readonly ArticleError[] = ['offline', 'fetch_failed', 'generic'];

export function ArticleFetch({
  url,
  fetcher,
  fallback,
}: {
  url: string;
  fetcher?: Parameters<typeof useArticleFetch>[0];
  /** Shown under the failure message (title-only actions of a shared link). */
  fallback?: ReactNode;
}) {
  const { t } = useTranslation();
  const { state, run } = useArticleFetch(fetcher);

  useEffect(() => {
    run(url);
  }, [url, run]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-[0.9375rem] text-fg-muted">
        <Spinner size={16} /> {t('article.fetching')}
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-5" data-testid="article-error">
        <Surface tone="sunken" padding="md" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-semibold text-fg">
            <Icon name="info" size={18} className="shrink-0 text-fg-muted" />
            {t('article.failTitle')}
          </p>
          <p role="alert" className="text-[0.9375rem] text-fg" data-testid="article-error-message">
            {t(`article.errors.${state.error}`)}
          </p>
          <p className="text-sm text-fg-muted">{t('article.pasteHint')}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Link
              to="/add?tab=paste"
              className={buttonClasses({ variant: 'secondary' })}
              data-testid="article-paste"
            >
              {t('article.pasteCta')}
            </Link>
            {RETRYABLE.includes(state.error) && (
              <Button
                variant="ghost"
                leadingIcon="refresh"
                onClick={() => run(url, { retry: true })}
              >
                {t('article.retry')}
              </Button>
            )}
          </div>
        </Surface>
        {fallback}
      </div>
    );
  }

  const a = state.article;
  const meta = [a.byline, a.site].filter(Boolean).join(' · ') || null;
  const notes = (
    <>
      {a.truncated && <p className="text-sm text-fg-muted">{t('article.truncated')}</p>}
      {a.lang && !a.lang.startsWith('en') && (
        <p className="text-sm text-warn-text">{t('article.notEnglish')}</p>
      )}
    </>
  );
  return (
    <TextResult
      kind="article"
      title={a.title}
      meta={meta}
      paragraphs={a.paragraphs}
      sourceUrl={a.url}
      notes={notes}
    />
  );
}
