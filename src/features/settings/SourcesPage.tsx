import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon, Page, Surface } from '@/ui';

const SOURCES = [
  { key: 'cefrj', url: 'https://github.com/openlanguageprofiles/olp-en-cefrj' },
  { key: 'octanove', url: 'https://github.com/openlanguageprofiles/olp-en-cefrj' },
  { key: 'wordfreq', url: 'https://github.com/rspeer/wordfreq' },
] as const;

/**
 * Settings → Hakkında → Kaynaklar: attribution of the word lists and frequency data behind
 * word levels (required by their licences: CEFR-J asks for citation, Octanove and wordfreq are
 * CC BY-SA 4.0). docs/licenses.md has the full record.
 */
export function SourcesPage() {
  const { t } = useTranslation();
  return (
    <Page title={t('sources.title')} description={t('sources.intro')}>
      <div className="flex flex-col gap-4">
        <Link
          to="/settings#hakkinda"
          className="-mt-2 inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text underline-offset-4 hover:underline"
        >
          <Icon name="chevron-left" size={16} />
          {t('sources.back')}
        </Link>
        <ul className="flex flex-col gap-3" aria-label={t('sources.title')}>
          {SOURCES.map(({ key, url }) => (
            <li key={key}>
              <Surface className="flex flex-col gap-2">
                <h2 className="font-serif text-lg font-semibold text-fg">{t(`sources.${key}.name`)}</h2>
                <p className="text-[0.9375rem] text-fg-muted">{t(`sources.${key}.what`)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-fg-subtle">{t('sources.license')}</dt>
                  <dd className="text-fg">{t(`sources.${key}.license`)}</dd>
                </dl>
                <p lang="en" className="text-sm text-fg-muted italic">
                  {t(`sources.${key}.cite`)}
                </p>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent-text underline-offset-4 hover:underline"
                >
                  {t('sources.link')}
                  <span aria-hidden="true">↗</span>
                </a>
              </Surface>
            </li>
          ))}
          <li>
            <Surface tone="flat" className="flex flex-col gap-2">
              <h2 className="font-serif text-lg font-semibold text-fg">{t('sources.derived.name')}</h2>
              <p className="text-[0.9375rem] text-fg-muted">{t('sources.derived.what')}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-fg-subtle">{t('sources.license')}</dt>
                <dd className="text-fg">{t('sources.derived.license')}</dd>
              </dl>
            </Surface>
          </li>
        </ul>
        <section aria-labelledby="sources-ai" className="flex flex-col gap-1.5 px-1 pt-2">
          <h2 id="sources-ai" className="font-serif text-lg font-semibold text-fg">
            {t('sources.aiTitle')}
          </h2>
          <p className="text-[0.9375rem] text-fg-muted">{t('sources.aiBody')}</p>
        </section>
      </div>
    </Page>
  );
}
