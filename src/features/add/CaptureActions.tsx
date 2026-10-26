// The one result of every capture (v0.5.1, decision 0056): "Okuyucuda aç" first (no account,
// works offline), then "Bu metindeki kelimeleri çıkar" (yapay zekâ: signed in only). Both save
// the text first, so the words never lose the text they came from.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { logError } from '@/data';
import { readerPath } from '@/domain/texts';
import { useAuth } from '@/features/auth/session';
import { Button, cn, Icon, Spinner, type IconName } from '@/ui';
import { closeAddSheet } from './addSheetStore';
import { extractCapture, saveCapture, type CaptureInput } from './capture';

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
    <div className={cn('flex flex-col gap-2.5', className)} data-testid="capture-actions">
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
          <p className="flex items-start gap-1.5 px-1 text-sm text-fg-muted">
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
        <p className="px-1 text-sm text-fg-muted">{t('capture.extractUnavailable')}</p>
      ) : null}
      {failed && (
        <p role="alert" className="px-1 text-sm text-danger-text">
          {failed === 'reader' ? t('article.saveFailed') : t('article.extractFailed')}
        </p>
      )}
    </div>
  );
}

/** Guests: extraction is the only part that needs an account, and the line says so. */
function ExtractSignIn() {
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
    <div
      className="flex flex-col gap-3 rounded-[16px] border border-dashed border-border px-4 py-3"
      data-testid="capture-extract-signin"
    >
      <p className="text-sm text-fg-muted">{t('capture.extractSignIn')}</p>
      <Button
        variant="secondary"
        leadingIcon="google"
        loading={busy}
        onClick={() => void signIn()}
        className="self-start"
      >
        {t('capture.signInCta')}
      </Button>
    </div>
  );
}

/** A large choice: icon, title and one line of hint (the quick sheet's style). */
export function ChoiceButton({
  primary,
  icon,
  title,
  hint,
  loading,
  disabled,
  onClick,
  testId,
}: {
  primary?: boolean;
  icon: IconName;
  title: string;
  hint?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-testid={testId}
      className={cn(
        'flex min-h-16 w-full items-center gap-3.5 rounded-[16px] px-4 py-3 text-left',
        'transition-colors duration-(--duration-micro) disabled:opacity-60',
        primary
          ? 'bg-accent text-accent-fg hover:bg-accent-hover'
          : 'border border-border bg-surface text-fg hover:border-border-strong',
      )}
    >
      {loading ? (
        <Spinner size={20} className="shrink-0" />
      ) : (
        <Icon name={icon} size={22} strokeWidth={1.8} className="shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">{title}</span>
        {hint && (
          <span className={cn('text-sm', primary ? 'text-accent-fg' : 'text-fg-muted')}>
            {hint}
          </span>
        )}
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 opacity-70" />
    </button>
  );
}
