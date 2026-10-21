import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';

// The Add page renders the privacy note above its import tabs, so the panels hide theirs.
export function PasteTab() {
  return <TextImportPanel hidePrivacyNote />;
}
export function PdfTab() {
  return <PdfImportPanel hidePrivacyNote />;
}
