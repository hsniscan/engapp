export const SECTION_IDS = [
  'hesap',
  'senkron',
  'calisma',
  'yuk',
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
