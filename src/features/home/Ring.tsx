import { cn } from '@/ui';

/** A progress ring (decorative: the numbers next to it carry the meaning). */
export function Ring({
  ratio,
  size,
  stroke,
  trackClass,
  fillClass,
  className,
}: {
  /** 0–1; values outside are clamped. */
  ratio: number;
  size: number;
  stroke: number;
  trackClass: string;
  fillClass: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0 -rotate-90', className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className={trackClass}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cn(
          'transition-[stroke-dashoffset] duration-(--duration-large) ease-standard motion-reduce:transition-none',
          fillClass,
          pct === 0 && 'opacity-0',
        )}
      />
    </svg>
  );
}
