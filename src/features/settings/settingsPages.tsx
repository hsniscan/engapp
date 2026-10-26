// The settings sub-pages (redesign: Profil → ⚙ → Ayarlar → /settings/:section). Every group
// of the old single long page lives on exactly one sub-page; nothing was dropped. The old
// anchors (/settings#veri) and slugs (/settings/profile) resolve through LEGACY below.
import type { ComponentType } from 'react';
import { LevelSettingsSection } from '@/features/leveltest/LevelSettingsSection';
import { LoadSettingsSection } from '@/features/load/LoadSettingsSection';
import { NotifySection } from '@/features/notify/NotifySection';
import { InterestsBody } from '@/features/profile/InterestsPage';
import { ProfileSettingsSection } from '@/features/profile/ProfileSettingsSection';
import { ReadingSettingsSection } from '@/features/reader/ReadingSettings';
import { AboutSection } from './AboutSection';
import { AdvancedSection } from './AdvancedSection';
import { AppSection } from './AppSection';
import { DataSection, ImportSection } from './DataSection';
import { ExamplesSettingsSection } from './ExamplesSettings';
import type { GlyphName, GlyphTone } from './SettingsGlyph';
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

/** Index groups, in board order. `titled: false`: a group without a heading. */
export const SETTINGS_GROUPS: {
  key: 'learning' | 'cards' | 'account' | 'app';
  titled: boolean;
  pages: SettingsPageId[];
}[] = [
  { key: 'learning', titled: true, pages: ['calisma', 'yuk', 'bildirim', 'seviye'] },
  { key: 'cards', titled: true, pages: ['kartlar', 'gorunum'] },
  { key: 'account', titled: true, pages: ['hesap', 'veri'] },
  { key: 'app', titled: false, pages: ['hakkinda'] },
];

export const PAGE_GLYPH: Record<SettingsPageId, { name: GlyphName; tone: GlyphTone }> = {
  calisma: { name: 'study', tone: 'accent' },
  yuk: { name: 'load', tone: 'accent' },
  bildirim: { name: 'bell', tone: 'warn' },
  seviye: { name: 'level', tone: 'success' },
  kartlar: { name: 'cards', tone: 'accent' },
  gorunum: { name: 'appearance', tone: 'neutral' },
  hesap: { name: 'account', tone: 'accent' },
  veri: { name: 'data', tone: 'success' },
  hakkinda: { name: 'about', tone: 'neutral' },
  gelismis: { name: 'advanced', tone: 'neutral' },
  'ilgi-alanlari': { name: 'interests', tone: 'accent' },
};

/**
 * What each sub-page shows. `solo`: one group, so its heading would only repeat the page title.
 */
export const PAGE_CONTENT: Record<SettingsPageId, { parts: ComponentType[]; solo?: boolean }> = {
  calisma: { parts: [StudySection, ReadingSettingsSection] },
  yuk: { parts: [LoadSettingsSection], solo: true },
  bildirim: { parts: [NotifySection], solo: true },
  seviye: { parts: [LevelSettingsSection], solo: true },
  kartlar: { parts: [VoiceSection, ExamplesSettingsSection, ProfileSettingsSection] },
  gorunum: { parts: [AppearanceSection], solo: true },
  hesap: { parts: [AccountGroup, SyncGroup] },
  veri: { parts: [DataSection, ImportSection] },
  hakkinda: { parts: [AboutSection, AppSection] },
  gelismis: { parts: [AdvancedSection], solo: true },
  'ilgi-alanlari': { parts: [InterestsBody] },
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
  profil: { page: 'kartlar', anchor: 'profil' },
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
