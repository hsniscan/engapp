// The settings sub-pages (Profil → Ayarlar → /settings/:section). Every group
// of the old single long page lives on exactly one sub-page; nothing was dropped. The old
// anchors (/settings#veri) and slugs (/settings/profile) resolve through LEGACY below.
import type { ComponentType } from 'react';
import { LevelSettingsSection } from '@/features/leveltest/LevelSettingsSection';
import { LoadSettingsSection } from '@/features/load/LoadSettingsSection';
import { NotifySection } from '@/features/notify/NotifySection';
import { InterestsBody } from '@/features/profile/InterestsPage';
import { ReadingSettingsSection } from '@/features/reader/ReadingSettings';
import { AboutSection } from './AboutSection';
import { AdvancedSection } from './AdvancedSection';
import { AppSection } from './AppSection';
import { DataSection, ImportSection } from './DataSection';
import { ExamplesSettingsSection } from './ExamplesSettings';
import type { IconName } from '@/ui';
import { AccountGroup, SyncGroup } from './AccountGroups';
import { AppearanceSection, StudySection, VoiceSection } from './StudySections';

export const SETTINGS_PAGES = [
  'calisma',
  'yuk',
  'bildirim',
  'seviye',
  'kartlar',
  'gorunum',
  'hesap',
  'veri',
  'hakkinda',
  'gelismis',
  'ilgi-alanlari',
] as const;
export type SettingsPageId = (typeof SETTINGS_PAGES)[number];

export const isSettingsPage = (s: string | undefined): s is SettingsPageId =>
  !!s && (SETTINGS_PAGES as readonly string[]).includes(s);

/** Index groups, in board order (design 4.16): every group has a caps label. */
export const SETTINGS_GROUPS: {
  key: 'learning' | 'cards' | 'account' | 'app';
  pages: SettingsPageId[];
}[] = [
  { key: 'learning', pages: ['calisma', 'yuk', 'bildirim', 'seviye'] },
  { key: 'cards', pages: ['kartlar', 'gorunum'] },
  { key: 'account', pages: ['hesap', 'veri'] },
  { key: 'app', pages: ['hakkinda', 'gelismis'] },
];

/** The row icon of each page: one icon set (src/ui), all on a neutral tile. */
export const PAGE_ICON: Record<SettingsPageId, IconName> = {
  calisma: 'loop',
  yuk: 'clock',
  bildirim: 'bell',
  seviye: 'chart',
  kartlar: 'layers',
  gorunum: 'sun',
  hesap: 'user',
  veri: 'database',
  hakkinda: 'info',
  gelismis: 'code',
  'ilgi-alanlari': 'heart',
};

/**
 * What each sub-page shows. `solo`: one group, so its heading would only repeat the page title.
 */
export const PAGE_CONTENT: Record<
  SettingsPageId,
  { parts: ComponentType[]; solo?: boolean; noSavedNote?: boolean }
> = {
  calisma: { parts: [StudySection, ReadingSettingsSection] },
  yuk: { parts: [LoadSettingsSection], solo: true },
  bildirim: { parts: [NotifySection], solo: true },
  seviye: { parts: [LevelSettingsSection], solo: true },
  // Interests live on one page (/settings/ilgi-alanlari, reached from Profil); no "Profil"
  // heading inside Ayarlar (v0.5.1).
  kartlar: { parts: [VoiceSection, ExamplesSettingsSection] },
  gorunum: { parts: [AppearanceSection], solo: true },
  // "Değişiklikler hemen kaydedilir…" only where a synced setting lives (review d3).
  hesap: { parts: [AccountGroup, SyncGroup], noSavedNote: true },
  veri: { parts: [DataSection, ImportSection], noSavedNote: true },
  hakkinda: { parts: [AboutSection, AppSection], noSavedNote: true },
  gelismis: { parts: [AdvancedSection], solo: true, noSavedNote: true },
  'ilgi-alanlari': { parts: [InterestsBody], noSavedNote: true },
};

/**
 * Where the old single page's anchors and the old /settings/<slug> paths live now. A key is a
 * legacy anchor or slug; the value is the sub-page and, when it differs, the anchor on it.
 */
export const LEGACY: Record<string, { page: SettingsPageId; anchor?: string }> = {
  hesap: { page: 'hesap' },
  senkron: { page: 'hesap', anchor: 'senkron' },
  calisma: { page: 'calisma' },
  yuk: { page: 'yuk' },
  bildirim: { page: 'bildirim' },
  seviye: { page: 'seviye' },
  ornekler: { page: 'kartlar', anchor: 'ornekler' },
  ses: { page: 'kartlar', anchor: 'ses' },
  profil: { page: 'ilgi-alanlari' },
  profile: { page: 'ilgi-alanlari' },
  gorunum: { page: 'gorunum' },
  veri: { page: 'veri' },
  uygulama: { page: 'hakkinda', anchor: 'uygulama' },
  gelismis: { page: 'gelismis' },
  hakkinda: { page: 'hakkinda' },
};

/** "/settings/kartlar#ornekler" for a legacy anchor or slug, null when unknown. */
export function legacyTarget(key: string): string | null {
  const hit = LEGACY[key];
  if (!hit) return null;
  return `/settings/${hit.page}${hit.anchor ? `#${hit.anchor}` : ''}`;
}

export const settingsHref = (page: SettingsPageId, anchor?: string) =>
  `/settings/${page}${anchor ? `#${anchor}` : ''}`;
