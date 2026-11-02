import { useTranslation } from 'react-i18next';
import { ListRow } from '@/ui';
import { SettingsSection } from './SettingsLayout';

/** "Hakkında": the sources (word lists, frequency data) and their licences, and the privacy policy. */
export function AboutSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection id="hakkinda" title={t('settings.sections.hakkinda')}>
      <ListRow
        to="/settings/kaynaklar"
        leadingIcon="book"
        title={t('settings.about.sources')}
        description={t('settings.about.sourcesHint')}
      />
      <ListRow
        to="/gizlilik"
        leadingIcon="eye"
        title={t('settings.about.privacy')}
        description={t('settings.about.privacyHint')}
      />
    </SettingsSection>
  );
}
