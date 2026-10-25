// Home screen: the automatic suggestion (first at 1 000 reviews, then monthly) to tune the
// algorithm. "Sonra" hides it for a month on this device. The run itself is in Settings.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getMeta, logError, setMeta } from '@/data';
import { REOPTIMIZE_AFTER_MS } from '@/domain/fsrsOptimizer';
import { useNow } from '@/features/settings/useNow';
import { Button, buttonClasses, cn, toast } from '@/ui';
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
    <section
      aria-labelledby="fsrs-offer-title"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-accent/30 bg-accent-soft p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6',
        className,
      )}
      data-testid="fsrs-offer"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="fsrs-offer-title" className="font-serif text-xl font-semibold text-fg">
          {t('fsrsOpt.offer.title')}
        </h2>
        <p className="text-[0.9375rem] text-fg-muted">
          {first
            ? t('fsrsOpt.offer.body', { count: nf.format(status.counts.total) })
            : t('fsrsOpt.offer.bodyAgain', { count: nf.format(status.counts.sinceLastRun) })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:w-44">
        <Link to="/settings/calisma" className={buttonClasses({ fullWidth: true })}>
          {t('fsrsOpt.offer.go')}
        </Link>
        <Button variant="ghost" fullWidth onClick={later}>
          {t('fsrsOpt.offer.later')}
        </Button>
      </div>
    </section>
  );
}
