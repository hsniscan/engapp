// The four answer buttons of the study session (redesign): Tekrar · Zor · İyi · Kolay, each with
// when the card comes back ("10 dk", "yarın", "3 gün") and, when the answer changes the card's
// stage, a second line ("↑ Öğrenildi", "↓ yeniden öğren"). After a typed answer one button is
// marked as our suggestion; any button can still be chosen.
import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import type { RatingValue } from '@/domain/types';
import { cn, Kbd, ratings, type Rating } from '@/ui';
import { ratingLines, ratingValue } from './study';

const look: Record<Rating, { button: string; ring: string }> = {
  again: {
    button: 'bg-danger-soft text-danger-text border-[color-mix(in_oklab,var(--danger-text)_22%,transparent)]',
    ring: 'ring-danger-text',
  },
  hard: {
    button: 'bg-warn-soft text-warn-text border-[color-mix(in_oklab,var(--warn-text)_22%,transparent)]',
    ring: 'ring-warn-text',
  },
  good: { button: 'bg-accent text-accent-fg border-accent hover:bg-accent-hover', ring: 'ring-accent-text' },
  easy: {
    button: 'bg-success-soft text-success-text border-[color-mix(in_oklab,var(--success-text)_22%,transparent)]',
    ring: 'ring-success-text',
  },
};

export interface RatingBarProps {
  view: CardView;
  onAnswer: (rating: RatingValue, viaKeyboard: boolean) => void;
  /** Our suggestion after a typed answer or a choice. */
  suggested?: RatingValue | null;
}

export const RatingBar = forwardRef<HTMLDivElement, RatingBarProps>(function RatingBar(
  { view, onAnswer, suggested },
  ref,
) {
  const { t } = useTranslation();
  const qid = useId();
  const hintId = useId();
  const suggestedName = suggested ? ratings.find((r) => ratingValue[r] === suggested) : undefined;
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <p id={qid} className="text-center text-sm text-fg-muted">
        {t('rating.group')}
        {suggestedName && (
          <span id={hintId}>
            {' · '}
            {t('study.suggested')} <strong className="font-semibold text-fg">{t(`rating.${suggestedName}`)}</strong>
          </span>
        )}
      </p>
      <div role="group" aria-labelledby={qid} className="grid grid-cols-4 gap-2">
        {ratings.map((r, i) => {
          const value = ratingValue[r];
          const { interval, change } = ratingLines(view, value);
          const isSuggested = value === suggested;
          return (
            <button
              key={r}
              type="button"
              data-rating={r}
              aria-describedby={isSuggested ? hintId : undefined}
              onClick={(e) => onAnswer(value, e.detail === 0)}
              className={cn(
                'relative flex min-h-[3.875rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border px-1 py-1.5',
                'transition-[background-color,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.97]',
                look[r].button,
                isSuggested && cn('ring-2 ring-offset-2 ring-offset-canvas', look[r].ring),
              )}
            >
              <span className="text-base leading-tight font-semibold">{t(`rating.${r}`)}</span>
              <span className="tabular text-[0.8125rem] leading-tight">
                <span className="sr-only">{t('rating.nextReview')} </span>
                {interval}
              </span>
              {change && <span className="text-[0.6875rem] leading-tight font-semibold">{change}</span>}
              <span aria-hidden="true" className="absolute top-1 right-1 hidden md:pointer-fine:flex">
                <Kbd size="sm">{String(i + 1)}</Kbd>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
