import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { db, getSettings, logError, updateSettings, type SettingsPatch } from '@/data';
import type { Settings } from '@/domain/types';
import { toast } from '@/ui';
import i18n from '@/i18n';

/** Live settings row (defaults until the first save) and a guarded update. */
export function useAppSettings(): {
  settings: Settings | undefined;
  update: (patch: SettingsPatch) => Promise<void>;
} {
  const settings = useLiveQuery(() => getSettings(), []);
  const update = useCallback(async (patch: SettingsPatch) => {
    try {
      await updateSettings(patch);
    } catch (e) {
      void logError(e, 'settings.update');
      toast({ title: i18n.t('settings.saveFailed'), tone: 'danger' });
    }
  }, []);
  return { settings, update };
}

/** null = guest (no account on this device). */
export function useUserId(): string | null | undefined {
  return useLiveQuery(
    async () => ((await db.meta.get('user_id'))?.value as string | null | undefined) ?? null,
    [],
  );
}
