// PLACEHOLDER (agent B, redesign router): one settings sub-page at /settings/:section.
// The settings owner replaces this file (board SettingsStudy); until then the old long page
// shows, scrolled to the section.
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { SettingsPage } from './SettingsPage';

export function SettingsSectionPage() {
  const { section } = useParams();
  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView();
  }, [section]);
  return <SettingsPage />;
}
