import { useTranslation } from 'react-i18next';
import { Icon } from '@/ui';

/** Permanent note on both import panels (plan, "Gizlilik uyarısı"). */
export function ImportPrivacyNote() {
  const { t } = useTranslation();
  return (
    <p className="mb-5 flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      <span>
        <strong className="font-semibold">{t('importer.privacy')}</strong>{' '}
        {t('importer.privacyWhy')}
      </span>
    </p>
  );
}
