import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from './cn';
import { Icon } from './Icon';
import { Eyebrow } from './SectionHeader';

export interface TabHeaderProps {
  title: ReactNode;
  /** Small label above the title (e.g. the date on Bugün). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Up to two IconButtons / one small Button, right-aligned on the title row. */
  actions?: ReactNode;
  /** Sub-pages: a back link above the title ("‹ Ayarlar"). Tabs have none. */
  back?: { to: string; label: string };
  /** Keep the h1 for screen readers but do not show it (immersive or self-titled screens). */
  hideTitle?: boolean;
  /** h1 on a page (default); h2 only for previews/galleries that already have an h1. */
  headingLevel?: 'h1' | 'h2';
  className?: string;
}

/**
 * The ONE page header: 28 px (32 px ≥768) semibold sans h1, same left edge on every tab.
 */
export function TabHeader({
  title,
  eyebrow,
  description,
  actions,
  back,
  hideTitle,
  headingLevel: H = 'h1',
  className,
}: TabHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-col gap-2 md:mb-8', hideTitle && 'sr-only', className)}>
      {back && (
        <Link
          to={back.to}
          className="-ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-control pr-3 pl-1 text-ui font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="chevron-left" size={20} />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <H className="text-page font-semibold text-fg md:text-page-lg">{title}</H>
          {description && <p className="max-w-prose text-ui text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="-mr-2 flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}

export interface PageFrameProps extends TabHeaderProps {
  /**
   * wide (64rem): every tab and list screen — one width and left edge for all tabs.
   * reading (40rem): forms, settings sub-pages, the reader's chrome.
   */
  width?: 'wide' | 'reading';
  children?: ReactNode;
  /** Extra classes on the outer frame. */
  frameClassName?: string;
}

/** Standard page frame inside the AppShell: gutters 16/24/40, top 24/40, one header, content. */
export function PageFrame({
  width = 'wide',
  children,
  frameClassName,
  className,
  ...header
}: PageFrameProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pt-6 pb-10 sm:px-6 md:pt-10 lg:px-10',
        width === 'wide' ? 'max-w-(--page-wide)' : 'max-w-(--page-reading)',
        frameClassName,
      )}
    >
      <TabHeader {...header} className={className} />
      {children}
    </div>
  );
}
