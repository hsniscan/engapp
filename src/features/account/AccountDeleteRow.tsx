import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentUserId } from '@/data';
import { useAuth } from '@/features/auth/session';
import { SettingsRow } from '@/features/settings/SettingsLayout';
import { Button } from '@/ui';
import { DeleteDialog, type DeleteDialogProps } from './DeleteDialog';

/**
 * Settings → Hesap: "Hesabımı ve verilerimi sil" when signed in, otherwise "Bu cihazdaki
 * verileri sil" (guest, or signed out with an account's copy on the device).
 */
export function AccountDeleteRow({ deps }: { deps?: DeleteDialogProps['deps'] }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const linkedUserId = useLiveQuery(() => getCurrentUserId(), []);
  const [open, setOpen] = useState(false);
  if (auth.status === 'loading') return null;

  const signedIn = auth.status === 'signed_in';
  const hint = signedIn
    ? t('accountDelete.rowHint')
    : linkedUserId
      ? t('accountDelete.signedOutRowHint')
      : t('accountDelete.guestRowHint');
  return (
    <>
      <SettingsRow
        label={signedIn ? t('accountDelete.rowTitle') : t('accountDelete.deviceRowTitle')}
        description={hint}
      >
        <Button variant="danger" leadingIcon="trash" className="shrink-0" onClick={() => setOpen(true)}>
          {signedIn ? t('accountDelete.rowButton') : t('accountDelete.deviceRowButton')}
        </Button>
      </SettingsRow>
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        mode={signedIn ? 'account' : 'device'}
        wipe="always"
        deps={deps}
      />
    </>
  );
}
