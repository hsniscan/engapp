// PLACEHOLDER (agent B, redesign router): a suggested deck at /decks/suggested/:key (keys used
// by the home screen: freq-<n>, cefr-<level>-<pos>). The Desteler owner replaces this file.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClasses, Page } from '@/ui';

export function SuggestedDeckPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('nav.decks')}>
      <Link to="/decks?tab=discover" className={buttonClasses({ variant: 'secondary' })}>
        {t('nav.decks')}
      </Link>
    </Page>
  );
}
