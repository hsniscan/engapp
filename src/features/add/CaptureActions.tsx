// The one result of every capture (v0.5.1, decision 0056): "Okuyucuda aç" first (no account,
// works offline), then "Bu metindeki kelimeleri çıkar" (yapay zekâ: signed in only). Both save
// the text first, so the words never lose the text they came from.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError } from '@/data';
import { readerPath } from '@/domain/texts';
import { useAuth } from '@/features/auth/session';
import { Button, Card, cn, Icon } from '@/ui';
import { closeAddSheet } from './addSheetStore';
import { extractCapture, saveCapture, type CaptureInput } from './capture';
import { ChoiceButton } from './ui';

export interface CaptureActionsProps {
  /** The capture, read when a button is pressed; null when there is nothing to save yet. */
  input: () => CaptureInput | null;
  disabled?: boolean;
  /** Test ids of the two buttons (each flow keeps its own). */
  readerTestId?: string;
  extractTestId?: string;
  className?: string;
}

export function CaptureActions({
  input,
  disabled,
  readerTestId = 'open-in-reader',
  extractTestId = 'capture-extract',
  className,
}: CaptureActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [busy, setBusy] = useState<'reader' | 'extract' | null>(null);
  const [failed, setFailed] = useState<'reader' | 'extract' | null>(null);
  // The reader's code is fetched while the user looks at the choices, so it opens at once
  // (and offline).
  useEffect(() => {
    void import('@/features/reader/ReaderPage').catch(() => {});
  }, []);

  const run = async (which: 'reader' | 'extract') => {
    const v = input();
    if (!v) return;
    setBusy(which);
    setFailed(null);
    try {
      const fallback = t('reader.open.defaultTitle');
      const to =
        which === 'reader'
          ? readerPath(await saveCapture(v, fallback))
          : `/import/${await extractCapture(v, fallback)}`;
      closeAddSheet();
      void navigate(to);
    } catch (e) {
      void logError(e, `capture.${which}`);
      setFailed(which);
      setBusy(null);
    }
  };

  const off = disabled || busy !== null;
  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="capture-actions">
      <ChoiceButton
        primary
        icon="file"
        title={t('capture.openReader')}
        hint={t('capture.openReaderHint')}
        loading={busy === 'reader'}
        disabled={off}
        onClick={() => void run('reader')}
        testId={readerTestId}
      />
      {auth.status === 'signed_in' ? (
        <>
          <ChoiceButton
            icon="search"
            title={t('capture.extract')}
            hint={t('capture.extractHint')}
            loading={busy === 'extract'}
            disabled={off}
            onClick={() => void run('extract')}
            testId={extractTestId}
          />
          <p className="flex items-start gap-1.5 px-1 text-meta text-fg-muted">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong className="font-medium text-fg">{t('importer.privacy')}</strong>{' '}
              {t('importer.privacyWhy')}
            </span>
          </p>
        </>
      ) : auth.status === 'guest' ? (
        <ExtractSignIn />
      ) : auth.status === 'unavailable' ? (
        <p className="px-1 text-meta text-fg-muted">{t('capture.extractUnavailable')}</p>
      ) : null}
      {failed && (
        <p role="alert" className="px-1 text-meta text-danger-text">
          {failed === 'reader' ? t('article.saveFailed') : t('article.extractFailed')}
        </p>
      )}
    </div>
  );
}

/** Guests: extraction is the only part that needs an account, and the line says so. */
export function ExtractSignIn() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    try {
      await auth.signIn();
    } catch (e) {
      void logError(e, 'capture.signIn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      tone="placeholder"
      inset
      className="flex flex-col gap-3"
      data-testid="capture-extract-signin"
    >
      <p className="text-meta text-fg-muted">{t('capture.extractSignIn')}</p>
      <Button
        variant="secondary"
        leadingIcon="google"
        loading={busy}
        onClick={() => void signIn()}
        className="self-start"
      >
        {t('capture.signInCta')}
      </Button>
    </Card>
  );
}
