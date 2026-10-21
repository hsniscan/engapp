import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError } from '@/data';
import { Button, Icon, Logo, Spinner, Surface } from '@/ui';
import { AccountPanel } from './AccountPanel';
import { useLinkState } from './link';
import { useAuth } from './session';

function readOAuthReturn(): { hasCode: boolean; error: string | null } {
  if (typeof window === 'undefined') return { hasCode: false, error: null };
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const error =
    q.get('error_description') ?? h.get('error_description') ?? q.get('error') ?? h.get('error');
  return { hasCode: q.has('code') || h.has('access_token'), error };
}

/** /auth — Google sign-in or guest. Also the OAuth return target (finishes and goes home). */
export function AuthPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const link = useLinkState();
  const navigate = useNavigate();
  const [oauth] = useState(readOAuthReturn);
  const [redirecting, setRedirecting] = useState(false);
  const [startError, setStartError] = useState(false);

  const linking =
    link.phase === 'checking' ||
    link.phase === 'applying' ||
    link.phase === 'choose' ||
    link.phase === 'error';
  // Back from Google: once the account is linked, continue to the home screen.
  useEffect(() => {
    if (oauth.hasCode && auth.status === 'signed_in' && !linking)
      void navigate('/', { replace: true });
  }, [oauth.hasCode, auth.status, linking, navigate]);

  const signIn = async () => {
    setStartError(false);
    setRedirecting(true);
    try {
      await auth.signIn();
    } catch (e) {
      void logError(e, 'auth.signIn');
      setRedirecting(false);
      setStartError(true);
    }
  };

  const finishing =
    (oauth.hasCode && (auth.status === 'loading' || auth.status === 'signed_in')) ||
    (auth.status === 'signed_in' && linking && link.phase !== 'choose');

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 pt-10 pb-12 text-center sm:px-6 md:pt-16">
      <Logo size={52} wordmark={false} />
      <h1 className="mt-6 font-serif text-3xl leading-tight font-semibold tracking-[-0.01em] text-fg md:text-4xl">
        {auth.status === 'signed_in' && !finishing ? t('auth.signedInTitle') : t('auth.heading')}
      </h1>

      {finishing ? (
        <div role="status" className="mt-10 flex flex-col items-center gap-3 text-fg-muted">
          <Spinner size={24} />
          <p className="text-[0.9375rem]">
            {link.phase === 'checking' || link.phase === 'applying'
              ? t('account.checking')
              : t('auth.finishing')}
          </p>
        </div>
      ) : auth.status === 'signed_in' ? (
        <>
          <Surface padding="none" className="mt-8 w-full text-left">
            <AccountPanel />
          </Surface>
          <Button size="lg" fullWidth className="mt-6" onClick={() => void navigate('/')}>
            {t('auth.toHome')}
          </Button>
        </>
      ) : !auth.available ? (
        <>
          <p className="mt-3 max-w-sm text-[0.9375rem] text-fg-muted">{t('auth.lead')}</p>
          <Surface padding="lg" className="mt-8 w-full text-left">
            <div className="flex items-start gap-3">
              <Icon name="info" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
              <div className="flex flex-col gap-1">
                <h2 className="font-medium text-fg">{t('auth.unavailableTitle')}</h2>
                <p className="text-sm text-fg-muted">{t('auth.unavailableBody')}</p>
              </div>
            </div>
            <Button size="lg" fullWidth className="mt-6" onClick={() => void navigate('/')}>
              {t('auth.guest')}
            </Button>
          </Surface>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-sm text-[0.9375rem] text-fg-muted">{t('auth.lead')}</p>
          {oauth.error && (
            <p
              role="alert"
              className="mt-6 flex w-full items-start gap-2 rounded-control bg-danger-soft px-3 py-2.5 text-left text-sm text-danger-text"
            >
              <Icon name="alert" size={18} className="mt-px shrink-0" />
              <span>
                <strong className="font-semibold">{t('auth.failed')}.</strong>{' '}
                {t('auth.failedBody', { message: oauth.error })}
              </span>
            </p>
          )}
          <Surface padding="lg" className="mt-8 w-full">
            <Button
              variant="secondary"
              size="lg"
              leadingIcon="google"
              fullWidth
              loading={redirecting || auth.status === 'loading'}
              onClick={() => void signIn()}
            >
              {redirecting ? t('auth.redirecting') : t('auth.google')}
            </Button>
            {startError && (
              <p role="alert" className="mt-3 text-left text-sm text-danger-text">
                {t('auth.startFailed')}
              </p>
            )}
            <div aria-hidden="true" className="my-4 flex items-center gap-3 text-xs text-fg-subtle">
              <span className="h-px flex-1 bg-border" />
              {t('auth.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="ghost" size="lg" fullWidth onClick={() => void navigate('/')}>
              {t('auth.guest')}
            </Button>
            <p className="mt-3 text-sm text-fg-muted">{t('auth.guestNote')}</p>
          </Surface>
          <p className="mt-6 max-w-sm text-xs text-fg-muted">{t('auth.privacy')}</p>
        </>
      )}
    </div>
  );
}
