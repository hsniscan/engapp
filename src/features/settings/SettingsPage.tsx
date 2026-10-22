import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, cn } from '@/ui';
import { AboutSection } from './AboutSection';
import { ProfileSettingsSection } from '@/features/profile/ProfileSettingsSection';
import { AdvancedSection } from './AdvancedSection';
import { AppSection } from './AppSection';
import { DataSection } from './DataSection';
import { ExamplesSettingsSection } from './ExamplesSettings';
import { SECTION_IDS, type SectionId } from './sections';
import { SettingsSection } from './SettingsLayout';
import { settingsSlots } from './slots';
import { AppearanceSection, StudySection, VoiceSection } from './StudySections';
import { LevelSettingsSection } from '@/features/leveltest/LevelSettingsSection';
import { NotifySection } from '@/features/notify/NotifySection';

function SectionNav() {
  const { t } = useTranslation();
  const [active, setActive] = useState<SectionId>('hesap');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id as SectionId);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return (
    <nav
      aria-label={t('settings.sectionsNav')}
      className="sticky top-20 hidden self-start lg:block"
    >
      <ul className="flex flex-col gap-0.5 border-l border-border">
        {SECTION_IDS.map((id) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? 'location' : undefined}
              className={cn(
                '-ml-px flex min-h-9 items-center border-l-2 pl-4 text-sm transition-colors duration-(--duration-micro)',
                active === id
                  ? 'border-accent font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t(`settings.sections.${id}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const Account = settingsSlots.account;
  const Sync = settingsSlots.sync;
  return (
    <Page title={t('settings.title')} width="wide">
      <div className="mx-auto grid max-w-2xl gap-10 lg:max-w-none lg:grid-cols-[11rem_minmax(0,42rem)] lg:justify-center lg:gap-12">
        <SectionNav />
        <div className="flex min-w-0 flex-col gap-10">
          <SettingsSection id="hesap" title={t('settings.sections.hesap')}>
            <Account />
          </SettingsSection>
          <SettingsSection id="senkron" title={t('settings.sections.senkron')}>
            <Sync />
          </SettingsSection>
          <StudySection />
          <NotifySection />
          <LevelSettingsSection />
          <ExamplesSettingsSection />
          <ProfileSettingsSection />
          <AppearanceSection />
          <VoiceSection />
          <DataSection />
          <AppSection />
          <AdvancedSection />
          <AboutSection />
        </div>
      </div>
    </Page>
  );
}
