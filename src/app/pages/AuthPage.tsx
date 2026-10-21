import { useTranslation } from 'react-i18next';
import { Button, Page, Surface, TextField } from '@/ui';

export function AuthPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('auth.title')}>
      <Surface padding="lg" className="flex flex-col gap-4">
        <Button variant="secondary" size="lg" leadingIcon="google" fullWidth>
          {t('auth.google')}
        </Button>
        <TextField label={t('auth.email')} type="email" autoComplete="email" />
        <TextField label={t('auth.password')} type="password" autoComplete="current-password" />
        <Button size="lg" fullWidth>
          {t('common.continue')}
        </Button>
        <Button variant="ghost" fullWidth>
          {t('auth.guest')}
        </Button>
      </Surface>
    </Page>
  );
}
