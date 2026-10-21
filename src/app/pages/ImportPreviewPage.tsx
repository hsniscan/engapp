import { useTranslation } from 'react-i18next';
import { Placeholder } from './Placeholder';

export function ImportPreviewPage() {
  const { t } = useTranslation();
  return <Placeholder title={t('import.title')} icon="file" />;
}
