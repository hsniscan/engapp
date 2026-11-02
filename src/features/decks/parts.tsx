// Small shared pieces of the Kelimelerim screens (decks, a deck, a suggested deck, the word bank).
// v0.5.2 "Çam": every colour comes from the design tokens; the stage scale also draws the CEFR
// ramp (darker = easier level) so one sequential palette serves both (docs/design.md).
import type { ReactNode } from 'react';
import { Badge, Chip, cn } from '@/ui';
import { BAR } from './deckUi';

/** A thin horizontal bar of segments (widths in %), on a track. */
export function SegBar({
  parts,
  label,
  height = 8,
  track = BAR.track,
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

/** Progress of a deck against its full size: learned, then in progress, on a track. */
export function ProgressBar2({
  total,
  first,
  second,
  label,
  height = 8,
  firstColor = BAR.learned,
  secondColor = BAR.studying,
  track,
}: {
  total: number;
  first: number;
  second: number;
  label: string;
  height?: number;
  firstColor?: string;
  secondColor?: string;
  track?: string;
}) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div
      role="img"
      aria-label={label}
      className="flex gap-0.5 overflow-hidden rounded-full"
      style={{ height, background: track ?? BAR.track }}
    >
      {first > 0 && <span style={{ width: w(first), background: firstColor }} />}
      {second > 0 && <span style={{ width: w(second), background: secondColor }} />}
    </div>
  );
}

/** A CEFR level as a neutral badge ("B1"). */
export function LevelPill({ level, className }: { level: string; className?: string }) {
  return (
    <Badge tone="neutral" className={cn('tabular shrink-0', className)}>
      {level}
    </Badge>
  );
}

/**
 * @deprecated use `Chip` from '@/ui' (selected). Kept as a thin adapter for screens not yet
 * rebuilt (the graded library list).
 */
export function FilterChip({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: 'ink' | 'accent';
  className?: string;
}) {
  return (
    <Chip selected={pressed} onClick={onClick} className={className}>
      {children}
    </Chip>
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
