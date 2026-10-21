import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/ui';

export function PastePlaceholder() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="file"
      title={t('cards.import.pasteSoonTitle')}
      description={t('cards.import.soonBody')}
    />
  );
}

export function PdfPlaceholder() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="upload"
      title={t('cards.import.pdfSoonTitle')}
      description={t('cards.import.soonBody')}
    />
  );
}
