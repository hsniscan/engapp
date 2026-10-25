// Ayarlar → Hesap ve senkron: the account and sync slot bodies (filled by the auth feature,
// see slots.ts) and the delete row.
import { useTranslation } from 'react-i18next';
import { AccountDeleteRow } from '@/features/account/AccountDeleteRow';
import { SettingsSection } from './SettingsLayout';
import { settingsSlots } from './slots';

export function AccountGroup() {
  const { t } = useTranslation();
  const Account = settingsSlots.account;
  return (
    <SettingsSection id="hesap" title={t('settings.sections.hesap')}>
      <Account />
      <AccountDeleteRow />
    </SettingsSection>
  );
}

export function SyncGroup() {
  const { t } = useTranslation();
  const Sync = settingsSlots.sync;
  return (
    <SettingsSection id="senkron" title={t('settings.sections.senkron')}>
      <Sync />
    </SettingsSection>
  );
}
