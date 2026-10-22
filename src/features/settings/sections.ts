export const SECTION_IDS = [
  'hesap',
  'senkron',
  'calisma',
  'bildirim',
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
