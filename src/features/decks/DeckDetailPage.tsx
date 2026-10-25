// PLACEHOLDER (agent B, redesign router): a deck at /decks/:id. The Desteler owner replaces
// this file with the real screen (board DeckDetail).
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClasses, Page } from '@/ui';

export function DeckDetailPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('nav.decks')}>
      <Link to="/decks" className={buttonClasses({ variant: 'secondary' })}>
        {t('nav.decks')}
      </Link>
    </Page>
  );
}
