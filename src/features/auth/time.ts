import { formatDistanceToNowStrict } from 'date-fns';
import { enUS, tr } from 'date-fns/locale';
import i18n from '@/i18n';

/** "5 dakika önce" / "az önce" for the last-sync line. */
export function formatSince(at: number, now: number = Date.now()): string {
  if (now - at < 45_000) return i18n.t('auth.justNow');
  return formatDistanceToNowStrict(at, {
    addSuffix: true,
    locale: i18n.language === 'en' ? enUS : tr,
  });
}
