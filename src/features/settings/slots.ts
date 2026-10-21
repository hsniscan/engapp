/*
 * Slots in the settings page that other agents fill:
 *   - account: the "Hesap" section body (auth agent). Default: guest card + link to /auth.
 *   - sync:    the "Senkron" section body (sync agent). Default: pending count + disabled button.
 * Replace a default here, or call `registerSettingsSlot('sync', MySyncPanel)` from a module
 * imported at startup (e.g. src/sync/index.ts imported by src/main.tsx).
 */
import type { ComponentType } from 'react';
import { DefaultAccount, DefaultSync } from './SlotDefaults';

export const settingsSlots: { account: ComponentType; sync: ComponentType } = {
  account: DefaultAccount,
  sync: DefaultSync,
};

export function registerSettingsSlot(
  slot: keyof typeof settingsSlots,
  component: ComponentType,
): void {
  settingsSlots[slot] = component;
}
