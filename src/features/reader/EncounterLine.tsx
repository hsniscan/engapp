// "Bu kelimeyi 7 kez gördün: 4 kartta, 3 metinde" (v0.5 İP1, plan "Karşılaşma sayacı"): on the
// word detail sheet and in the reader's word sheet.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { getEncounterSummary } from '@/data';
import type { Id } from '@/domain/types';

export function EncounterLine({ noteId }: { noteId: Id }) {
  const { t } = useTranslation();
  const s = useLiveQuery(() => getEncounterSummary(noteId), [noteId]);
  if (!s) return null;
  return (
    <p className="text-sm text-fg-muted" data-testid="encounter-line">
      {s.total === 0
        ? t('reader.encounters.none')
        : t('reader.encounters.line', { count: s.total, cards: s.cards, texts: s.texts })}
    </p>
  );
}
