// Where a guest's words live, as one calm notice in Profil (v0.5.3 A5, ADR 0072). It replaces
// the 15-second warning toast that used to cover the first study card. Web: shown while the
// browser has not agreed to keep the data; the Android app: always for a guest (the data goes
// with an uninstall). "Yedek al" downloads at once, "Hesap aç" signs in; the close button hides
// it for 30 days. Ayarlar → Veri keeps the full storage row and "İzin iste".
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/session';
import { isNativeApp } from '@/native/platform';
import { buttonClasses, Button, Card, IconButton, IconTile } from '@/ui';
import { downloadBackup } from './backupActions';
import { flags, useStorageInfo } from './platform';
import { shouldShowStorageNotice } from './storageNoticeRule';

const HIDE_KEY = 'storageNotice.hiddenAt';

export function StorageNotice({ native = isNativeApp() }: { native?: boolean }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const storage = useStorageInfo();
  const [hiddenAt, setHiddenAt] = useState(() => {
    const raw = Number(flags.get(HIDE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const guest = auth.status === 'guest' || auth.status === 'unavailable';
  if (!shouldShowStorageNotice({ guest, native, persisted: storage.persisted, hiddenAt, now }))
    return null;
  return (
    <Card
      as="section"
      aria-labelledby="storage-notice-title"
      data-testid="storage-notice"
      className="mb-8 flex flex-col gap-4 pr-2 sm:pr-3"
    >
      <div className="flex items-start gap-3">
        <IconTile icon="info" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <h2 id="storage-notice-title" className="text-ui font-semibold text-fg">
            {native ? t('storage.appGuestTitle') : t('storage.noticeTitle')}
          </h2>
          <p className="text-meta text-fg-muted">
            {native ? t('storage.appGuest') : t('storage.noticeBody')}
          </p>
        </div>
        <IconButton
          icon="x"
          size="sm"
          tooltip={false}
          label={t('common.close')}
          className="-mt-1 shrink-0"
          onClick={() => {
            const at = Date.now();
            flags.set(HIDE_KEY, String(at));
            setHiddenAt(at);
          }}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="file"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await downloadBackup();
            setBusy(false);
          }}
        >
          {t('backup.download')}
        </Button>
        {auth.status === 'guest' && (
          <Link to="/auth" className={buttonClasses({ variant: 'tonal', size: 'sm' })}>
            {t('storage.noticeSignIn')}
          </Link>
        )}
      </div>
    </Card>
  );
}
