import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '@/ui';

/**
 * Frame of the settings index and its sub-pages: "‹ Back" link, serif title, optional lead.
 * Reading width; the page's single h1.
 */
export function SettingsFrame({
  title,
  description,
  back,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  back: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-10 sm:px-6 md:pt-8">
      <header className="mb-4 flex flex-col gap-1">
        <Link
          to={back.to}
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start pr-2 text-base text-accent-text hover:underline underline-offset-4"
        >
          <Icon name="chevron-left" size={20} />
          {back.label}
        </Link>
        <h1 className="mx-1 font-serif text-[1.875rem] leading-tight font-semibold tracking-[-0.01em] text-fg">
          {title}
        </h1>
        {description && <p className="mx-1 mt-1 text-[0.9375rem] text-fg-muted">{description}</p>}
      </header>
      {children}
    </div>
  );
}
