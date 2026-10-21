// Home screen: the one-time level-test offer and the "Seviyen B1 → B2 oldu. Neden?" note.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, dismissLevelChange, logError, setMeta, undoLevelChange } from '@/data';
import type { LevelChangeNote } from '@/domain/types';
import { Button, buttonClasses, cn, Dialog, IconButton, toast } from '@/ui';
import { OFFER_DISMISSED_KEY, pct, useOfferVisible } from './levelText';

/**
 * Offered until the user takes a test, chooses a level by hand or says no. Tests and the level
 * sync, so a test on another device hides the offer here too.
 */
export function LevelTestOffer({ className }: { className?: string }) {
  const { t } = useTranslation();
  const show = useOfferVisible();
  if (!show) return null;
  const dismiss = () => {
    setMeta(OFFER_DISMISSED_KEY, true)
      .then(() => toast({ title: t('level.offerDismissed') }))
      .catch((e: unknown) => void logError(e, 'level.offer'));
  };
  return (
    <section
      aria-labelledby="level-offer-title"
      className={cn(
        'flex flex-col gap-4 rounded-card border border-accent/30 bg-accent-soft p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6',
        className,
      )}
      data-testid="level-offer"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="level-offer-title" className="font-serif text-xl font-semibold text-fg">
          {t('level.offerTitle')}
        </h2>
        <p className="text-[0.9375rem] text-fg-muted">{t('level.offerBody')}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:w-44">
        <Link to="/level-test" className={buttonClasses({ fullWidth: true })}>
          {t('level.offerStart')}
        </Link>
        <Button variant="ghost" fullWidth onClick={dismiss}>
          {t('level.offerDismiss')}
        </Button>
      </div>
    </section>
  );
}

export function LevelChangeDialog({
  change,
  level,
  open,
  onOpenChange,
}: {
  change: LevelChangeNote;
  level: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const up = change.to > change.from;
  const canUndo = level === change.to;
  const close = () => {
    onOpenChange(false);
    void dismissLevelChange().catch((e: unknown) => void logError(e, 'level.dismiss'));
  };
  const undo = () => {
    onOpenChange(false);
    undoLevelChange()
      .then(() => toast({ title: t('level.changeUndone', { level: change.from }) }))
      .catch((e: unknown) => void logError(e, 'level.undo'));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('level.changeTitle', { from: change.from, to: change.to })}
      footer={
        <>
          {canUndo && (
            <Button variant="secondary" onClick={undo}>
              {t('level.changeUndo', { from: change.from })}
            </Button>
          )}
          <Button onClick={close}>{t('level.changeOk')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[0.9375rem] text-fg">
        <p>
          {t(up ? 'level.changeUp' : 'level.changeDown', {
            band: change.band,
            pct: pct(change.ratio),
            prev: pct(change.ratio_prev),
          })}
        </p>
        <p className="text-fg-muted">
          {t('level.changeEvidence', {
            band: change.band,
            known: change.known,
            unknown: change.unknown,
          })}
        </p>
        <p className="text-sm text-fg-muted">{t('level.changeRule')}</p>
      </div>
    </Dialog>
  );
}

/** One line under the page title while the latest automatic change is not dismissed. */
export function LevelChangeLine({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useLiveQuery(() => db.settings.get('settings'), []);
  const [open, setOpen] = useState(false);
  const change = settings?.level_change;
  if (!settings || !change || change.dismissed) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-12 items-center gap-2 rounded-card border border-border bg-surface py-1 pr-1 pl-4',
        className,
      )}
      data-testid="level-change"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
      <p className="min-w-0 flex-1 text-[0.9375rem] text-fg">
        {t('level.change', { from: change.from, to: change.to })}{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-accent-text underline underline-offset-4 hover:no-underline"
        >
          {t('level.changeWhy')}
        </button>
      </p>
      <IconButton
        icon="x"
        label={t('common.close')}
        tooltip={false}
        onClick={() =>
          void dismissLevelChange().catch((e: unknown) => void logError(e, 'level.dismiss'))
        }
      />
      <LevelChangeDialog
        change={change}
        level={settings.level}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
