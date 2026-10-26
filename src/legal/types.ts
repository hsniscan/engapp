// Structure of the legal texts (privacy policy). The texts live in their own modules
// (privacy.tr.ts, privacy.en.ts) because they are long documents, not UI strings; the
// surrounding page chrome uses the i18n files (`legal.*`).
//
// Inline markup inside a string: [label](/path or https://… or mailto:…) is a link and
// {{email}} is the contact address (VITE_CONTACT_EMAIL), rendered by LegalText.

export type LegalBlock = { p: string } | { ul: string[] };

export interface LegalSection {
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  lang: 'tr' | 'en';
  title: string;
  /** ISO date of the last change (shown as "Son güncelleme"). */
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

/** Data controller: the owner, publishing Engapp as an individual developer. */
export const CONTROLLER_NAME = 'Hasan Basri İşcan';

/** Version date of the privacy policy texts; bump it with every change to them. */
export const PRIVACY_UPDATED = '2026-10-26';
