export const SECTION_IDS = [
  'hesap',
  'senkron',
  'calisma',
  'seviye',
  'ornekler',
  'profil',
  'gorunum',
  'ses',
  'veri',
  'uygulama',
  'gelismis',
  'hakkinda',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
