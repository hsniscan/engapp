import type { ReactNode } from 'react';

/*
 * Engapp icon set. Drawn on a 24 × 24 grid, 1.6 px stroke, round caps and joins,
 * 2 px inner padding. Optical sizes 16 / 20 / 24. Icons inherit `currentColor`.
 */

export const paths = {
  home: (
    <>
      <path d="M4.5 10.25 12 4.25l7.5 6" />
      <path d="M6.5 8.75V19.5h11V8.75" />
      <path d="M10.25 19.5v-4.75h3.5v4.75" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  cards: (
    <>
      <rect x="4" y="7.5" width="12.5" height="12.5" rx="1.75" />
      <path d="M7.5 4.5h10.25c.97 0 1.75.78 1.75 1.75V16.5" />
      <path d="M7 12.25h6.5M7 15.5h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4.5 19.5h15" />
      <path d="M7.5 16v-5M12 16V6.5M16.5 16v-3" />
    </>
  ),
  settings: (
    <>
      <path d="M4.5 7h8M17.5 7h2M4.5 17h2.5M12 17h7.5" />
      <circle cx="15" cy="7" r="2.25" />
      <circle cx="9.5" cy="17" r="2.25" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.5 9.75h3l4.25-3.75v12L7.5 14.25h-3z" />
      <path d="M15.25 9.25a3.9 3.9 0 0 1 0 5.5M17.75 6.75a7.4 7.4 0 0 1 0 10.5" />
    </>
  ),
  undo: (
    <>
      <path d="M8.75 13.75 4.75 9.75l4-4" />
      <path d="M4.75 9.75h9.5a4.75 4.75 0 0 1 0 9.5h-3" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="5.75" />
      <path d="m15 15 4.5 4.5" />
    </>
  ),
  filter: <path d="M4.5 7h15M7.5 12h9M10.5 17h3" />,
  check: <path d="m5.5 12.5 4.25 4.25 8.75-9.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  'chevron-right': <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  'chevron-left': <path d="M14.5 5.5 8 12l6.5 6.5" />,
  'chevron-down': <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  'chevron-up': <path d="m5.5 14.5 6.5-6.5 6.5 6.5" />,
  'arrow-left': <path d="M19 12H5.5M10.5 6.5 5 12l5.5 5.5" />,
  'arrow-right': <path d="M5 12h13.5M13.5 6.5 19 12l-5.5 5.5" />,
  heart: (
    <path d="M12 19.25s-7.25-4.3-7.25-9.4A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.25 2.45c0 5.1-7.25 9.4-7.25 9.4z" />
  ),
  upload: (
    <>
      <path d="M12 15V4.75M7.75 9 12 4.75 16.25 9" />
      <path d="M4.75 14.5v3.75c0 .69.56 1.25 1.25 1.25h12c.69 0 1.25-.56 1.25-1.25V14.5" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.75H7.25C6.56 3.75 6 4.31 6 5v14c0 .69.56 1.25 1.25 1.25h9.5c.69 0 1.25-.56 1.25-1.25V8.25z" />
      <path d="M13.5 3.75v4.5H18" />
      <path d="M9 12.75h6M9 16h3.75" />
    </>
  ),
  'sync-synced': (
    <>
      <path d="M7.25 18.5a3.75 3.75 0 0 1-.5-7.47 5.25 5.25 0 0 1 10.2-1.28A4.4 4.4 0 0 1 16.75 18.5z" />
      <path d="m9.75 14.25 1.75 1.75 3.25-3.25" />
    </>
  ),
  'sync-pending': (
    <>
      <path d="M7.25 18.5a3.75 3.75 0 0 1-.5-7.47 5.25 5.25 0 0 1 10.2-1.28A4.4 4.4 0 0 1 16.75 18.5z" />
      <path d="M12 16.25v-4.5M10 13.5l2-2 2 2" />
    </>
  ),
  'sync-offline': (
    <>
      <path d="M9.6 7.05a5.25 5.25 0 0 1 7.35 2.7A4.4 4.4 0 0 1 19.6 16.9M16.5 18.5H7.25a3.75 3.75 0 0 1-.5-7.47c.08-.5.22-.98.42-1.43" />
      <path d="m4.5 4.5 15 15" />
    </>
  ),
  'sync-error': (
    <>
      <path d="M7.25 18.5a3.75 3.75 0 0 1-.5-7.47 5.25 5.25 0 0 1 10.2-1.28A4.4 4.4 0 0 1 16.75 18.5z" />
      <path d="M12 11.5v2.75" />
      <circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.25 12a7.25 7.25 0 0 1-12.9 4.55M4.75 12a7.25 7.25 0 0 1 12.9-4.55" />
      <path d="M17.9 4.25v3.5h-3.5M6.1 19.75v-3.5h3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.75v1.5M12 18.75v1.5M3.75 12h1.5M18.75 12h1.5M6.17 6.17l1.06 1.06M16.77 16.77l1.06 1.06M6.17 17.83l1.06-1.06M16.77 7.23l1.06-1.06" />
    </>
  ),
  moon: <path d="M19 14.25A7.25 7.25 0 0 1 9.75 5a7.25 7.25 0 1 0 9.25 9.25z" />,
  monitor: (
    <>
      <rect x="3.75" y="4.75" width="16.5" height="11" rx="1.5" />
      <path d="M9 19.5h6M12 15.75v3.75" />
    </>
  ),
  pencil: (
    <>
      <path d="M5 19l.9-3.85 9.9-9.9a1.8 1.8 0 0 1 2.55 0l.4.4a1.8 1.8 0 0 1 0 2.55l-9.9 9.9z" />
      <path d="m14.25 6.75 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.75 7h14.5" />
      <path d="M9.5 7V5.5c0-.41.34-.75.75-.75h3.5c.41 0 .75.34.75.75V7" />
      <path d="m6.5 7 .78 11.6c.05.8.71 1.4 1.5 1.4h6.44c.79 0 1.45-.6 1.5-1.4L17.5 7" />
      <path d="M10.25 10.75v5.5M13.75 10.75v5.5" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9.25v5.5M14 9.25v5.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  alert: (
    <>
      <path d="M10.6 4.9 3.9 17.1c-.6 1.1.2 2.4 1.4 2.4h13.4c1.2 0 2-1.3 1.4-2.4L13.4 4.9a1.6 1.6 0 0 0-2.8 0z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.75" r="3.5" />
      <path d="M5.5 19.5c.8-3.1 3.4-5 6.5-5s5.7 1.9 6.5 5" />
    </>
  ),
  'log-out': (
    <>
      <path d="M10 4.75H6.25c-.69 0-1.25.56-1.25 1.25v12c0 .69.56 1.25 1.25 1.25H10" />
      <path d="M14.75 8.25 18.5 12l-3.75 3.75M18.5 12H9.5" />
    </>
  ),
  tag: (
    <>
      <path d="M4.75 5.9v5.1c0 .46.18.9.5 1.22l7.53 7.53a1.75 1.75 0 0 0 2.47 0l4.33-4.33a1.75 1.75 0 0 0 0-2.47L12.05 5.42a1.72 1.72 0 0 0-1.22-.5H5.9c-.64 0-1.15.52-1.15 1.15z" />
      <circle cx="8.6" cy="8.75" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4.5 7.5 3.75L12 12 4.5 8.25z" />
      <path d="m4.5 12 7.5 3.75L19.5 12" />
      <path d="m4.5 15.75 7.5 3.75 7.5-3.75" />
    </>
  ),
  // v0.4: pictures (word detail, leech sheet, review screen).
  image: (
    <>
      <rect x="4.25" y="5" width="15.5" height="14" rx="1.75" />
      <circle cx="9" cy="9.75" r="1.5" />
      <path d="m4.75 17 4.5-4.25 3.25 3 2.5-2.25 4.25 3.75" />
    </>
  ),
  eye: (
    <>
      <path d="M3.75 12S6.75 6.25 12 6.25 20.25 12 20.25 12 17.25 17.75 12 17.75 3.75 12 3.75 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 6.5A8.4 8.4 0 0 1 12 6.25c5.25 0 8.25 5.75 8.25 5.75a14 14 0 0 1-2.1 2.85M14.2 17.45a7.7 7.7 0 0 1-2.2.3C6.75 17.75 3.75 12 3.75 12a14.3 14.3 0 0 1 3.2-3.85" />
      <path d="M10.25 10.25a2.5 2.5 0 0 0 3.5 3.5" />
      <path d="m4.5 4.5 15 15" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths | 'google';
export const iconNames = [
  ...(Object.keys(paths) as (keyof typeof paths)[]),
  'google',
] as IconName[];
