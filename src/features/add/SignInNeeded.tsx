// A guest at a step that needs the server (an article, word extraction, a generated text): one
// line that says exactly what needs the account, why, and the Google button. Reading and adding
// words by hand never send a guest here.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import { useAuth } from '@/features/auth/session';
import { Button, Card } from '@/ui';

export function SignInNeeded({
  title,
  body,
  children,
  testId,
}: {
  title: string;
  body?: string;
  /** More ways on, under the button (e.g. "Metni kopyala-yapıştır"). */
  children?: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      await auth.signIn();
    } catch (e) {
      void logError(e, 'signInNeeded');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card tone="sunken" inset className="flex flex-col items-start gap-3" data-testid={testId}>
      <p className="text-ui font-semibold text-fg" data-testid="signin-needed-title">
        {title}
      </p>
      {body && <p className="text-meta text-fg-muted">{body}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          leadingIcon="google"
          loading={busy}
          onClick={() => void signIn()}
        >
          {t('capture.signInCta')}
        </Button>
        {children}
      </div>
    </Card>
  );
}
