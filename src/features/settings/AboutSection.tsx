import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '@/ui';
import { SettingsSection } from './SettingsLayout';

/** "Hakkında": the sources (word lists, frequency data) and their licences. */
export function AboutSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection id="hakkinda" title={t('settings.sections.hakkinda')}>
      <Link
        to="/settings/kaynaklar"
        className="group flex min-h-11 items-center gap-4 rounded-card p-4 hover:bg-surface-hover focus-visible:outline-offset-[-2px] sm:px-5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-medium text-fg">{t('settings.about.sources')}</span>
          <span className="text-sm text-fg-muted">{t('settings.about.sourcesHint')}</span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle group-hover:text-fg-muted" />
      </Link>
      <Link
        to="/gizlilik"
        className="group flex min-h-11 items-center gap-4 rounded-card p-4 hover:bg-surface-hover focus-visible:outline-offset-[-2px] sm:px-5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-medium text-fg">{t('settings.about.privacy')}</span>
          <span className="text-sm text-fg-muted">{t('settings.about.privacyHint')}</span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle group-hover:text-fg-muted" />
      </Link>
    </SettingsSection>
  );
}
