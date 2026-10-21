import { registerAddTabPanel } from '@/features/cards/addTabs';
import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';

// The Add page renders the privacy note above its import tabs, so the panels hide theirs.
function PasteTab() {
  return TextImportPanel({ hidePrivacyNote: true });
}
function PdfTab() {
  return PdfImportPanel({ hidePrivacyNote: true });
}

/** Mount the panels in the Add page's "Metin yapıştır" and "PDF yükle" tabs. */
export function registerImportPanels(): void {
  registerAddTabPanel('paste', PasteTab);
  registerAddTabPanel('pdf', PdfTab);
}
