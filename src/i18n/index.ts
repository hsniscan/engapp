import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import tr from './tr.json';
import en from './en.json';

export const defaultNS = 'translation';
export const resources = {
  tr: { translation: tr },
  en: { translation: en },
} as const;

export type AppLanguage = keyof typeof resources;
export const supportedLanguages = Object.keys(resources) as AppLanguage[];

/** Turkish is the UI language. English exists for a future public release. */
void i18n.use(initReactI18next).init({
  resources,
  lng: 'tr',
  fallbackLng: 'tr',
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
