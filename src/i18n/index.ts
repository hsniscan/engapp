import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import tr from './tr.json';

export const defaultNS = 'translation';
/**
 * Turkish is bundled; English (only the /privacy page today) is loaded on demand with
 * loadLanguage, which keeps ~150 KB of strings out of the start-up bundle (decision 0053).
 */
export const resources = {
  tr: { translation: tr },
} as const;

export const supportedLanguages = ['tr', 'en'] as const;
export type AppLanguage = (typeof supportedLanguages)[number];

/** Makes a language's strings available (t, getFixedT); does not switch the UI language. */
export async function loadLanguage(lng: AppLanguage): Promise<void> {
  if (i18n.hasResourceBundle(lng, defaultNS)) return;
  const strings = lng === 'en' ? (await import('./en.json')).default : tr;
  i18n.addResourceBundle(lng, defaultNS, strings, true, true);
}

/** Turkish is the UI language. English exists for a future public release. */
void i18n.use(initReactI18next).init({
  resources,
  lng: 'tr',
  fallbackLng: 'tr',
  partialBundledLanguages: true,
  defaultNS,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

function syncDocumentLang(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
syncDocumentLang(i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
