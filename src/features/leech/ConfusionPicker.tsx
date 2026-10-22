// "Hangi kelimeyle karıştırdın?": the user's own terms, near ones first, with a search.
// Picking one stores the pair privately (user_content) and offers a contrast card.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearConfusion, getConfusionPicker, logError, reportConfusion } from '@/data';
import type { ConfusablePair } from '@/domain/confusables';
import type { Id } from '@/domain/types';
import { Badge, Button, Icon, TextField, toast } from '@/ui';

export interface ConfusionPickerProps {
  noteId: Id;
  senseId: Id | null;
  /** The pair was stored. */
  onReported: (pair: ConfusablePair) => void;
}

export function ConfusionPicker({ noteId, senseId, onReported }: ConfusionPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useLiveQuery(() => getConfusionPicker(noteId, query, 30), [noteId, query]);

  const pick = async (otherId: Id) => {
    if (busy) return;
    setBusy(true);
    try {
      onReported(await reportConfusion(noteId, otherId, { senseId }));
    } catch (e) {
      void logError(e, 'leech.reportConfusion');
      toast({ title: t('leech.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="confusion-picker">
      <TextField
        label={t('leech.picker.search')}
        hideLabel
        placeholder={t('leech.picker.search')}
        leadingIcon="search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {list && list.length === 0 && (
        <p className="py-2 text-sm text-fg-muted">{query.trim() ? t('leech.picker.empty') : t('leech.picker.noWords')}</p>
      )}
      <ul className="-mx-2 flex max-h-[45dvh] flex-col overflow-y-auto" aria-label={t('leech.picker.title')}>
        {list?.map((e) => (
          <li key={e.note_id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pick(e.note_id)}
              className="flex min-h-12 w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken disabled:opacity-60"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span lang="en" className="truncate font-serif text-lg font-semibold text-fg">
                  {e.term}
                </span>
                {e.meaning && <span className="truncate text-sm text-fg-muted">{e.meaning}</span>}
              </span>
              {e.near && <Badge tone={e.near === 'reported' ? 'warn' : 'accent'}>{t(`leech.picker.near.${e.near}`)}</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** After a pick: "Not edildi" with "Fark kartı yap" and an undo. */
export function ReportedNote({
  pair,
  onContrast,
  onUndone,
}: {
  pair: ConfusablePair;
  onContrast: () => void;
  onUndone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="flex items-start gap-2 text-[0.9375rem] text-fg">
        <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success-text" />
        <span>
          {t('leech.picker.reported', { a: pair.a.term, b: pair.b.term })} {t('leech.picker.reportedBody')}
        </span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <Button onClick={onContrast}>{t('leech.picker.makeContrast')}</Button>
        <Button
          variant="ghost"
          leadingIcon="undo"
          onClick={() => {
            void clearConfusion(pair.a.term, pair.b.term)
              .then(() => {
                toast({ title: t('leech.undone') });
                onUndone();
              })
              .catch((e: unknown) => void logError(e, 'leech.clearConfusion'));
          }}
        >
          {t('common.undo')}
        </Button>
      </div>
    </div>
  );
}
