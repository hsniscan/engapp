import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogClose, Icon, type IconName } from '@/ui';
import { flags, isIosSafari, isStandalone } from './platform';

const SEEN_KEY = 'iosInstallGuide.seen';

/** The three Safari steps. Also used inline in Settings → Uygulama. */
export function IosInstallSteps() {
  const { t } = useTranslation();
  const steps: { icon: IconName; text: string }[] = [
    { icon: 'upload', text: t('install.ios.step1') },
    { icon: 'plus', text: t('install.ios.step2') },
    { icon: 'check', text: t('install.ios.step3') },
  ];
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={s.icon} className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface text-fg">
            <Icon name={s.icon} size={18} />
          </span>
          <span className="pt-1.5 text-[0.9375rem] text-fg">
            <span className="tabular mr-1 font-medium text-fg-muted">{i + 1}.</span>
            {s.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * First open on iPhone Safari (not installed): explain "Ana Ekrana Ekle". Safari may delete
 * data of sites that are not on the home screen after a few weeks without use.
 */
export function IosInstallGuide({ force = false }: { force?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (force || (isIosSafari() && !isStandalone() && !flags.get(SEEN_KEY))) {
      const id = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(id);
    }
  }, [force]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) flags.set(SEEN_KEY, '1');
      }}
      variant="sheet"
      title={t('install.ios.title')}
      description={t('install.ios.why')}
      footer={
        <DialogClose asChild>
          <Button>{t('install.ios.ok')}</Button>
        </DialogClose>
      }
    >
      <IosInstallSteps />
    </Dialog>
  );
}
