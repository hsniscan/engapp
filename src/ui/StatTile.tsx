import type { ReactNode } from 'react';
import { cn } from './cn';

export interface StatTileProps {
  value: ReactNode;
  label: ReactNode;
  /** Small unit after the value ("gün", "%"). */
  unit?: ReactNode;
  /** One line under the label: a delta or hint ("Bu hafta +12"). */
  hint?: ReactNode;
  /** Card around the tile (default) or bare (inside another card / a StatRow). */
  bare?: boolean;
  className?: string;
}

/**
 * One number with its label. Value on top (24 px semibold, tabular), label under it, so a
 * row of tiles keeps the values on one baseline even when a label wraps (review O-7).
 */
export function StatTile({ value, label, unit, hint, bare, className }: StatTileProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1',
        !bare && 'rounded-card border border-border bg-surface p-4',
        className,
      )}
    >
      <p className="tabular flex items-baseline gap-1 text-heading font-semibold text-fg">
        {value}
        {unit && <span className="text-meta font-medium text-fg-muted">{unit}</span>}
      </p>
      <p className="text-meta text-fg-muted">{label}</p>
      {hint && <p className="text-caption font-semibold text-accent-text">{hint}</p>}
    </div>
  );
}

/** Tiles side by side with hairline dividers, on one card (Profil, session summary). */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid auto-cols-fr grid-flow-col divide-x divide-border rounded-card border border-border bg-surface py-4 [&>*]:px-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
