// The small marker on a card the learner keeps forgetting and, on its front, the mnemonic hint
// (hidden until tapped). From 3 lapses (v0.5.3 B5, ADR 0071) the card is "Zorlanıyor"; from 6
// it is a "Zorlandığın kart" (leech). card.lapses is the replay of the card's review logs
// (invariant 3), so the marker follows undo and never needs a query of its own.
import { useTranslation } from 'react-i18next';
import type { CardView } from '@/data';
import { isLeech, isStruggling } from '@/domain/leech';
import { MnemonicHint } from '@/features/mnemonics';
import { Badge } from '@/ui';

export function LeechBadge({ lapses }: { lapses: number }) {
  const { t } = useTranslation();
  if (!isStruggling(lapses)) return null;
  const leech = isLeech(lapses);
  return (
    <Badge
      tone="warn"
      dot
      data-testid={leech ? 'leech-marker' : 'struggling-marker'}
      title={t(leech ? 'leech.markerLabel' : 'leech.strugglingLabel', { count: lapses })}
    >
      <span aria-hidden="true">{t(leech ? 'leech.marker' : 'leech.struggling')}</span>
      <span className="sr-only">{t(leech ? 'leech.markerLabel' : 'leech.strugglingLabel', { count: lapses })}</span>
    </Badge>
  );
}

/** Front of a struggling card: "Anımsatıcıyı göster" for the sense the card asks about. */
export function LeechHint({ view }: { view: CardView }) {
  if (!isStruggling(view.card.lapses) || view.note.term_type === 'contrast') return null;
  const sense = view.sense ?? view.senses[0];
  if (!sense) return null;
  return <MnemonicHint senseId={sense.id} className="mt-2" />;
}
