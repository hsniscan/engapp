import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'outline';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  tone?: BadgeTone;
  /** Adds a small leading dot in the tone colour. */
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-fg-muted',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success-text',
  warn: 'bg-warn-soft text-warn-text',
  danger: 'bg-danger-soft text-danger-text',
  outline: 'ring-1 ring-inset ring-border text-fg-muted',
};

export function Badge({ tone = 'neutral', dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
