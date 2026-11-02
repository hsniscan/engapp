// "Biraz daha çalış" on Bugün (v0.5.2 "Çam", ADR 0066): once the whole day is done, three ways
// to keep going without breaking the plan — extra new cards today, a practice round, tomorrow's
// cards now — as one list under the Today card, with a link to every option (/study/more).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { addExtraNew, logError, type MoreStudyOverview } from '@/data';
import {
  extraNewMode,
  extraNewSteps,
  hasMoreStudy,
  practiceHref,
  quickPracticeSource,
} from '@/features/extra/links';
import { Button, buttonClasses, IconTile, ListGroup, ListRow, SectionHeader, toast } from '@/ui';

export const AHEAD_HREF = '/study?mode=ahead';

export function MoreStudy({ more }: { more: MoreStudyOverview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  // "+5 yeni kart" goes to the mode that has first-time cards waiting (v0.5.2, review B6), and
  // is not offered while catch-up, a vacation or the ramp after one pauses new cards.
  const mode = extraNewMode(more);
  const steps = mode ? extraNewSteps(more.newWaitingByMode[mode]) : [];
  const source = quickPracticeSource(more);
  if (!hasMoreStudy(more)) return null;

  const add = async (n: number) => {
    setBusy(n);
    try {
      if (!mode) return;
      await addExtraNew(n, mode);
      await navigate(`/study?mode=${mode}`);
    } catch (e) {
      void logError(e, 'home:addExtraNew');
      toast({ title: t('more.addFailed'), tone: 'danger' });
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="more-study-title" data-testid="more-study">
      <SectionHeader
        id="more-study-title"
        title={t('more.title')}
        description={t('today.moreBody')}
        action={
          <Link to="/study/more" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            {t('today.moreAll')}
          </Link>
        }
      />
      <ListGroup>
        {steps.length > 0 && (
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconTile icon="plus" tone="accent" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-fg">{t('today.moreNewTitle')}</span>
                <span className="text-meta text-fg-muted">
                  {t('today.moreNewBody', { count: mode ? more.newWaitingByMode[mode] : 0 })}
                </span>
              </span>
            </div>
            <div className="flex shrink-0 gap-2 pl-13 sm:pl-0">
              {steps.map((n, i) => (
                <Button
                  key={n}
                  size="sm"
                  variant={i === steps.length - 1 ? 'tonal' : 'secondary'}
                  loading={busy === n}
                  disabled={busy !== null}
                  onClick={() => void add(n)}
                  aria-label={t('more.newAdd', { count: n })}
                >
                  +{n}
                </Button>
              ))}
            </div>
          </div>
        )}
        {source && (
          <ListRow
            to={practiceHref({ source, size: 10, tag: null })}
            leadingIcon="loop"
            title={t('more.practiceTitle')}
            description={t('today.morePracticeBody')}
          />
        )}
        {more.aheadCount > 0 && (
          <ListRow
            to={AHEAD_HREF}
            leadingIcon="calendar"
            title={t('today.moreAheadTitle')}
            description={t('today.moreAheadBody', { count: more.aheadCount })}
          />
        )}
      </ListGroup>
    </section>
  );
}
