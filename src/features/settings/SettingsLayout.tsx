import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/ui';

/**
 * Set by a settings sub-page that shows a single group: its own h1 already names the group,
 * so the group's h2 stays for screen readers only.
 */
export const SoloSectionContext = createContext(false);

/** A titled group of rows on one surface. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  /** Anchor id: old deep links (/settings#veri) and in-page links land here. */
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const solo = useContext(SoloSectionContext);
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20">
      <div className={cn('mb-2 flex flex-col gap-1 px-1.5', solo && !description && 'mb-0')}>
        <h2
          id={headingId}
          className={cn('text-[0.8125rem] font-semibold text-fg-muted', solo && 'sr-only')}
        >
          {title}
        </h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      <div className="divide-y divide-border rounded-card border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

/** One settings row: text on the left, control on the right (stacked on phones when `stack`). */
export function SettingsRow({
  label,
  description,
  children,
  stack,
  className,
}: {
  label?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-x-6 gap-y-3 p-4 sm:px-5',
        stack ? 'flex-col' : 'flex-col sm:flex-row sm:items-center',
        className,
      )}
    >
      {(label || description) && (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {label && <div className="text-[0.9375rem] font-medium text-fg">{label}</div>}
          {description && <div className="text-sm text-fg-muted">{description}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
