// Stats, "Zorlandıklarım" (v0.3 İP6): the cards forgotten at least 6 times, each with the
// "Başka yoldan bak" sheet, a practice round of them and the "Zorlandıklarım" practice source;
// below, pairs of the user's words worth a contrast card.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getConfusables, getHardPracticeCount, listLeechCards } from '@/data';
import type { ConfusablePair } from '@/domain/confusables';
import { LEECH_LAPSES } from '@/domain/leech';
import type { Id } from '@/domain/types';
import { cardTypeLabel } from '@/features/cards/labels';
import { MAX_LIST_NOTES, practiceHref } from '@/features/extra/links';
import { Badge, buttonClasses, Dialog, Surface } from '@/ui';
import { ContrastEditor } from './ContrastEditor';
import { useFamilyOf } from './hooks';
import { LeechSheet, PairList } from './LeechSheet';

const SHOWN = 10;

export function LeechStatsSection() {
  const { t } = useTranslation();
  const items = useLiveQuery(() => listLeechCards(), []);
  // No "practise all" link when the practice would have nothing to ask (v0.5.1).
  const hard = useLiveQuery(() => getHardPracticeCount(Date.now()), []);
  const familyOf = useFamilyOf();
  const pairs = useLiveQuery(
    () => getConfusables({ limit: 5, familyOf }).then((v) => v.pairs),
    [familyOf],
  );
  const [sheet, setSheet] = useState<Id | null>(null);
  const [contrast, setContrast] = useState<ConfusablePair | null>(null);
  if (!items) return null;

  const notes = [...new Set(items.map((i) => i.note_id))].slice(0, MAX_LIST_NOTES);
  return (
    <Surface as="section" aria-labelledby="leech-title" padding="lg" data-testid="leech-stats">
      <div className="mb-4 flex flex-col gap-1">
        <h2 id="leech-title" className="font-serif text-xl font-semibold">
          {t('leech.stats.title')}
        </h2>
        <p className="text-sm text-fg-muted">
          {items.length
            ? t('leech.stats.lead', { count: LEECH_LAPSES })
            : t('leech.stats.empty', { count: LEECH_LAPSES })}
        </p>
      </div>
      {items.length > 0 && (
        <ul className="-mx-2 mb-4 flex flex-col">
          {items.slice(0, SHOWN).map((i) => (
            <li key={i.card_id}>
              <button
                type="button"
                onClick={() => setSheet(i.card_id)}
                className="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-2 text-left hover:bg-surface-sunken"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span lang="en" className="truncate font-serif text-lg font-semibold text-fg">
                    {i.term}
                  </span>
                  <span className="truncate text-sm text-fg-muted">
                    {[i.meaning, cardTypeLabel(t, i.card_type)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Badge tone="warn">{t('leech.stats.lapses', { count: i.lapses })}</Badge>
              </button>
            </li>
          ))}
          {items.length > SHOWN && (
            <li className="px-2 pt-1 text-sm text-fg-muted">
              {t('leech.stats.more', { count: items.length - SHOWN })}
            </li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {notes.length > 0 && (
          <Link
            to={practiceHref({ source: 'list', size: 10, tag: null, notes })}
            className={buttonClasses({ size: 'md' })}
          >
            {t('leech.stats.practice')}
          </Link>
        )}
        {!!hard && (
          <Link
            to={practiceHref({ source: 'hard', size: 10, tag: null })}
            className={buttonClasses({ variant: notes.length ? 'ghost' : 'secondary', size: 'md' })}
          >
            {t('leech.stats.allHard')}
          </Link>
        )}
      </div>

      {pairs && pairs.length > 0 && (
        <div className="mt-6 flex flex-col gap-1 border-t border-border pt-5">
          <h3 className="font-serif text-lg font-semibold">{t('leech.stats.pairsTitle')}</h3>
          <p className="text-sm text-fg-muted">{t('leech.stats.pairsLead')}</p>
          <PairList pairs={pairs} onContrast={setContrast} />
        </div>
      )}

      <LeechSheet cardId={sheet} onOpenChange={(o) => !o && setSheet(null)} />
      <ContrastDialog pair={contrast} onOpenChange={(o) => !o && setContrast(null)} />
    </Surface>
  );
}

/** The contrast editor in its own dialog (Stats). */
export function ContrastDialog({
  pair,
  onOpenChange,
}: {
  pair: Pick<ConfusablePair, 'a' | 'b'> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={pair !== null}
      onOpenChange={onOpenChange}
      title={t('leech.contrast.title')}
      description={
        pair ? t('leech.contrast.description', { a: pair.a.term, b: pair.b.term }) : null
      }
    >
      {pair && <ContrastEditor pair={pair} onAdded={() => onOpenChange(false)} />}
    </Dialog>
  );
}
