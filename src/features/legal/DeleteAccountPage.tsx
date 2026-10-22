import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { logError } from '@/data';
import { Avatar } from '@/features/auth/Avatar';
import { startAuth, useAuth } from '@/features/auth/session';
import { DeleteDialog } from '@/features/account/DeleteDialog';
import { contactEmail } from '@/legal/contact';
import { signInWithGoogle } from '@/lib/supabase';
import { Button, Icon, Spinner, Surface } from '@/ui';
import { LegalText } from './LegalText';
import { PublicLayout } from './PublicLayout';

/**
 * /hesap-sil — web account deletion (Google Play requirement), reachable without the app:
 * sign in with Google, then the same deletion as Ayarlar → Hesap. Also the page every
 * deletion ends on (`?durum=silindi` after an account, `?durum=cihaz` after a device wipe).
 * Only the auth session is started here, not sync: nothing is downloaded to this browser.
 */
export function DeleteAccountPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const done = params.get('durum');
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const email = contactEmail();
  const missing = t('legal.contactMissing');

  useEffect(() => {
    startAuth();
    const prev = document.title;
    document.title = `${t('legal.deletePage.title')} · Engapp`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  const signIn = async () => {
    setSignInFailed(false);
    setRedirecting(true);
    try {
      await signInWithGoogle(`${window.location.origin}/hesap-sil`);
    } catch (e) {
      void logError(e, 'hesapSil.signIn');
      setRedirecting(false);
      setSignInFailed(true);
    }
  };

  if (done === 'silindi' || done === 'cihaz') {
    const account = done === 'silindi';
    return (
      <PublicLayout t={t} lang="tr">
        <div role="status" className="flex flex-col items-start gap-4">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-text">
            <Icon name="check" size={26} />
          </span>
          <h1 className="font-serif text-3xl leading-tight font-semibold text-fg md:text-4xl">
            {account ? t('legal.deletePage.doneTitle') : t('legal.deletePage.deviceDoneTitle')}
          </h1>
          <p className="max-w-prose text-[1.0625rem] text-fg">
            {account ? t('legal.deletePage.doneBody') : t('legal.deletePage.deviceDoneBody')}
          </p>
          <a href="/" className="mt-2 font-medium text-accent-text underline underline-offset-2">
            {t('legal.toApp')}
          </a>
        </div>
      </PublicLayout>
    );
  }

  const u = auth.user;
  return (
    <PublicLayout t={t} lang="tr">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="font-serif text-3xl leading-tight font-semibold tracking-[-0.01em] text-fg md:text-4xl">
            {t('legal.deletePage.title')}
          </h1>
          <p className="text-[1.0625rem] text-fg">{t('legal.deletePage.lead')}</p>
          <p className="text-fg-muted">{t('legal.deletePage.inApp')}</p>
        </header>

        <Surface padding="lg" className="flex flex-col gap-4 border border-border">
          {auth.status === 'unavailable' ? (
            <p className="text-fg">
              <LegalText
                text={t('legal.deletePage.unavailable', { email: '{{email}}' })}
                email={email}
                missingEmail={missing}
              />
            </p>
          ) : auth.status === 'loading' ? (
            <div className="flex items-center gap-3 text-fg-muted" role="status">
              <Spinner size={20} />
              <span>{t('auth.finishing')}</span>
            </div>
          ) : auth.status === 'signed_in' && u ? (
            <>
              <p className="text-sm text-fg-muted">{t('legal.deletePage.signedInAs')}</p>
              <div className="flex items-center gap-3">
                <Avatar src={u.avatarUrl} name={u.name ?? u.email ?? ''} />
                <div className="flex min-w-0 flex-col">
                  <p className="truncate font-medium text-fg">{u.name ?? u.email}</p>
                  {u.email && u.name && <p className="truncate text-sm text-fg-muted">{u.email}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="danger" leadingIcon="trash" onClick={() => setOpen(true)}>
                  {t('legal.deletePage.deleteButton')}
                </Button>
                <Button variant="ghost" onClick={() => void auth.signOut().catch(() => undefined)}>
                  {t('legal.deletePage.notYou')}
                </Button>
              </div>
              <DeleteDialog
                open={open}
                onOpenChange={setOpen}
                mode="account"
                wipe="if-linked"
                showBackup={false}
              />
            </>
          ) : (
            <>
              <p className="text-fg">{t('legal.deletePage.signInLead')}</p>
              <Button
                variant="secondary"
                size="lg"
                leadingIcon="google"
                loading={redirecting}
                onClick={() => void signIn()}
                className="self-start"
              >
                {redirecting ? t('auth.redirecting') : t('auth.google')}
              </Button>
              {signInFailed && (
                <p role="alert" className="text-sm text-danger-text">
                  {t('auth.startFailed')}
                </p>
              )}
            </>
          )}
          {auth.status !== 'unavailable' && (
            <p className="text-sm text-fg-muted">
              <LegalText
                text={t('legal.deletePage.emailAlt', { email: '{{email}}' })}
                email={email}
                missingEmail={missing}
              />
            </p>
          )}
        </Surface>

        <section className="flex flex-col gap-2">
          <h2 className="font-serif text-xl font-semibold text-fg">{t('legal.deletePage.whatTitle')}</h2>
          <p className="text-fg">{t('legal.deletePage.what')}</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-serif text-xl font-semibold text-fg">{t('legal.deletePage.keptTitle')}</h2>
          <p className="text-fg">{t('legal.deletePage.kept')}</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-serif text-xl font-semibold text-fg">{t('legal.deletePage.guestTitle')}</h2>
          <p className="text-fg">{t('legal.deletePage.guest')}</p>
        </section>
      </div>
    </PublicLayout>
  );
}
