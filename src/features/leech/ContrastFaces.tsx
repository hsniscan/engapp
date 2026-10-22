// The faces of a contrast card ("fark kartı", recognition only): the front shows the two
// words in their sentences, the back their meanings and the one-line difference. The review
// screen wraps them in its card face.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getContrastCard, type CardView } from '@/data';
import { contrastTerms } from '@/domain/confusables';
import { findSpan, isValidSpan } from '@/domain/recognition';
import type { Sense } from '@/domain/types';
import { Button, Dialog } from '@/ui';
import { DifferenceEditor } from './LeechSheet';

function sidesOf(view: Pick<CardView, 'note' | 'senses'>): { term: string; sense: Sense }[] {
  const names = contrastTerms(view.note.term);
  if (!names) return [];
  return names.flatMap((term, i) => {
    const sense = view.senses[i];
    return sense ? [{ term, sense }] : [];
  });
}

function Marked({ sentence, span, term }: { sentence: string; span: [number, number] | null; term: string }) {
  const at = span && isValidSpan(sentence, span) ? span : findSpan(sentence, term);
  return (
    <p lang="en" className="font-serif text-[1.0625rem] leading-relaxed text-fg italic">
      {at ? (
        <>
          {sentence.slice(0, at[0])}
          <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-fg not-italic">{sentence.slice(at[0], at[1])}</mark>
          {sentence.slice(at[1])}
        </>
      ) : (
        sentence
      )}
    </p>
  );
}

export function ContrastFront({ view }: { view: CardView }) {
  const { t } = useTranslation();
  const sides = sidesOf(view);
  return (
    <div className="flex w-full max-w-md flex-col gap-4" data-testid="contrast-front">
      <p lang="en" className="font-serif text-3xl leading-tight font-semibold text-balance break-words text-fg sm:text-4xl">
        {sides.map((s) => s.term).join(' ↔ ') || view.note.term}
      </p>
      {sides.some((s) => s.sense.source_sentence) && (
        <div className="flex flex-col gap-2 text-left">
          {sides.map(
            (s) =>
              s.sense.source_sentence && (
                <Marked key={s.sense.id} sentence={s.sense.source_sentence} span={s.sense.span} term={s.term} />
              ),
          )}
        </div>
      )}
      <p className="text-sm text-fg-muted">{t('leech.contrast.frontHint')}</p>
    </div>
  );
}

export function ContrastBack({ view }: { view: CardView }) {
  const { t } = useTranslation();
  const sides = sidesOf(view);
  const card = useLiveQuery(() => getContrastCard(view.note.id), [view.note.id]);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col gap-4" data-testid="contrast-back">
      <div className="grid grid-cols-1 gap-2 text-left min-[400px]:grid-cols-2">
        {sides.map((s) => (
          <div key={s.sense.id} className="flex min-w-0 flex-col gap-1 rounded-control bg-surface-sunken px-3 py-2.5">
            <p lang="en" className="font-serif text-xl font-semibold break-words text-fg">
              {s.term}
            </p>
            <p className="font-serif text-lg text-fg">{s.sense.meaning_tr_override ?? s.sense.meaning_tr}</p>
            {s.sense.source_sentence_tr && (
              <p lang="tr" className="text-sm leading-snug text-fg-muted">
                {s.sense.source_sentence_tr}
              </p>
            )}
          </div>
        ))}
      </div>
      {card?.difference && (
        <div className="flex flex-col items-center gap-1 border-t border-border pt-3">
          <p lang="tr" className="text-[0.9375rem] leading-relaxed text-fg">
            {card.difference}
          </p>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="pencil"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {t('leech.contrast.edit')}
          </Button>
        </div>
      )}
      <Dialog open={editing} onOpenChange={setEditing} title={t('leech.contrast.edit')}>
        <DifferenceEditor noteId={view.note.id} onSaved={() => setEditing(false)} />
      </Dialog>
    </div>
  );
}
