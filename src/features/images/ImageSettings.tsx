// Settings → Görünüm (v0.4 İP3): "Görseli ön yüzde de göster" and how many pictures this device
// keeps for offline use; "Görselden hatırlama kartları" (İP8, default on); and, for app admins
// only, the entry to the review screen (İP4).
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getImageCacheStats, logError, setImageCardsEnabled } from '@/data';
import { imageCardsEnabled } from '@/domain/imageCards';
import i18n from '@/i18n';
import { formatBytes } from '@/features/settings/download';
import { SettingsRow } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { buttonClasses, Switch, toast } from '@/ui';
import { useIsAdmin } from './useIsAdmin';

export function ImageSettingsRows() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const stats = useLiveQuery(() => getImageCacheStats(), []);
  if (!settings) return null;
  return (
    <>
      <SettingsRow>
        <Switch
          className="w-full"
          label={t('images.settings.front')}
          description={
            <>
              {t('images.settings.frontHint')}
              {stats && stats.count > 0 && (
                <span className="tabular mt-1 block">
                  {t('images.settings.stored', {
                    count: stats.count,
                    size: formatBytes(stats.bytes),
                  })}
                </span>
              )}
            </>
          }
          checked={settings.show_image_front === true}
          onCheckedChange={(v) => void update({ show_image_front: v })}
        />
      </SettingsRow>
      <SettingsRow>
        <Switch
          className="w-full"
          label={t('imageCard.settings.label')}
          description={t('imageCard.settings.hint')}
          checked={imageCardsEnabled(settings)}
          onCheckedChange={(v) => void toggleImageCards(v)}
        />
      </SettingsRow>
    </>
  );
}

async function toggleImageCards(on: boolean): Promise<void> {
  try {
    await setImageCardsEnabled(on);
  } catch (e) {
    void logError(e, 'settings.imageCards');
    toast({ title: i18n.t('settings.saveFailed'), tone: 'danger' });
  }
}

/** "Görsel onayı": shown only to app admins (the server checks it again on every call). */
export function ImageReviewEntry({ ask }: { ask?: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const admin = useIsAdmin(ask);
  if (!admin) return null;
  return (
    <SettingsRow label={t('images.settings.review')} description={t('images.settings.reviewHint')}>
      <Link
        to="/admin/images"
        className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}
      >
        {t('images.settings.reviewOpen')}
      </Link>
    </SettingsRow>
  );
}
