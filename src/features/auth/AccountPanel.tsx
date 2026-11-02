import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { db, getCurrentUserId } from '@/data';
import { syncNow } from '@/sync';
import { useSyncStatus } from '@/sync/status';
import { reloadTo, wipeThisDevice } from '@/features/account/deletion';
import { Button, Checkbox, Dialog, DialogClose, Icon, Skeleton, buttonClasses, toast } from '@/ui';
import { Avatar } from './Avatar';
import { useAuth } from './session';
import { formatSince } from './time';

/**
 * "Hesap" section body for Settings: who is signed in, last sync, sign out. In guest mode
 * a short explanation and the way to /auth.
 */
const SIGN_OUT_SYNC_TIMEOUT_MS = 10_000;

export function AccountPanel() {
  const { t } = useTranslation();
  const auth = useAuth();
  const sync = useSyncStatus();
  const linkedUserId = useLiveQuery(() => getCurrentUserId(), []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Changes still in the outbox after the pre-sign-out sync (null: not checked yet). */
  const [unsynced, setUnsynced] = useState<number | null>(null);
  /** "Bu cihazdaki verileri de sil" (v0.5.2): for a shared device. */
  const [wipe, setWipe] = useState(false);

  if (auth.status === 'loading') {
    return (
      <div className="flex items-center gap-3 p-4 sm:p-5" aria-busy="true">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton lines={2} className="flex-1" />
      </div>
    );
  }

  if (auth.status === 'signed_in' && auth.user) {
    const u = auth.user;
    const name = u.name ?? u.email ?? t('auth.noName');
    const doSignOut = async (anyway: boolean) => {
      setBusy(true);
      try {
        if (!anyway) {
          // Push what is waiting first; if something is left, say so before signing out.
          await Promise.race([
            syncNow().catch(() => undefined),
            new Promise((r) => setTimeout(r, SIGN_OUT_SYNC_TIMEOUT_MS)),
          ]);
          const left = await db.outbox.count();
          if (left > 0) {
            setUnsynced(left);
            return;
          }
        }
        await auth.signOut();
        if (wipe) {
          // The account keeps everything on the server; this device starts empty.
          await wipeThisDevice();
          reloadTo('/');
          return;
        }
        toast({ title: t('auth.signedOut') });
        setConfirmOpen(false);
      } catch {
        toast({ title: t('auth.signOutFailed'), tone: 'danger' });
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={u.avatarUrl} name={name} />
          <div className="flex min-w-0 flex-col">
            <p className="truncate font-medium text-fg">{name}</p>
            {u.email && u.email !== name && (
              <p className="truncate text-sm text-fg-muted">{u.email}</p>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg-muted">
              <Icon name={sync.state === 'error' ? 'sync-error' : 'sync-synced'} size={16} />
              <span className="tabular">
                {sync.lastSyncAt
                  ? t('auth.lastSync', { when: formatSince(sync.lastSyncAt) })
                  : t('auth.lastSyncNever')}
              </span>
            </p>
          </div>
        </div>
        <Dialog
          open={confirmOpen}
          onOpenChange={(o) => {
            setConfirmOpen(o);
            if (!o) setUnsynced(null);
          }}
          trigger={
            <Button variant="secondary" leadingIcon="log-out" className="shrink-0">
              {t('auth.signOut')}
            </Button>
          }
          title={t('auth.signOutTitle')}
          description={t('auth.signOutBody')}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </DialogClose>
              <Button
                variant={unsynced ? 'danger' : 'primary'}
                loading={busy}
                onClick={() => void doSignOut(unsynced !== null)}
              >
                {unsynced ? t('auth.signOutAnyway') : t('auth.signOut')}
              </Button>
            </>
          }
        >
          <Checkbox
            label={t('auth.signOutWipe')}
            description={t('auth.signOutWipeHint')}
            checked={wipe}
            onCheckedChange={(v) => setWipe(v === true)}
          />
          {unsynced ? (
            <p
              role="alert"
              className="mt-3 rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text"
            >
              {t(wipe ? 'auth.signOutPendingWipe' : 'auth.signOutPending', { count: unsynced })}
            </p>
          ) : null}
        </Dialog>
      </div>
    );
  }

  // Guest (or signed out with data still linked to an account).
  const signedOut = auth.available && !!linkedUserId;
  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-fg-muted">
          <Icon name="user" size={22} />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="font-medium text-fg">
            {signedOut ? t('auth.signedOutLocal') : t('auth.guestTitle')}
          </p>
          <p className="text-sm text-fg-muted">
            {!auth.available
              ? t('auth.unavailableBody')
              : signedOut
                ? t('auth.signedOutLocalHint')
                : t('auth.guestHint')}
          </p>
        </div>
      </div>
      {auth.available && (
        <Link to="/auth" className={buttonClasses({ variant: 'secondary', className: 'shrink-0' })}>
          {t('auth.signIn')}
        </Link>
      )}
    </div>
  );
}
