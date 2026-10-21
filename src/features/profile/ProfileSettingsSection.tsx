import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { buttonClasses, Icon, Skeleton } from '@/ui';
import { useTopicProfile } from './useTopicProfile';

const SHOWN = 3;

/** Ayarlar → Profil: a one-line summary and the way to the profile screen. */
export function ProfileSettingsSection() {
  const { t } = useTranslation();
  const profile = useTopicProfile();
  let summary = t('profile.settingsNone');
  if (profile && profile.ranked.length > 0) {
    const names = profile.ranked.slice(0, SHOWN).map((k) => t(`topics.${k}`));
    const rest = profile.ranked.length - SHOWN;
    summary =
      rest > 0
        ? t('profile.settingsMore', { list: names.join(', '), count: rest })
        : names.join(', ');
  }
  return (
    <SettingsSection id="profil" title={t('settings.sections.profil')}>
      <SettingsRow
        label={t('profile.settingsLabel')}
        description={profile ? summary : <Skeleton className="h-4 w-40" />}
      >
        <Link to="/settings/profile" className={buttonClasses({ variant: 'secondary' })}>
          {t('profile.settingsOpen')}
          <Icon name="chevron-right" size={18} />
        </Link>
      </SettingsRow>
    </SettingsSection>
  );
}
