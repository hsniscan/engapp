// PLACEHOLDER (agent B, redesign router): /study?mode=word|production|cloze runs a session of
// that study type, /study alone shows the StudyModes picker. The study-session owner replaces
// this file; until then every mode opens the old combined session.
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { buttonClasses, Page } from '@/ui';
import { ReviewRoute } from './ReviewScreen';

export function StudyRoute() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  if (search.has('mode')) return <ReviewRoute />;
  return (
    <Page title={t('today.studyTitle')}>
      <div className="flex flex-col gap-3">
        {(['word', 'production', 'cloze'] as const).map((m) => (
          <Link
            key={m}
            to={`/study?mode=${m}`}
            className={buttonClasses({ variant: 'secondary', fullWidth: true })}
          >
            {t(`today.mode.${m}`)}
          </Link>
        ))}
      </div>
    </Page>
  );
}
