import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { useTheme } from './theme/useTheme';
import type { ThemePreference } from './theme/theme';

/** Sistem / Açık / Koyu. Drop into the settings page. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl<ThemePreference>
      legend={t('theme.label')}
      className={className}
      value={preference}
      onValueChange={setPreference}
      options={[
        { value: 'system', label: t('theme.system'), icon: 'monitor' },
        { value: 'light', label: t('theme.light'), icon: 'sun' },
        { value: 'dark', label: t('theme.dark'), icon: 'moon' },
      ]}
    />
  );
}
