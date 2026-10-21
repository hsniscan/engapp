import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/session';
import { logError } from '@/data';
import { Button, EmptyState, Skeleton, toast } from '@/ui';

/** AI import needs a Google account (decision 0002). Guests get a calm invitation instead. */
export function ImportGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  if (auth.status === 'unavailable') {
    return (
      <EmptyState
        icon="info"
        title={t('importer.unavailableTitle')}
        description={t('importer.unavailableBody')}
      />
    );
  }
  if (auth.status === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-3 py-2">
        <Skeleton className="h-11" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (auth.status !== 'signed_in') {
    const signIn = async () => {
      setBusy(true);
      try {
        await auth.signIn();
      } catch (e) {
        void logError(e, 'import.signIn');
        toast({ title: t('auth.startFailed'), tone: 'danger' });
        setBusy(false);
      }
    };
    return (
      <EmptyState
        icon="user"
        title={t('importer.signInTitle')}
        description={t('importer.signInBody')}
        action={
          <Button
            variant="secondary"
            size="lg"
            leadingIcon="google"
            loading={busy}
            onClick={() => void signIn()}
          >
            {t('importer.signInCta')}
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
