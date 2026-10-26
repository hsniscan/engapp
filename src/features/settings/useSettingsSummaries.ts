// One-line state under each row of the settings index ("Günde 10 yeni · hedef %90").
import { useTranslation } from 'react-i18next';
import { capacityMinutes } from '@/domain/capacity';
import { selectedContexts } from '@/domain/examples';
import { useAuth } from '@/features/auth/session';
import { relativeDays } from './download';
import type { SettingsPageId } from './settingsPages';
import { useAppSettings } from './useAppSettings';
import { useNow } from './useNow';

const pad = (n: number) => String(n).padStart(2, '0');

export function useSettingsSummaries(): Partial<Record<SettingsPageId, string>> {
  const { t } = useTranslation();
  const now = useNow();
  const { settings: s } = useAppSettings();
  const auth = useAuth();
  const out: Partial<Record<SettingsPageId, string>> = {
    hakkinda: t('settings.summary.about'),
    gelismis: t('settings.summary.advanced'),
  };
  if (auth.status === 'signed_in') out.hesap = t('settings.summary.accountGoogle');
  else if (auth.status !== 'loading') out.hesap = t('settings.summary.accountGuest');
  if (!s) return out;

  const pct = Math.round(s.request_retention * 100);
  out.calisma =
    s.daily_new_limit === 0
      ? t('settings.summary.studyNone', { pct })
      : t('settings.summary.study', { count: s.daily_new_limit, pct });
  out.yuk = s.vacation
    ? t('settings.summary.loadVacation', { count: capacityMinutes(s) })
    : t('settings.summary.load', { count: capacityMinutes(s) });
  const n = s.notify;
  out.bildirim = !n?.enabled
    ? t('settings.summary.notifyOff')
    : n.mode === 'fixed' && n.hour !== null
      ? t('settings.summary.notifyFixed', { time: `${pad(n.hour)}:00` })
      : t('settings.summary.notifyAuto');
  // Never the default B1 as if it were measured (v0.5.1, as on Profil).
  out.seviye =
    s.level_source === 'default' && !s.level_locked
      ? t('settings.summary.levelUnmeasured')
      : t(s.level_locked ? 'settings.summary.levelLocked' : 'settings.summary.level', {
          level: s.level,
        });
  out.kartlar = t('settings.summary.cards', {
    voice: s.voice === 'en-GB' ? t('settings.voice.gb') : t('settings.voice.us'),
    count: selectedContexts(s).length,
  });
  out.gorunum = t(`settings.summary.theme.${s.theme}`);
  out.veri = s.last_backup_at
    ? t('settings.summary.backupLast', { when: relativeDays(s.last_backup_at, now) })
    : t('settings.summary.backupNever');
  return out;
}
