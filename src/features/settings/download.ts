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
