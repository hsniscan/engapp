import { isNativeApp } from '@/native/platform';
import type { NativeSaveResult } from '@/native/files';

/** Save text as a file through a temporary link (works offline, no server round trip). */
export function downloadText(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SaveResult =
  | { ok: true; native: false; location: string }
  | { ok: true; native: true; how: 'documents' | 'shared'; location: string; uri: string }
  | { ok: false; cancelled: boolean };

export interface SaveDeps {
  isNative: () => boolean;
  saveNative: (fileName: string, text: string, shareTitle: string) => Promise<NativeSaveResult>;
  download: (fileName: string, text: string, mime: string) => void;
}

const defaultSaveDeps: SaveDeps = {
  isNative: isNativeApp,
  saveNative: async (fileName, text, shareTitle) =>
    (await import('@/native/files')).saveNativeFile(fileName, text, shareTitle),
  download: downloadText,
};

/**
 * Save a text file where this platform can: a browser download on the web, the phone's
 * Documents folder (or the share sheet) in the Android app, where `<a download>` does nothing.
 * Resolves only once the file is really written, so callers can record success afterwards.
 */
export async function saveTextFile(
  fileName: string,
  text: string,
  mime: string,
  shareTitle = fileName,
  deps: SaveDeps = defaultSaveDeps,
): Promise<SaveResult> {
  if (deps.isNative()) {
    const r = await deps.saveNative(fileName, text, shareTitle);
    return r.ok ? { ...r, native: true } : r;
  }
  deps.download(fileName, text, mime);
  return { ok: true, native: false, location: fileName };
}

/** Local calendar date as YYYY-MM-DD, for file names ("engapp-yedek-2026-10-21.json"). */
export function fileDate(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const backupFileName = (now?: number) => `engapp-yedek-${fileDate(now)}.json`;
export const csvFileName = (now?: number) => `engapp-kelimeler-${fileDate(now)}.csv`;
export const errorLogFileName = (now?: number) => `engapp-hata-kaydi-${fileDate(now)}.json`;

/** Human file size in Turkish ("2,4 MB"). */
export function formatBytes(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return new Intl.NumberFormat('tr-TR', {
    style: 'unit',
    unit: units[i],
    unitDisplay: 'short',
    maximumFractionDigits: v < 10 && i > 0 ? 1 : 0,
  }).format(v);
}

/** "9 gün önce", "dün", "bugün" — days between two instants, in Turkish. */
export function relativeDays(from: number, now: number = Date.now()): string {
  const days = Math.round((now - from) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  if (days < 1) return rtf.format(0, 'day');
  if (days < 60) return rtf.format(-days, 'day');
  return rtf.format(-Math.round(days / 30), 'month');
}
