// Small shared pieces of the Kelimelerim screens (decks, a deck, a suggested deck, the word bank).
// v0.5.2 "Çam": every colour comes from the design tokens; the stage scale also draws the CEFR
// ramp (darker = easier level) so one sequential palette serves both (docs/design.md).
import type { ReactNode } from 'react';
import { cn } from '@/ui';

/** A thin horizontal bar of segments (widths in %), on a track. */
export function SegBar({
  parts,
  label,
  height = 8,
  track = 'var(--surface-sunken)',
  gap = 2,
  className,
}: {
  parts: { value: number; color: string }[];
  label: string;
  height?: number;
  track?: string;
  gap?: number;
  className?: string;
}) {
  const total = Math.max(
    1,
    parts.reduce((n, p) => n + p.value, 0),
  );
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('flex overflow-hidden rounded-full', className)}
      style={{ height, background: track, gap }}
    >
      {parts.map((p, i) =>
        p.value > 0 ? (
          <span key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ) : null,
      )}
    </div>
  );
}

/** The 40 px tile at the start of a deck row: the deck's first letter on soft pine. */
export function DeckInitial({ name }: { name: string }) {
  const letter = [...name.trim()][0]?.toLocaleUpperCase('tr') ?? '·';
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-ui font-semibold text-accent-text"
    >
      {letter}
    </span>
  );
}

/**
 * A chip label with its count ("Yeni 12"). The count is muted, and a real space separates it
 * from the label so screen readers say "Yeni 12" rather than "Yeni12".
 */
export function ChipCount({
  label,
  count,
  selected,
}: {
  label: ReactNode;
  count: number;
  selected?: boolean;
}) {
  return (
    <>
      {label}{' '}
      <span className={cn('tabular', selected ? 'opacity-75' : 'text-fg-muted')}>
        {count.toLocaleString('tr-TR')}
      </span>
    </>
  );
}
