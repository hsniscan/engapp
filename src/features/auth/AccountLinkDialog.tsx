import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, cn, toast } from '@/ui';
import {
  continueAsGuest,
  dismissLinkResult,
  resolveLink,
  retryLink,
  useLinkState,
  type LinkChoice,
} from './link';

const OPTIONS: {
  value: LinkChoice;
  label: 'account.merge' | 'account.discardLocal' | 'account.discardAccount';
  hint: 'account.mergeHint' | 'account.discardLocalHint' | 'account.discardAccountHint';
}[] = [
  { value: 'merge', label: 'account.merge', hint: 'account.mergeHint' },
  { value: 'discard_local', label: 'account.discardLocal', hint: 'account.discardLocalHint' },
  { value: 'discard_account', label: 'account.discardAccount', hint: 'account.discardAccountHint' },
];

/**
 * Second-device question after sign-in (plan: birleştir [varsayılan] / yerel veriyi at /
 * hesaptakini at). Must be answered; it cannot be dismissed by clicking outside.
 */
export function AccountLinkDialog() {
  const { t } = useTranslation();
  const s = useLinkState();

  useEffect(() => {
    if (s.phase !== 'done') return;
    toast({
      title: t('account.done'),
      description:
        s.duplicates > 0 ? t('account.doneDuplicates', { count: s.duplicates }) : undefined,
      tone: 'success',
      duration: s.duplicates > 0 ? 10_000 : 5000,
    });
    dismissLinkResult();
  }, [s, t]);

  const open = s.phase === 'choose' || s.phase === 'applying' || s.phase === 'error';
  if (!open) return null;

  if (s.phase === 'error') {
    return (
      <Dialog
        open
        onOpenChange={() => {}}
        hideClose
        title={t('account.errorTitle')}
        description={t('account.errorBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => void continueAsGuest()}>
              {t('account.continueAsGuest')}
            </Button>
            <Button onClick={retryLink}>{t('common.retry')}</Button>
          </>
        }
      />
    );
  }

  return (
    <ChooseDialog key={s.userId} applying={s.phase === 'applying'} otherAccount={s.otherAccount} />
  );
}

function ChooseDialog({ applying, otherAccount }: { applying: boolean; otherAccount: boolean }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<LinkChoice>('merge');
  const destructive = choice !== 'merge';
  return (
    <Dialog
      open
      onOpenChange={() => {}}
      hideClose
      title={t('account.chooseTitle')}
      description={otherAccount ? t('account.chooseBodyOther') : t('account.chooseBody')}
      footer={
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={applying}
          onClick={() => void resolveLink(choice)}
          className="sm:min-w-32"
        >
          {applying ? t('account.applying') : t('account.apply')}
        </Button>
      }
    >
      <fieldset disabled={applying} className="flex flex-col gap-2">
        <legend className="sr-only">{t('account.options')}</legend>
        {OPTIONS.map((o) => {
          const selected = o.value === choice;
          return (
            <label
              key={o.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-control border px-4 py-3',
                'transition-[background-color,border-color] duration-(--duration-micro) ease-standard',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                selected
                  ? 'border-accent bg-accent-soft/60'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name="link-choice"
                value={o.value}
                checked={selected}
                onChange={() => setChoice(o.value)}
                className="mt-1 size-4 shrink-0 accent-(--accent)"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-fg">{t(o.label)}</span>
                <span className="text-sm text-fg-muted">{t(o.hint)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {destructive && (
        <p role="alert" className="mt-4 text-sm text-danger-text">
          {t('account.irreversible')}
        </p>
      )}
    </Dialog>
  );
}
