// One progress wording for a text on every screen (v0.5.2, B14): "Okunmadı", "Başladın",
// "%40 okundu", "Bitti" (Metinlerim, Keşfet "Devam et", the feed's text rows).
import type { TFunction } from 'i18next';
import { readingProgress, type ReaderText } from '@/domain/texts';

export function progressLabel(
  t: TFunction,
  text: Pick<ReaderText, 'finished_at' | 'progress_offset' | 'read_ms' | 'body'>,
): string {
  const p = readingProgress(text);
  if (p.state === 'finished') return t('reader.list.finished');
  if (p.state === 'unread') return t('reader.list.unread');
  return p.pct > 0 ? t('reader.list.progress', { pct: p.pct }) : t('reader.list.started');
}
