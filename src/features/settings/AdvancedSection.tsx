import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, listErrors, logError } from '@/data';
import { ImageReviewEntry } from '@/features/images/ImageSettings';
import { Badge, Button, toast } from '@/ui';
import { version } from '../../../package.json';
import { saveFileWithToast } from './backupActions';
import { errorLogFileName } from './download';
import { checkIntegrityNow, integrityProblems, repairNow, useIntegrity } from './integrity';
import { SettingsRow, SettingsSection } from './SettingsLayout';

/** "Gelişmiş": integrity check + repair, error log download, app version. */
export function AdvancedSection() {
  const { t } = useTranslation();
  const { report } = useIntegrity();
  const [busy, setBusy] = useState<'check' | 'repair' | null>(null);
  const errorCount = useLiveQuery(() => db.error_log.count(), []) ?? 0;
  const problems = report ? integrityProblems(report) : 0;
  // The startup check runs at most daily (bootstrap); on this screen the badge is always current.
  useEffect(() => {
    if (!report) void checkIntegrityNow();
  }, [report]);

  const check = async () => {
    setBusy('check');
    const r = await checkIntegrityNow();
    setBusy(null);
    if (r)
      toast(
        integrityProblems(r)
          ? { title: t('integrity.found', { count: integrityProblems(r) }), tone: 'warn' }
          : { title: t('integrity.ok'), tone: 'success' },
      );
  };

  const repair = async () => {
    setBusy('repair');
    try {
      const after = await repairNow();
      const left = after ? integrityProblems(after) : 0;
      toast(
        left
          ? { title: t('integrity.repairPartial', { count: left }), tone: 'warn' }
          : { title: t('integrity.repaired'), tone: 'success' },
      );
    } catch (e) {
      void logError(e, 'integrity.repair');
      toast({ title: t('integrity.repairFailed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const downloadLog = async () => {
    const rows = await listErrors();
    const payload = {
      app: 'engapp',
      version,
      exported_at: new Date().toISOString(),
      user_agent: navigator.userAgent,
      errors: rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
    };
    await saveFileWithToast(
      errorLogFileName(),
      JSON.stringify(payload, null, 2),
      'application/json',
      {
        done: t('errors.downloaded'),
        failed: t('errors.downloadFailed'),
      },
    );
  };

  return (
    <SettingsSection id="gelismis" title={t('settings.sections.gelismis')}>
      <ImageReviewEntry />
      <SettingsRow
        label={
          <span className="flex flex-wrap items-center gap-2">
            {t('integrity.title')}
            {report &&
              (problems ? (
                <Badge tone="warn">{t('integrity.badgeProblems', { count: problems })}</Badge>
              ) : (
                <Badge tone="success">{t('integrity.badgeOk')}</Badge>
              ))}
          </span>
        }
        description={problems ? t('integrity.problemsHint') : t('integrity.hint')}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={busy === 'check'}
            disabled={busy === 'repair'}
            onClick={() => void check()}
          >
            {t('integrity.check')}
          </Button>
          {problems > 0 && (
            <Button
              loading={busy === 'repair'}
              disabled={busy === 'check'}
              onClick={() => void repair()}
            >
              {t('integrity.repair')}
            </Button>
          )}
        </div>
      </SettingsRow>
      <SettingsRow
        label={t('errors.title')}
        description={errorCount ? t('errors.count', { count: errorCount }) : t('errors.none')}
      >
        <Button
          variant="secondary"
          leadingIcon="file"
          disabled={errorCount === 0}
          onClick={() => void downloadLog()}
        >
          {t('errors.download')}
        </Button>
      </SettingsRow>
      <SettingsRow label={t('settings.version')}>
        <span className="tabular text-[0.9375rem] text-fg-muted">
          {version}
          {import.meta.env.DEV ? ' (dev)' : ''}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}
