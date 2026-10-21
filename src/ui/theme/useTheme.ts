import { useCallback, useSyncExternalStore } from 'react';
import {
  THEME_EVENT,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

function subscribe(onChange: () => void): () => void {
  const unwatch = watchSystemTheme(onChange);
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    unwatch();
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot(): string {
  const pref = getThemePreference();
  return `${pref}:${resolveTheme(pref)}`;
}

export interface UseTheme {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

/** Current theme preference and the theme actually shown. */
export function useTheme(): UseTheme {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => 'system:light');
  const [preference, resolved] = snapshot.split(':') as [ThemePreference, ResolvedTheme];
  const setPreference = useCallback((pref: ThemePreference) => {
    setThemePreference(pref);
  }, []);
  return { preference, resolved, setPreference };
}
