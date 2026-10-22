// The chosen mnemonic on a card (v0.3 İP2): a small line on the back, and a hint for the
// front that stays hidden until tapped (the mnemonic gives the meaning away).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Id } from '@/domain/types';
import { cn } from '@/ui';
import { useMnemonic } from './hooks';

/** Back of the card: "Anımsatıcı: …" in small type, nothing when the sense has none. */
export function CardMnemonic({ senseId, className }: { senseId: Id | null | undefined; className?: string }) {
  const { t } = useTranslation();
  const text = useMnemonic(senseId);
  if (!text) return null;
  return (
    <p
      data-testid="card-mnemonic"
      lang="tr"
      className={cn('w-full max-w-md text-[0.875rem] leading-snug text-fg-muted', className)}
    >
      <span className="font-medium text-fg">{t('mnemonic.cardLabel')}:</span> {text}
    </p>
  );
}

/**
 * Front of the card (for a later package, e.g. leech help): a "Anımsatıcıyı göster" button
 * that shows the mnemonic in place. Clicks do not reach the card (no flip).
 */
export function MnemonicHint({ senseId, className }: { senseId: Id | null | undefined; className?: string }) {
  const { t } = useTranslation();
  const text = useMnemonic(senseId);
  const [shown, setShown] = useState(false);
  if (!text) return null;
  return (
    <div className={cn('w-full max-w-md text-center', className)} onClick={(e) => e.stopPropagation()}>
      {shown ? (
        <p lang="tr" role="status" className="text-[0.9375rem] leading-snug text-fg-muted">
          <span className="font-medium text-fg">{t('mnemonic.cardLabel')}:</span> {text}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setShown(true)}
          className="inline-flex min-h-11 items-center rounded-control px-3 text-[0.9375rem] font-medium text-accent-text underline-offset-2 hover:underline"
        >
          {t('mnemonic.showHint')}
        </button>
      )}
    </div>
  );
}
