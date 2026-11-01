// "CSV olarak indir" for a deck or a selection of words (v0.5.2): the same Excel-friendly file
// as Ayarlar → Yedek ve veri, limited to the given words.
import type { TFunction } from 'i18next';
import { exportCsv, logError } from '@/data';
import { saveFileWithToast } from '@/features/settings/backupActions';
import { toast } from '@/ui';

/** A file-name-safe slug of a deck name ("İş kelimeleri" → "is-kelimeleri"). */
export function fileSlug(name: string): string {
  const s = name
    .toLocaleLowerCase('tr')
    .replace(/[ığüşöç]/g, (c) => ({ ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c' })[c] ?? c)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'deste';
}

export async function exportWordsCsv(t: TFunction, noteIds: readonly string[], name: string): Promise<boolean> {
  try {
    const text = await exportCsv(
      {
        term: t('csv.term'),
        meaning: t('csv.meaning'),
        ipa: t('csv.ipa'),
        sentence: t('csv.sentence'),
        tags: t('csv.tags'),
        created: t('csv.created'),
      },
      Date.now(),
      noteIds,
    );
    return await saveFileWithToast(`engapp-${fileSlug(name)}.csv`, text, 'text/csv;charset=utf-8', {
      done: t('deckHub.detail.exported', { count: noteIds.length }),
      failed: t('csv.failed'),
    });
  } catch (e) {
    void logError(e, 'deck.export');
    toast({ title: t('csv.failed'), tone: 'danger' });
    return false;
  }
}
