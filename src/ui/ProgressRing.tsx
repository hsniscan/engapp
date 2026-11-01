import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ProgressRingProps {
  value: number;
  max: number;
  /** Accessible name, e.g. "Bugünün çalışması". */
  label: string;
  /** Human text for screen readers, e.g. "12 / 30 kart". */
  valueText?: string;
  /** Diameter in px (default 72). */
  size?: number;
  /** Stroke in px (default size/12, at least 4). */
  stroke?: number;
  /** Centre content (a number, a check icon). */
  children?: ReactNode;
  className?: string;
}

/** Circular determinate progress: hairline-ish track, pine arc with a round cap. */
export function ProgressRing({
  value,
  max,
  label,
  valueText,
  size = 72,
  stroke,
  children,
  className,
}: ProgressRingProps) {
  const w = stroke ?? Math.max(4, Math.round(size / 12));
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={valueText}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={w} stroke="var(--surface-sunken)" />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={w}
            stroke="var(--accent)"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-(--duration-large) ease-standard motion-reduce:transition-none"
          />
        )}
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}
