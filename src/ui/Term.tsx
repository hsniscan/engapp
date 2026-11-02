import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';

export interface TermProps {
  children: ReactNode;
  /** display 40 (card) · title 24 (word detail header, sheet) · lead 17 (rows) */
  size?: 'display' | 'title' | 'lead';
  italic?: boolean;
  as?: ElementType;
  className?: string;
}

const sizes = {
  display: 'text-display font-semibold',
  title: 'text-heading font-semibold',
  lead: 'text-lead font-medium',
} as const;

/**
 * An English word or sentence: Literata, lang="en". Everything the learner learns is set in
 * Literata; everything the app says is Instrument Sans (docs/design.md → Typography).
 */
export function Term({ children, size = 'lead', italic, as: Comp = 'span', className }: TermProps) {
  return (
    <Comp lang="en" className={cn('font-serif', sizes[size], italic && 'italic', className)}>
      {children}
    </Comp>
  );
}
