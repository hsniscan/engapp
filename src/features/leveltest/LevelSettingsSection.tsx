// Ayarlar → Seviye: the level (and where it came from), the lock, the level test and the list
// of known words.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, listLevelTests } from '@/data';
import { LEVELS } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { SettingsRow, SettingsSection } from '@/features/settings/SettingsLayout';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { buttonClasses, Select, Skeleton, Switch } from '@/ui';
import { formatDate } from './levelText';

export function LevelSettingsSection() {
  const { t } = useTranslation();
  const { settings, update } = useAppSettings();
  const extra = useLiveQuery(async () => {
    const [tests, known] = await Promise.all([
      listLevelTests(),
      db.known_terms.filter((k) => k.deleted_at === null).toArray(),
    ]);
    return { last: tests[0] ?? null, known: new Set(known.map((k) => k.term_norm)).size };
  }, []);

  return (
    <SettingsSection
      id="seviye"
      title={t('settings.sections.seviye')}
      description={t('settings.level.description')}
    >
      {!settings || !extra ? (
        <div className="p-5">
          <Skeleton lines={4} />
        </div>
      ) : (
        <>
          <SettingsRow
            label={t('settings.level.current')}
            description={
              <span data-testid="level-source">
                {settings.level_source === 'default' || !settings.level_updated_at
                  ? t('settings.level.source.default')
                  : t(`settings.level.source.${settings.level_source}`, {
                      date: formatDate(settings.level_updated_at),
                    })}{' '}
                {t('settings.level.hint')}
              </span>
            }
          >
            <Select
              label={t('settings.level.current')}
              hideLabel
              className="sm:w-52"
              value={settings.level}
              onValueChange={(v) => void update({ level: v as CefrLevel })}
              options={LEVELS.map((l) => ({
                value: l,
                label: `${l} · ${t(`settings.levels.${l}`)}`,
              }))}
            />
          </SettingsRow>
          <div className="px-4 py-2 sm:px-5">
            <Switch
              label={t('settings.level.lock')}
              description={t('settings.level.lockHint')}
              checked={settings.level_locked}
              onCheckedChange={(v) => void update({ level_locked: v })}
            />
          </div>
          <SettingsRow
            label={t('settings.level.test')}
            description={
              extra.last
                ? t(
                    extra.last.reliable || extra.last.applied
                      ? 'settings.level.testLast'
                      : 'settings.level.testLastUnreliable',
                    {
                      date: formatDate(extra.last.taken_at),
                      level: extra.last.result_level,
                    },
                  )
                : t('settings.level.testNone')
            }
          >
            <Link
              to="/level-test"
              className={buttonClasses({ variant: 'secondary', className: 'sm:w-44' })}
            >
              {extra.last ? t('settings.level.testAgain') : t('settings.level.testStart')}
            </Link>
          </SettingsRow>
          <SettingsRow
            label={t('settings.level.known')}
            description={t('settings.level.knownCount', { count: extra.known })}
          >
            <Link
              to="/settings/bilinen-kelimeler"
              className={buttonClasses({ variant: 'secondary', className: 'sm:w-44' })}
            >
              {t('settings.level.knownOpen')}
            </Link>
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}
