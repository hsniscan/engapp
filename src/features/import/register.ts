import { registerAddTabPanel } from '@/features/cards/addTabs';
import { PasteTab, PdfTab } from './AddTabPanels';

/** Mount the panels in the "Metin ekle" page's "Yapıştır" and "PDF" tabs (/add?tab=…). */
export function registerImportPanels(): void {
  registerAddTabPanel('paste', PasteTab);
  registerAddTabPanel('pdf', PdfTab);
}
