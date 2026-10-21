export const SECTION_IDS = [
  'hesap',
  'senkron',
  'calisma',
  'gorunum',
  'ses',
  'veri',
  'uygulama',
  'gelismis',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
