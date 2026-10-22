// The small "Zorlandığın kart" marker on a leech card and, on its front, the mnemonic hint
// (hidden until tapped). card.lapses is the replay of the card's review logs (invariant 3),
// so the marker follows undo and never needs a query of its own.
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { isLeech } from '@/domain/leech';
import { MnemonicHint } from '@/features/mnemonics';
import { Badge } from '@/ui';

export function LeechBadge({ lapses }: { lapses: number }) {
  const { t } = useTranslation();
  if (!isLeech(lapses)) return null;
  return (
    <Badge tone="warn" dot data-testid="leech-marker" title={t('leech.markerLabel', { count: lapses })}>
      <span aria-hidden="true">{t('leech.marker')}</span>
      <span className="sr-only">{t('leech.markerLabel', { count: lapses })}</span>
    </Badge>
  );
}

/** Front of a leech card: "Anımsatıcıyı göster" for the sense the card asks about. */
export function LeechHint({ view }: { view: CardView }) {
  if (!isLeech(view.card.lapses) || view.note.term_type === 'contrast') return null;
  const sense = view.sense ?? view.senses[0];
  if (!sense) return null;
  return <MnemonicHint senseId={sense.id} className="mt-2" />;
}
