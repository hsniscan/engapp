import { Page, Tabs } from '@/ui';
import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';

/** Dev-only (/dev/import): the two import panels outside the Add page. */
export function DevImportPage() {
  return (
    <Page title="İçe aktarma (geliştirme)">
      <Tabs
        label="İçe aktarma"
        defaultValue="paste"
        items={[
          { value: 'paste', label: 'Metin yapıştır', icon: 'file', content: <TextImportPanel /> },
          { value: 'pdf', label: 'PDF yükle', icon: 'upload', content: <PdfImportPanel /> },
        ]}
      />
    </Page>
  );
}
