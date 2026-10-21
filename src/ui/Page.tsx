import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PageProps {
  title: ReactNode;
  /** Visually hide the heading (it stays as the page's h1 for screen readers). */
  hideTitle?: boolean;
  description?: ReactNode;
  /** Right-aligned header actions. */
  actions?: ReactNode;
  /** 'reading' ≈ 40rem for forms and the review card; 'wide' ≈ 64rem for lists and stats. */
  width?: 'reading' | 'wide';
  children?: ReactNode;
  className?: string;
}

/** Standard page frame inside the AppShell: one h1, consistent gutters and max width. */
export function Page({
  title,
  hideTitle,
  description,
  actions,
  width = 'reading',
  children,
  className,
}: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pt-6 pb-10 sm:px-6 md:pt-10',
        width === 'reading' ? 'max-w-2xl' : 'max-w-5xl',
        className,
      )}
    >
      <header
        className={cn('mb-6 flex items-end justify-between gap-4 md:mb-8', hideTitle && 'sr-only')}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-serif text-3xl leading-tight font-semibold tracking-[-0.01em] text-fg md:text-4xl">
            {title}
          </h1>
          {description && <p className="text-[0.9375rem] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
