import { useTranslation } from 'react-i18next';
import { Placeholder } from './Placeholder';

export function AddPage() {
  const { t } = useTranslation();
  return <Placeholder title={t('add.title')} icon="plus" />;
}
