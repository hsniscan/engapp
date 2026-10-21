import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export interface KbdProps extends ComponentPropsWithRef<'kbd'> {
  size?: 'sm' | 'md';
}

/** Keyboard key hint. Show it only where a keyboard is likely (e.g. `pointer-fine:`). */
export function Kbd({ size = 'md', className, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-sm border border-border border-b-2 bg-surface px-1 font-sans font-medium text-fg-muted',
        size === 'md' ? 'h-5 min-w-5 text-[0.6875rem]' : 'h-4 min-w-4 text-[0.625rem]',
        className,
      )}
      {...rest}
    />
  );
}
