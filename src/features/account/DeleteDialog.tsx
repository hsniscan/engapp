import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logError } from '@/data';
import { DELETE_CONFIRM_WORD, isDeleteConfirmation } from '@/domain/deletion';
import { downloadBackup } from '@/features/settings/backupActions';
import { Button, Dialog, DialogClose, Icon, TextField, toast } from '@/ui';
import {
  deleteAccount,
  DeletionError,
  reloadTo,
  wipeThisDevice,
  type DeletionDeps,
} from './deletion';

export type DeleteMode = 'account' | 'device';

export interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'account': the server account and everything in it; 'device': only this device. */
  mode: DeleteMode;
  /** In-app: always wipe this device; the web page: only when its data is this account's. */
  wipe?: 'always' | 'if-linked';
  /** Offer the JSON backup (only useful where the local data is the user's). */
  showBackup?: boolean;
  /** Tests: replace the network / device steps and the final reload. */
  deps?: DeletionDeps;
  onDone?: (path: string) => void;
}

const ITEMS = ['cards', 'history', 'settings', 'reports', 'notifications', 'pictures', 'account'] as const;

/**
 * "Hesabımı ve verilerimi sil" / "Bu cihazdaki verileri sil": what goes, an optional JSON
 * backup first, a typed confirmation ("SİL"), then the deletion and a full reload to the
 * confirmation page.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  mode,
  wipe = 'always',
  showBackup = true,
  deps,
  onDone = reloadTo,
}: DeleteDialogProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<'delete' | 'backup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmed = isDeleteConfirmation(typed);
  const account = mode === 'account';

  const close = (o: boolean) => {
    if (busy === 'delete') return;
    if (!o) {
      setTyped('');
      setError(null);
    }
    onOpenChange(o);
  };

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

  const run = async () => {
    if (!confirmed || busy) return;
    setBusy('delete');
    setError(null);
    try {
      if (account) {
        await deleteAccount({ wipe }, deps);
        onDone('/hesap-sil?durum=silindi');
      } else {
        await wipeThisDevice(deps);
        onDone('/hesap-sil?durum=cihaz');
      }
    } catch (e) {
      void logError(e, account ? 'account.delete' : 'account.wipeDevice');
      setError(
        e instanceof DeletionError
          ? t(`accountDelete.errors.${e.code}`)
          : account
            ? t('accountDelete.errors.server')
            : t('accountDelete.wipeFailed'),
      );
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      variant="dialog"
      title={account ? t('accountDelete.title') : t('accountDelete.deviceTitle')}
      description={account ? t('accountDelete.lead') : t('accountDelete.deviceLead')}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy === 'delete'}>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={!confirmed}
            loading={busy === 'delete'}
            onClick={() => void run()}
          >
            {busy === 'delete'
              ? t('accountDelete.deleting')
              : account
                ? t('accountDelete.confirmButton')
                : t('accountDelete.deviceConfirmButton')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[0.9375rem]">
        {account && (
          <>
            <ul id={listId} className="flex flex-col gap-1.5">
              {ITEMS.map((k) => (
                <li key={k} className="flex gap-2.5">
                  <Icon name="x" size={16} className="mt-1 shrink-0 text-danger-text" />
                  <span>{t(`accountDelete.items.${k}`)}</span>
                </li>
              ))}
            </ul>
            <p className="text-fg-muted">{t('accountDelete.device')}</p>
            <p className="text-sm text-fg-muted">{t('accountDelete.shared')}</p>
            <p className="text-sm text-fg-muted">{t('accountDelete.otherDevices')}</p>
          </>
        )}
        {showBackup && (
          <div className="flex flex-col gap-2 rounded-control bg-surface-sunken px-4 py-3">
            <p className="font-medium text-fg">{t('accountDelete.backupTitle')}</p>
            <p className="text-sm text-fg-muted">{t('accountDelete.backupHint')}</p>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="file"
              className="self-start"
              loading={busy === 'backup'}
              disabled={busy === 'delete'}
              onClick={() => void backup()}
            >
              {t('accountDelete.backupButton')}
            </Button>
          </div>
        )}
        <TextField
          label={t('accountDelete.confirmLabel', { word: DELETE_CONFIRM_WORD })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy === 'delete'}
        />
        {error && (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-3 py-2.5 text-sm text-danger-text"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
