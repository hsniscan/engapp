// The four answer buttons of the study session (redesign): Tekrar · Zor · İyi · Kolay, each with
// when the card comes back ("10 dk", "yarın", "3 gün") and, when the answer changes the card's
// stage, a second line ("↑ Öğrenildi", "↓ yeniden öğren"). After a typed answer one button is
// marked as our suggestion; any button can still be chosen. When the check said the answer was
// wrong (suggestion Tekrar), Zor / İyi / Kolay need a second tap (or key press) so one stray tap
// cannot send a forgotten word months away (ADR 0055).
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { Rating as R, type RatingValue } from '@/domain/types';
import { cn, Kbd, ratings, type Rating } from '@/ui';
import { ratingLines, ratingValue } from './study';

const look: Record<Rating, { button: string; ring: string }> = {
  again: {
    button:
      'bg-danger-soft text-danger-text border-[color-mix(in_oklab,var(--danger-text)_22%,transparent)]',
    ring: 'ring-danger-text',
  },
  hard: {
    button:
      'bg-warn-soft text-warn-text border-[color-mix(in_oklab,var(--warn-text)_22%,transparent)]',
    ring: 'ring-warn-text',
  },
  good: {
    button: 'bg-accent text-accent-fg border-accent hover:bg-accent-hover',
    ring: 'ring-accent-text',
  },
  easy: {
    button:
      'bg-success-soft text-success-text border-[color-mix(in_oklab,var(--success-text)_22%,transparent)]',
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
  const guarded = suggested === R.Again;
  const [armed, setArmed] = useState<RatingValue | null>(null);
  const armedRef = useRef<RatingValue | null>(null);
  const arm = (value: RatingValue) => {
    armedRef.current = value;
    setArmed(value);
  };
  const armedName = armed ? ratings.find((r) => ratingValue[r] === armed) : undefined;

  const press = (value: RatingValue, viaKeyboard: boolean) => {
    if (guarded && value !== R.Again && armed !== value) {
      arm(value);
      return;
    }
    onAnswer(value, viaKeyboard);
  };

  // Keys 2-4 go through the same confirmation (the session's own key handler skips an event
  // this one has handled).
  useEffect(() => {
    if (!guarded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (!(e.key >= '2' && e.key <= '4')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      const value = Number(e.key) as RatingValue;
      if (armedRef.current === value) onAnswer(value, true);
      else {
        armedRef.current = value;
        setArmed(value);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [guarded, onAnswer]);

  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <p id={qid} className="text-center text-sm text-fg-muted">
        {t('rating.group')}
        {suggestedName && (
          <span id={hintId}>
            {' · '}
            {t('study.suggested')}{' '}
            <strong className="font-semibold text-fg">{t(`rating.${suggestedName}`)}</strong>
          </span>
        )}
      </p>
      {guarded && (
        <p
          className="text-center text-[0.8125rem] text-fg-muted"
          role="status"
          data-testid="rating-confirm"
        >
          {armedName
            ? t('study.confirmRating', { rating: t(`rating.${armedName}`) })
            : t('study.wrongHint')}
        </p>
      )}
      <div role="group" aria-labelledby={qid} className="grid grid-cols-4 gap-2">
        {ratings.map((r, i) => {
          const value = ratingValue[r];
          const { interval, change } = ratingLines(view, value);
          const isSuggested = value === suggested;
          const isArmed = armed === value;
          return (
            <button
              key={r}
              type="button"
              data-rating={r}
              aria-describedby={isSuggested ? hintId : undefined}
              data-armed={isArmed || undefined}
              onClick={(e) => press(value, e.detail === 0)}
              className={cn(
                'relative flex min-h-[3.875rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border px-1 py-1.5',
                'transition-[background-color,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.97]',
                look[r].button,
                isSuggested && cn('ring-2 ring-offset-2 ring-offset-canvas', look[r].ring),
                isArmed && cn('ring-2 ring-offset-2 ring-offset-canvas', look[r].ring),
              )}
            >
              <span className="text-base leading-tight font-semibold">{t(`rating.${r}`)}</span>
              <span className="tabular text-[0.8125rem] leading-tight">
                <span className="sr-only">{t('rating.nextReview')} </span>
                {interval}
              </span>
              {isArmed && (
                <span className="text-[0.6875rem] leading-tight font-semibold">
                  {t('study.confirmTap')}
                </span>
              )}
              {change && !isArmed && (
                <span className="text-[0.6875rem] leading-tight font-semibold">{change}</span>
              )}
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 hidden md:pointer-fine:flex"
              >
                <Kbd size="sm">{String(i + 1)}</Kbd>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
