// App-wide text size (ADR 0090): 100 / 115 / 130 % of the browser's own root size, on this
// device only (like the theme's pre-paint cache, it is a display preference of the device, not
// of the account). Every size in the app is in rem, so scaling the root scales the whole UI;
// the reader's own size (Küçük/Orta/Büyük) multiplies on top. index.html applies it before the
// first paint, mirroring applyTextSize.

export type TextSize = 'normal' | 'large' | 'larger';

export const TEXT_SIZE_STORAGE_KEY = 'engapp.textSize';
export const TEXT_SIZES: readonly TextSize[] = ['normal', 'large', 'larger'];
const SCALE: Record<TextSize, string> = { normal: '', large: '115%', larger: '130%' };

export function isTextSize(v: unknown): v is TextSize {
  return v === 'normal' || v === 'large' || v === 'larger';
}

export function getTextSize(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    return isTextSize(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function applyTextSize(size: TextSize, doc: Document = document): void {
  doc.documentElement.style.fontSize = SCALE[size];
}

export function setTextSize(size: TextSize): void {
  try {
    if (size === 'normal') localStorage.removeItem(TEXT_SIZE_STORAGE_KEY);
    else localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    // Private mode: it still applies for this visit.
  }
  applyTextSize(size);
}
