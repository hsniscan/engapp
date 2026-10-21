import { cn } from './cn';

export interface SpinnerProps {
  size?: 16 | 20 | 24;
  className?: string;
  /** Announced text; omit when the surrounding control already says it is busy. */
  label?: string;
}

/** A quiet arc spinner. Under reduced motion it pulses instead of spinning. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        'shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse [animation-duration:900ms]',
        className,
      )}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
