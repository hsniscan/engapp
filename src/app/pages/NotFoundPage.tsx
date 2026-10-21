import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, Page, buttonClasses } from '@/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('notFound.title')} hideTitle>
      <EmptyState
        icon="search"
        title={t('notFound.title')}
        description={t('notFound.body')}
        action={
          <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
            {t('nav.backHome')}
          </Link>
        }
      />
    </Page>
  );
}
