// The settings table owns the theme; localStorage stays as the pre-paint cache that
// index.html reads before React loads. Both are written together.
import { liveQuery } from 'dexie';
import { db, logError, updateSettings } from '@/data';
import type { ThemePref } from '@/domain/types';
import { getThemePreference, isThemePreference, setThemePreference } from '@/ui/theme';

/** Change the theme: applies at once (seam + cache) and persists to settings (synced). */
export async function setTheme(pref: ThemePref): Promise<void> {
  setThemePreference(pref);
  try {
    await updateSettings({ theme: pref });
  } catch (e) {
    void logError(e, 'theme.save');
  }
}

/**
 * Keep the document theme in step with the settings row (first load, other tabs, sync from
 * another device). On the very first run the pre-paint cache seeds the settings row.
 */
export function startThemeSync(seedFromCache: boolean): () => void {
  if (seedFromCache) {
    const cached = getThemePreference();
    if (cached !== 'system')
      void updateSettings({ theme: cached }).catch((e: unknown) => logError(e, 'theme.seed'));
  }
  const sub = liveQuery(() => db.settings.get('settings')).subscribe({
    next: (s) => {
      if (s && isThemePreference(s.theme) && s.theme !== getThemePreference())
        setThemePreference(s.theme);
    },
    error: (e: unknown) => void logError(e, 'theme.sync'),
  });
  return () => sub.unsubscribe();
}
