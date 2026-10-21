import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Page, Tabs } from '@/ui';
import { PdfImportPanel } from './PdfImportPanel';
import { TextImportPanel } from './TextImportPanel';
import { seedReadyJob } from './testing/fakeData';

/**
 * Dev-only (/dev/import): the two import panels outside the Add page, plus a button that
 * seeds a ready job with 40 realistic fake candidates for the preview screen.
 */
export function DevImportPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Page
      title="İçe aktarma (geliştirme)"
      actions={
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const id = await seedReadyJob(40);
            void navigate(`/import/${id}`);
          }}
        >
          Örnek önizleme
        </Button>
      }
    >
      <Tabs
        label="İçe aktarma"
        defaultValue={new URLSearchParams(window.location.search).get('tab') === 'pdf' ? 'pdf' : 'paste'}
        items={[
          { value: 'paste', label: 'Metin yapıştır', icon: 'file', content: <TextImportPanel /> },
          { value: 'pdf', label: 'PDF yükle', icon: 'upload', content: <PdfImportPanel /> },
        ]}
      />
    </Page>
  );
}
