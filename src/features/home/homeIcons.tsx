// Icons drawn for the home screen boards (24 × 24, round caps). Kept here rather than in the
// shared set until another screen needs them.
import type { ReactNode } from 'react';
import { cn } from '@/ui';

const paths = {
  flame: (
    <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.5 2 2.5 0-3-1-5 1-8z" />
  ),
  word: (
    <>
      <rect x="3" y="6" width="13" height="14" rx="2" />
      <path d="M7 3h11a2 2 0 0 1 2 2v12" />
    </>
  ),
  production: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  cloze: (
    <>
      <path d="M3 8h6M15 8h6M3 16h8" />
      <path d="M10.5 9.5h4" strokeDasharray="1.5 2" />
      <path d="M14 17h7" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  ahead: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4M10 15h5M13 13l2 2-2 2" />
    </>
  ),
  loop: (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  addCards: (
    <>
      <rect x="4" y="6" width="13" height="14" rx="2" />
      <path d="M8 3h10a2 2 0 0 1 2 2v11M10.5 10v6M7.5 13h6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
} satisfies Record<string, ReactNode>;

export type HomeIconName = keyof typeof paths;

export function HomeIcon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
}: {
  name: HomeIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
    >
      {paths[name]}
    </svg>
  );
}
