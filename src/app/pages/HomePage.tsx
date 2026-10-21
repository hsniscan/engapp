import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Page, Surface, buttonClasses } from '@/ui';

/** Placeholder home: shows the intended hierarchy with sample numbers. Replaced by features/home. */
export function HomePage() {
  const { t } = useTranslation();
  const due = 34;
  const fresh = 10;
  return (
    <Page title={t('home.title')}>
      <p className="tabular -mt-3 mb-8 flex flex-wrap gap-x-2 text-[0.9375rem] text-fg-muted">
        {t('home.streakLine', { streak: 12, done: 26, total: 60, longest: 21 })
          .split(' · ')
          .map((part, i, all) => (
            <span key={part} className="whitespace-nowrap">
              {part}
              {i < all.length - 1 && (
                <span aria-hidden="true" className="ml-2">
                  ·
                </span>
              )}
            </span>
          ))}
      </p>
      <Surface padding="lg" className="flex flex-col gap-8">
        <dl className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-fg-muted">{t('home.due')}</dt>
            <dd className="tabular font-serif text-5xl leading-none font-semibold">{due}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-fg-muted">{t('home.new')}</dt>
            <dd className="tabular font-serif text-5xl leading-none font-semibold">{fresh}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <Link to="/review" className={buttonClasses({ size: 'lg', fullWidth: true })}>
            {t('home.startReview')}
          </Link>
          <Link to="/add" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
            {t('home.addCard')}
          </Link>
        </div>
      </Surface>
    </Page>
  );
}
