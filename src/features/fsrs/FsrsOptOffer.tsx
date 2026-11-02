// Home screen: the automatic suggestion (first at 1 000 reviews, then monthly) to tune the
// algorithm. "Sonra" hides it for a month on this device. The run itself is in Settings.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getMeta, logError, setMeta } from '@/data';
import { REOPTIMIZE_AFTER_MS } from '@/domain/fsrsOptimizer';
import { useNow } from '@/features/settings/useNow';
import { HomeNote } from '@/features/home/HomeNote';
import { Button, buttonClasses, toast } from '@/ui';
import { useOptimizerStatus } from './useOptimizerStatus';

export const FSRS_OFFER_DISMISSED_KEY = 'fsrs_offer_dismissed_at';
const nf = new Intl.NumberFormat('tr-TR');

export function FsrsOptOffer({ className }: { className?: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const status = useOptimizerStatus();
  const dismissedAt = useLiveQuery(
    async () => (await getMeta<number>(FSRS_OFFER_DISMISSED_KEY)) ?? null,
    [],
  );
  if (!status?.suggested || dismissedAt === undefined) return null;
  if (dismissedAt !== null && now - dismissedAt < REOPTIMIZE_AFTER_MS) return null;
  const first = status.settings.fsrs_opt_at == null;
  const later = () => {
    setMeta(FSRS_OFFER_DISMISSED_KEY, Date.now())
      .then(() => toast({ title: t('fsrsOpt.offer.dismissed') }))
      .catch((e: unknown) => void logError(e, 'fsrs.offer'));
  };
  return (
    <HomeNote
      titleId="fsrs-offer-title"
      icon="settings"
      title={t('fsrsOpt.offer.title')}
      className={className}
      data-testid="fsrs-offer"
      actions={
        <>
          <Button variant="ghost" onClick={later}>
            {t('fsrsOpt.offer.later')}
          </Button>
          <Link to="/settings/calisma" className={buttonClasses({ variant: 'tonal' })}>
            {t('fsrsOpt.offer.go')}
          </Link>
        </>
      }
    >
      <p>
        {first
          ? t('fsrsOpt.offer.body', { count: nf.format(status.counts.total) })
          : t('fsrsOpt.offer.bodyAgain', { count: nf.format(status.counts.sinceLastRun) })}
      </p>
    </HomeNote>
  );
}
