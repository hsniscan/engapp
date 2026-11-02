import { useState } from 'react';

// ---- per-device reader preferences (v0.5.2, ADR 0063): listening speed and text size. They
// belong to this screen and this device, so they live in browser storage (an empty or blocked
// storage just means the defaults).

export const LISTEN_RATES = ['0.75', '1', '1.25'] as const;
export type ListenRate = (typeof LISTEN_RATES)[number];
export const TEXT_SIZES = ['s', 'm', 'l'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
/** Text size → scale of the reader's 19 px body. */
export const TEXT_SCALE: Record<TextSize, number> = { s: 0.9, m: 1, l: 1.2 };

export interface ReaderPrefs {
  rate: ListenRate;
  size: TextSize;
}

const PREFS_KEY = 'engapp.reader.prefs';
const DEFAULT_PREFS: ReaderPrefs = { rate: '1', size: 'm' };

function readPrefs(): ReaderPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ReaderPrefs>;
    return {
      rate: LISTEN_RATES.includes(raw.rate as ListenRate) ? (raw.rate as ListenRate) : DEFAULT_PREFS.rate,
      size: TEXT_SIZES.includes(raw.size as TextSize) ? (raw.size as TextSize) : DEFAULT_PREFS.size,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = (patch: Partial<ReaderPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: kept for this screen only
      }
      return next;
    });
  return [prefs, update];
}
