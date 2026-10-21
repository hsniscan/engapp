// Mounts the connected features into the other features' seams. Imported for its side
// effect by src/app/SyncIndicator.tsx (always loaded with the shell), so the slots are
// filled before the lazily loaded Add and Settings pages render.
import { registerImportPanels } from '@/features/import/register';
import { registerSettingsSlot } from '@/features/settings/slots';
import { AccountPanel } from './AccountPanel';
import { SyncPanel } from './SyncPanel';

registerSettingsSlot('account', AccountPanel);
registerSettingsSlot('sync', SyncPanel);
registerImportPanels();
