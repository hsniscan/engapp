/*
 * Tab registry for /add?tab=paste|pdf, the "Metin ekle" page ("Yapıştır" | "PDF"); /add with no
 * tab is "Kelime ekle", the hand-written form (v0.5.1, decision 0056).
 *
 * The import feature mounts its panels with `registerAddTabPanel('paste' | 'pdf', Component)`
 * from a module imported before the page renders (features/auth/register.ts); until then a tab
 * renders nothing. The privacy note sits next to "Bu metindeki kelimeleri çıkar" (CaptureActions).
 */
import type { ComponentType } from 'react';

function Nothing() {
  return null;
}

export type AddTabId = 'manual' | 'paste' | 'pdf';

export const addTabPanels: Record<Exclude<AddTabId, 'manual'>, ComponentType> = {
  paste: Nothing,
  pdf: Nothing,
};

export function registerAddTabPanel(tab: Exclude<AddTabId, 'manual'>, panel: ComponentType): void {
  addTabPanels[tab] = panel;
}
