import type { ComponentPropsWithRef, ElementType } from 'react';
import { cn } from './cn';

export interface SurfaceProps extends ComponentPropsWithRef<'div'> {
  /** flat = on canvas with a hairline; raised = lifted (menus, the review card); sunken = wells. */
  tone?: 'flat' | 'raised' | 'sunken';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: ElementType;
}

const tones = {
  flat: 'bg-surface border border-border',
  raised: 'bg-surface-raised border border-border shadow-raised',
  sunken: 'bg-surface-sunken',
} as const;

const paddings = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-6 sm:p-8' } as const;

/** The basic container. "Card" in the UI sense; named Surface to avoid clashing with flashcards. */
export function Surface({
  tone = 'flat',
  padding = 'md',
  as: Comp = 'div',
  className,
  ...rest
}: SurfaceProps) {
  return (
    <Comp className={cn('rounded-card', tones[tone], paddings[padding], className)} {...rest} />
  );
}
