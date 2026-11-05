import type { TFunction } from 'i18next';
import type { SyncStatusInfo } from '@/sync/status';

/**
 * One line for the sync state, used by Profil, Ayarlar → Hesap and the indicator tooltip.
 * A refused daily quota (ADR 0060/0070) gets its own plain sentence instead of "hata".
 */
export function syncTitle(t: TFunction, s: SyncStatusInfo): string {
  if (s.mode !== 'account') return t('syncPanel.localTitle');
  if (s.state === 'error' && s.error === 'quota') return t('sync.quota');
  if (s.state === 'pending') return t('sync.pending', { count: s.pending });
  return t(`sync.${s.state}`);
}

/** The plain-words note for rows the server holds back while the rest syncs (decision 0075). */
export function heldHint(t: TFunction, reason: NonNullable<SyncStatusInfo['held']>): string {
  if (reason === 'storage') return t('syncPanel.heldStorage');
  if (reason === 'texts') return t('syncPanel.heldTexts');
  return t('syncPanel.quotaHint');
}
