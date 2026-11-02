import { useContext, useId, type ReactNode } from 'react';
import { cn } from '@/ui';
import { SoloSectionContext } from './soloSection';

/** A titled group of rows on one card (the ListGroup look: caps label, hairline rows). */
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
      <div className={cn('mb-2 flex flex-col gap-1 px-1', solo && !description && 'mb-0')}>
        <h2
          id={headingId}
          className={cn(
            'text-caption font-semibold tracking-[0.08em] text-fg-muted uppercase',
            solo && 'sr-only',
          )}
        >
          {title}
        </h2>
        {description && <p className="text-meta text-fg-muted">{description}</p>}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
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
        'flex min-h-14 gap-x-6 gap-y-3 px-4 py-3.5',
        stack ? 'flex-col' : 'flex-col sm:flex-row sm:items-center',
        className,
      )}
    >
      {(label || description) && (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {label && <div className="text-ui font-medium text-fg">{label}</div>}
          {description && <div className="text-meta text-fg-muted">{description}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
