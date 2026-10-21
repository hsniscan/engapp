import { themeColor } from '../tokens';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'engapp.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Reads the stored preference. Later this seam moves to the settings table. */
export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/**
 * Applies a preference to the document: `data-theme` on <html> (CSS tokens follow it
 * through `color-scheme` + light-dark()) and the PWA/browser `theme-color` meta tags.
 */
export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const root = document.documentElement;
  root.dataset.theme = pref;
  const resolved = resolveTheme(pref);
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    if (pref === 'system') {
      const isDarkMeta = meta.media.includes('dark');
      meta.content = isDarkMeta ? themeColor.dark : themeColor.light;
    } else {
      meta.content = themeColor[resolved];
    }
  });
  return resolved;
}

/** Persists and applies. The single write path for the theme preference. */
export function setThemePreference(pref: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this session.
  }
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_EVENT, { detail: pref }));
  return applyTheme(pref);
}

export const THEME_EVENT = 'engapp:themechange';

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * Call once at startup: applies the stored preference and keeps the document in sync with
 * OS changes (system mode) and changes made in other tabs.
 */
export function initTheme(): () => void {
  applyTheme(getThemePreference());
  const reapply = () => applyTheme(getThemePreference());
  const unwatch = watchSystemTheme(reapply);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) reapply();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    unwatch();
    window.removeEventListener('storage', onStorage);
  };
}
