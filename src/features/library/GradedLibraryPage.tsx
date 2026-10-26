// /kitaplik: the graded reading library on its own page (decision 0047). The same list is shown
// inside Desteler → Okuma by the reader package.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon, Page } from '@/ui';
import { GradedLibraryList } from './GradedLibraryList';

export function GradedLibraryPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('gradedLibrary.title')} description={t('gradedLibrary.description')}>
      <Link
        to="/decks"
        className="-mt-3 mb-5 inline-flex min-h-11 items-center gap-1 text-[0.9375rem] font-medium text-accent-text underline-offset-4 hover:underline md:-mt-5"
      >
        <Icon name="chevron-left" size={18} />
        {t('gradedLibrary.back')}
      </Link>
      <GradedLibraryList />
    </Page>
  );
}
