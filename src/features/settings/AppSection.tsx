import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, toast } from '@/ui';
import { IosInstallSteps } from './IosInstallGuide';
import { isIos, useInstallState } from './platform';
import { SettingsRow, SettingsSection } from './SettingsLayout';

/** "Uygulama": install button (Android/desktop Chrome) or iPhone "Ana Ekrana Ekle" steps. */
export function AppSection() {
  const { t } = useTranslation();
  const { canInstall, installed, install } = useInstallState();
  const [busy, setBusy] = useState(false);
  const ios = isIos();
  return (
    <SettingsSection id="uygulama" title={t('settings.sections.uygulama')}>
      {installed ? (
        <SettingsRow
          label={
            <span className="flex items-center gap-2">
              {t('install.title')} <Badge tone="success">{t('install.installedBadge')}</Badge>
            </span>
          }
          description={t('install.installed')}
        />
      ) : ios ? (
        <SettingsRow stack label={t('install.ios.title')} description={t('install.ios.why')}>
          <IosInstallSteps />
        </SettingsRow>
      ) : (
        <SettingsRow
          label={t('install.title')}
          description={canInstall ? t('install.hint') : t('install.manual')}
        >
          {canInstall && (
            <Button
              variant="secondary"
              leadingIcon="plus"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const outcome = await install();
                setBusy(false);
                if (outcome === 'accepted') toast({ title: t('install.done'), tone: 'success' });
              }}
            >
              {t('install.button')}
            </Button>
          )}
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
