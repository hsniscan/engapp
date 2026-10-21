import { registerAddTabPanel } from '@/features/cards/addTabs';
import { PasteTab, PdfTab } from './AddTabPanels';

/** Mount the panels in the Add page's "Metin yapıştır" and "PDF yükle" tabs. */
export function registerImportPanels(): void {
  registerAddTabPanel('paste', PasteTab);
  registerAddTabPanel('pdf', PdfTab);
}
