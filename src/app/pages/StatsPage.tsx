import { useTranslation } from 'react-i18next';
import { Placeholder } from './Placeholder';

export function StatsPage() {
  const { t } = useTranslation();
  return <Placeholder title={t('stats.title')} icon="chart" />;
}
