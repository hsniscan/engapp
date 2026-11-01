import type { ComponentPropsWithRef, ElementType } from 'react';
import { cn } from './cn';

export type CardTone = 'default' | 'raised' | 'sunken' | 'accent' | 'outline' | 'placeholder';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /**
   * default: surface + hairline (most cards) · raised: floats (the study card, popovers)
   * sunken: a well inside a card · accent: soft pine, the ONE highlighted card of a screen
   * outline: transparent with a hairline · placeholder: dashed, for "add your first…" slots.
   */
  tone?: CardTone;
  /** sm 12 · md 16→20 · lg 24→32 */
  padding?: CardPadding;
  /** Hover/press feedback for cards that are a link or button as a whole. */
  interactive?: boolean;
  /** Inner radius (16) for tiles nested inside another card. */
  inset?: boolean;
  as?: ElementType;
}

const tones: Record<CardTone, string> = {
  default: 'bg-surface border border-border',
  raised: 'bg-surface-raised border border-border shadow-raised',
  sunken: 'bg-surface-sunken',
  accent: 'bg-accent-soft text-fg',
  outline: 'border border-border',
  placeholder: 'border border-dashed border-border-strong/60',
};

const paddings: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-6 sm:p-8',
};

/** The basic container ("card" in the UI sense; flashcards are FlipCard). Radius 20, or 16 inset. */
export function Card({
  tone = 'default',
  padding = 'md',
  interactive,
  inset,
  as: Comp = 'div',
  className,
  ...rest
}: CardProps) {
  return (
    <Comp
      className={cn(
        inset ? 'rounded-inner' : 'rounded-card',
        tones[tone],
        paddings[padding],
        interactive &&
          'block transition-[background-color,border-color,transform] duration-(--duration-micro) ease-standard hover:border-border-strong/60 hover:bg-surface-hover motion-safe:active:scale-[0.99]',
        className,
      )}
      {...rest}
    />
  );
}
