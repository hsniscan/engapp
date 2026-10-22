import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportCsv, logError, resetStudyHistory, restoreBackup, type RestoreMode } from '@/data';
import { verifyBackup, type BackupError, type BackupSummary } from '@/domain/backup';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import { Badge, Button, Dialog, DialogClose, Icon, toast } from '@/ui';
import { downloadBackup } from './backupActions';
import { csvFileName, downloadText, formatBytes, relativeDays } from './download';
import { refreshStorageInfo, requestPersistence, useStorageInfo } from './platform';
import { SettingsRow, SettingsSection } from './SettingsLayout';
import { useAppSettings, useUserId } from './useAppSettings';
import { useNow } from './useNow';

interface PendingRestore {
  fileName: string;
  json: string;
  summary: BackupSummary;
  exportedAt: number;
}

const nf = new Intl.NumberFormat('tr-TR');

/**
 * A performance.measure entry (read by the restore timing e2e test, also visible in the
 * browser's performance panel). Never throws.
 */
function timing(name: string, start: number): void {
  try {
    performance.measure(name, { start });
  } catch {
    // Old browsers without measure options: no timing, nothing else changes.
  }
}

/**
 * "Veri": JSON backup and restore, CSV export, last backup, persistent storage and usage,
 * and "Çalışma geçmişini sıfırla".
 */
export function DataSection() {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const userId = useUserId();
  const storage = useStorageInfo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<
    'backup' | 'csv' | 'read' | RestoreMode | 'persist' | 'reset' | null
  >(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const now = useNow();

  useEffect(() => {
    void refreshStorageInfo();
  }, []);

  const backup = async () => {
    setBusy('backup');
    const ok = await downloadBackup();
    setBusy(null);
    toast(
      ok
        ? { title: t('backup.done'), description: t('backup.doneHint'), tone: 'success' }
        : { title: t('backup.failed'), tone: 'danger' },
    );
  };

  const csv = async () => {
    setBusy('csv');
    try {
      const text = await exportCsv({
        term: t('csv.term'),
        meaning: t('csv.meaning'),
        ipa: t('csv.ipa'),
        sentence: t('csv.sentence'),
        tags: t('csv.tags'),
        created: t('csv.created'),
      });
      downloadText(csvFileName(), text, 'text/csv;charset=utf-8');
      toast({ title: t('csv.done'), tone: 'success' });
    } catch (e) {
      void logError(e, 'csv.export');
      toast({ title: t('csv.failed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('read');
    const started = performance.now();
    try {
      const json = await file.text();
      const res = await verifyBackup(json);
      timing('engapp:restore-read', started);
      if (!res.ok) {
        toast({
          title: t('restore.invalidTitle'),
          description: t(`restore.errors.${res.error satisfies BackupError}`),
          tone: 'danger',
          duration: 10_000,
        });
        return;
      }
      setPending({
        fileName: file.name,
        json,
        summary: res.summary,
        exportedAt: res.backup.exported_at,
      });
    } catch (e) {
      void logError(e, 'restore.read');
      toast({
        title: t('restore.invalidTitle'),
        description: t('restore.errors.invalid_json'),
        tone: 'danger',
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const restore = async (mode: RestoreMode) => {
    if (!pending) return;
    setBusy(mode);
    const started = performance.now();
    try {
      const res = await restoreBackup(pending.json, mode);
      timing('engapp:restore-apply', started);
      setPending(null);
      toast({
        title: t('restore.done'),
        description: t('restore.doneDetail', {
          added: nf.format(res.inserted),
          updated: nf.format(res.replaced),
          logs: nf.format(res.logsAdded),
        }),
        tone: 'success',
        duration: 8000,
      });
    } catch (e) {
      void logError(e, 'restore.apply');
      toast({ title: t('restore.failed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  // Undo rows for every answer + cards back to New; the outbox push takes it to other devices.
  const resetHistory = async () => {
    setBusy('reset');
    try {
      await resetStudyHistory();
      setConfirmReset(false);
      toast({
        title: t('resetHistory.done'),
        description: t('resetHistory.doneHint'),
        tone: 'success',
      });
    } catch (e) {
      void logError(e, 'resetHistory');
      toast({ title: t('resetHistory.failed'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const last = settings?.last_backup_at ?? null;
  const stale = last === null || now - last > 7 * 86_400_000;
  const guest = !userId;
  const exported = pending
    ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' }).format(
        pending.exportedAt,
      )
    : '';

  return (
    <SettingsSection
      id="veri"
      title={t('settings.sections.veri')}
      description={t('settings.data.description')}
    >
      <SettingsRow
        label={t('backup.title')}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={stale && guest ? 'text-warn-text' : undefined}>
              {last ? t('backup.last', { when: relativeDays(last, now) }) : t('backup.never')}
            </span>
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            leadingIcon="file"
            loading={busy === 'backup'}
            onClick={() => void backup()}
          >
            {t('backup.download')}
          </Button>
          <Button
            variant="secondary"
            leadingIcon="upload"
            loading={busy === 'read'}
            onClick={() => fileRef.current?.click()}
          >
            {t('restore.button')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="restore-input"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
      </SettingsRow>
      <SettingsRow label={t('csv.title')} description={t('csv.hint')}>
        <Button
          variant="secondary"
          leadingIcon="file"
          loading={busy === 'csv'}
          onClick={() => void csv()}
        >
          {t('csv.button')}
        </Button>
      </SettingsRow>
      <SettingsRow
        label={
          <span className="flex flex-wrap items-center gap-2">
            {t('storage.persistTitle')}
            {storage.persisted === true && <Badge tone="success">{t('storage.on')}</Badge>}
            {storage.persisted === false && (
              <Badge tone={guest ? 'warn' : 'neutral'}>{t('storage.off')}</Badge>
            )}
          </span>
        }
        description={
          !storage.supported
            ? t('storage.unsupported')
            : storage.persisted
              ? t('storage.onHint')
              : guest
                ? t('storage.deniedGuest')
                : t('storage.offHint')
        }
      >
        {storage.supported && storage.persisted === false && (
          <Button
            variant="secondary"
            loading={busy === 'persist'}
            onClick={async () => {
              setBusy('persist');
              const granted = await requestPersistence();
              setBusy(null);
              toast(
                granted
                  ? { title: t('storage.granted'), tone: 'success' }
                  : {
                      title: t('storage.deniedTitle'),
                      description: t('storage.deniedHelp'),
                      tone: 'warn',
                    },
              );
            }}
          >
            {t('storage.request')}
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        label={t('storage.usedTitle')}
        description={
          storage.usage !== null
            ? storage.quota
              ? t('storage.used', {
                  used: formatBytes(storage.usage),
                  quota: formatBytes(storage.quota),
                })
              : formatBytes(storage.usage)
            : t('storage.unknown')
        }
      />
      <SettingsRow label={t('resetHistory.title')} description={t('resetHistory.hint')}>
        <Button variant="danger" onClick={() => setConfirmReset(true)}>
          {t('resetHistory.button')}
        </Button>
      </SettingsRow>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(o) => busy !== 'reset' && setConfirmReset(o)}
        title={t('resetHistory.confirmTitle')}
        description={t('resetHistory.confirmBody')}
        confirmLabel={t('resetHistory.confirm')}
        busy={busy === 'reset'}
        onConfirm={resetHistory}
      />

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && busy === null && setPending(null)}
        title={t('restore.title')}
        description={
          pending ? t('restore.fileInfo', { file: pending.fileName, date: exported }) : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy !== null}>
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={busy === 'overwrite'}
              disabled={busy === 'merge'}
              onClick={() => void restore('overwrite')}
            >
              {t('restore.overwrite')}
            </Button>
            <Button
              loading={busy === 'merge'}
              disabled={busy === 'overwrite'}
              onClick={() => void restore('merge')}
            >
              {t('restore.merge')}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="flex flex-col gap-4">
            <p
              className="rounded-control bg-surface-sunken px-4 py-3 font-serif text-lg text-fg"
              data-testid="restore-summary"
            >
              {t('restore.summary', {
                notes: nf.format(pending.summary.notes),
                cards: nf.format(pending.summary.cards),
                reviews: nf.format(pending.summary.reviews),
              })}
            </p>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex gap-3">
                <Icon name="check" size={18} className="mt-0.5 shrink-0 text-success-text" />
                <div>
                  <dt className="font-medium text-fg">{t('restore.merge')}</dt>
                  <dd className="text-fg-muted">{t('restore.mergeHint')}</dd>
                </div>
              </div>
              <div className="flex gap-3">
                <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger-text" />
                <div>
                  <dt className="font-medium text-fg">{t('restore.overwrite')}</dt>
                  <dd className="text-fg-muted">{t('restore.overwriteHint')}</dd>
                </div>
              </div>
            </dl>
          </div>
        )}
      </Dialog>
    </SettingsSection>
  );
}
