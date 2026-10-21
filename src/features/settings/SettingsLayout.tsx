import { useId, type ReactNode } from 'react';
import { cn } from '@/ui';

import type { SectionId } from './sections';

/** A titled group of rows on one surface. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: SectionId;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20">
      <div className="mb-3 flex flex-col gap-1 px-1">
        <h2 id={headingId} className="font-serif text-xl font-semibold text-fg">
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
