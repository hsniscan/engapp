import { useTranslation } from 'react-i18next';
import { Page, Surface, ThemeSwitcher } from '@/ui';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('settings.title')}>
      <Surface>
        <ThemeSwitcher />
      </Surface>
    </Page>
  );
}
