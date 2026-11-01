import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

export interface EyebrowProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

/** The one small label above a title or a group (12 px, semibold, tracked caps, muted). */
export function Eyebrow({ children, className, as: Comp = 'p' }: EyebrowProps) {
  return (
    <Comp
      className={cn(
        'text-caption font-semibold tracking-[0.08em] text-fg-muted uppercase',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  /** Heading level; sections of a page are h2. */
  as?: 'h2' | 'h3';
  id?: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** One quiet action on the right, e.g. a "Tümü" link (use buttonClasses ghost sm). */
  action?: ReactNode;
  className?: string;
}

/** Title of a section inside a page: 20 px semibold sans, optional eyebrow/description/action. */
export function SectionHeader({
  title,
  as: H = 'h2',
  id,
  eyebrow,
  description,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <H id={id} className="text-title font-semibold text-fg">
          {title}
        </H>
        {description && <p className="text-meta text-fg-muted">{description}</p>}
      </div>
      {action && <div className="-mr-2 flex shrink-0 items-center">{action}</div>}
    </div>
  );
}
