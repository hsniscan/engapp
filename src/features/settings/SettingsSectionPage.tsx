// /settings/:section: one settings sub-page. Old slugs and anchors used as a slug
// (/settings/profile, /settings/ornekler) are sent on to where that group lives now; an
// unknown slug goes back to the index.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useParams } from 'react-router';
import { SettingsFrame } from './SettingsFrame';
import { SoloSectionContext } from './soloSection';
import { isSettingsPage, legacyTarget, PAGE_CONTENT } from './settingsPages';

/** Scroll to #anchor once the group has rendered (groups load their data first). */
function useScrollToHash(hash: string) {
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    let frame = 0;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
      if (tries++ < 60) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hash]);
}

export function SettingsSectionPage() {
  const { t } = useTranslation();
  const { section } = useParams();
  const { hash } = useLocation();
  useScrollToHash(isSettingsPage(section) ? hash : '');

  if (!isSettingsPage(section)) {
    const target = section ? legacyTarget(section) : null;
    return <Navigate to={target ?? '/settings'} replace />;
  }
  const { parts, solo } = PAGE_CONTENT[section];
  const fromProfile = section === 'ilgi-alanlari';
  return (
    <SettingsFrame
      title={t(`settings.pages.${section}.title`)}
      description={t(`settings.pages.${section}.lead`, { defaultValue: '' }) || undefined}
      back={
        fromProfile
          ? { to: '/profile', label: t('settings.index.back') }
          : { to: '/settings', label: t('settings.title') }
      }
    >
      <SoloSectionContext.Provider value={!!solo}>
        <div className="flex flex-col gap-5">
          {parts.map((Part, i) => (
            <Part key={i} />
          ))}
        </div>
      </SoloSectionContext.Provider>
      {!fromProfile && (
        <p className="mt-5 px-1.5 text-center text-[0.8125rem] text-fg-muted">
          {t('settings.index.savedNote')}
        </p>
      )}
    </SettingsFrame>
  );
}
