/*
 * Tab registry for /add ("Elle" | "Metin yapıştır" | "PDF yükle").
 *
 * The import agent mounts its panels by replacing the two placeholders below (or by calling
 * `registerAddTabPanel('paste' | 'pdf', Component)` from a module imported before the page
 * renders). AddPage renders the permanent privacy note ("Gizli iş belgelerini yükleme.")
 * above both panels, so a panel does not need to repeat it.
 */
import type { ComponentType } from 'react';
import { PastePlaceholder, PdfPlaceholder } from './AddTabPlaceholders';

export type AddTabId = 'manual' | 'paste' | 'pdf';

export const addTabPanels: Record<Exclude<AddTabId, 'manual'>, ComponentType> = {
  paste: PastePlaceholder,
  pdf: PdfPlaceholder,
};

export function registerAddTabPanel(tab: Exclude<AddTabId, 'manual'>, panel: ComponentType): void {
  addTabPanels[tab] = panel;
}
