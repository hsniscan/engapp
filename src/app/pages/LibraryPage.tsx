import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, Page, TextField, buttonClasses } from '@/ui';

export function LibraryPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('library.title')} width="wide">
      <TextField
        label={t('common.search')}
        hideLabel
        type="search"
        leadingIcon="search"
        placeholder={t('library.searchPlaceholder')}
      />
      <EmptyState
        icon="cards"
        title={t('library.empty')}
        description={t('library.emptyHint')}
        action={
          <Link to="/add" className={buttonClasses({ variant: 'secondary' })}>
            {t('home.addCard')}
          </Link>
        }
      />
    </Page>
  );
}
