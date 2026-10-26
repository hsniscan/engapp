/*
 * Tab registry for /add?tab=paste|pdf, the "Metin ekle" page ("Yapıştır" | "PDF"); /add with no
 * tab is "Kelime ekle", the hand-written form (v0.5.1, decision 0056).
 *
 * The import feature mounts its panels by replacing the two placeholders below (or by calling
 * `registerAddTabPanel('paste' | 'pdf', Component)` from a module imported before the page
 * renders). The privacy note sits next to "Bu metindeki kelimeleri çıkar" (CaptureActions).
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
