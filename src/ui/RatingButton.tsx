import type { ComponentPropsWithRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Kbd } from './Kbd';
import type { Rating } from './rating';

const styles: Record<Rating, { bar: string; soft: string; text: string }> = {
  again: {
    bar: 'bg-rating-again',
    soft: 'hover:bg-rating-again-soft',
    text: 'text-rating-again-text',
  },
  hard: { bar: 'bg-rating-hard', soft: 'hover:bg-rating-hard-soft', text: 'text-rating-hard-text' },
  good: { bar: 'bg-rating-good', soft: 'hover:bg-rating-good-soft', text: 'text-rating-good-text' },
  easy: { bar: 'bg-rating-easy', soft: 'hover:bg-rating-easy-soft', text: 'text-rating-easy-text' },
};

export interface RatingButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  rating: Rating;
  /** Overrides the rating's own label (practice rounds: "Bilemedim" / "Bildim"). */
  label?: string;
  /** Next interval preview, e.g. "10 dk", "3 g". Always shown: meaning never relies on colour. */
  interval?: string;
  /** Keyboard shortcut hint (1–4), shown on devices with a keyboard. */
  shortcut?: string;
}

/**
 * One of the four answer buttons. Neutral surface, a short hue bar on top, the label in the
 * rating's text colour (AA in both themes) and the interval in muted ink.
 */
export function RatingButton({
  rating,
  label: labelOverride,
  interval,
  shortcut,
  className,
  ...rest
}: RatingButtonProps) {
  const { t } = useTranslation();
  const s = styles[rating];
  const label = labelOverride ?? t(`rating.${rating}`);
  return (
    <button
      type="button"
      className={cn(
        'group relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-control border border-border bg-surface px-2 pt-2.5 pb-2',
        'transition-[background-color,transform] duration-(--duration-micro) ease-standard motion-safe:active:scale-[0.97]',
        s.soft,
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-3 top-0 h-[3px] rounded-b-full', s.bar)}
      />
      <span className={cn('text-[0.9375rem] font-semibold', s.text)}>{label}</span>
      {interval && (
        <span className="tabular text-xs text-fg-muted">
          <span className="sr-only">{t('rating.nextReview')} </span>
          {interval}
        </span>
      )}
      {shortcut && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 bottom-1.5 hidden md:pointer-fine:flex"
        >
          <Kbd size="sm">{shortcut}</Kbd>
        </span>
      )}
    </button>
  );
}
