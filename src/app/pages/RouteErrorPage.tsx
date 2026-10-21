import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';
import { logError } from '@/data';
import { Button, EmptyState, Page, buttonClasses } from '@/ui';

/** A lazy route chunk could not be downloaded (offline without a cached copy, or a new deploy). */
function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS/i.test(
    msg,
  );
}

/**
 * Shown instead of React Router's default (English, unstyled) error screen when a screen throws
 * or its code cannot be loaded. Keeps the app shell around it; the data is never touched.
 */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    void logError(error, chunk ? 'route.chunk' : 'route.render');
  }, [error, chunk]);
  return (
    <Page title={t(chunk ? 'routeError.chunkTitle' : 'routeError.title')} hideTitle>
      <EmptyState
        icon="alert"
        title={t(chunk ? 'routeError.chunkTitle' : 'routeError.title')}
        description={t(chunk ? 'routeError.chunkBody' : 'routeError.body')}
        action={
          <>
            <Button onClick={() => window.location.reload()} leadingIcon="refresh">
              {t('routeError.reload')}
            </Button>
            <Link to="/" reloadDocument className={buttonClasses({ variant: 'ghost' })}>
              {t('nav.backHome')}
            </Link>
          </>
        }
      />
    </Page>
  );
}
