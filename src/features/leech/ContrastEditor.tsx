// "Fark kartı": the two words side by side, the one-line difference (shared text from
// ai-contrast when there is one, always editable) and "Fark kartını ekle". Works offline with
// cached shared content or a difference the user writes.
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionError, createContrastCard, getContrastDraft, logError, type ContrastDraftSide } from '@/data';
import { MAX_CONTRAST_TEXT, type ConfusablePair } from '@/domain/confusables';
import type { Id } from '@/domain/types';
import { Button, Spinner, TextArea, toast } from '@/ui';
import { defaultContrastDeps, requestContrast, type ContrastRequestDeps, type ContrastRequestError } from './request';

export type ContrastPairInput = Pick<ConfusablePair, 'a' | 'b'>;

export interface ContrastEditorProps {
  pair: ContrastPairInput;
  /** After the card was added. */
  onAdded?: (noteId: Id) => void;
  /** Tests only. */
  requestDeps?: ContrastRequestDeps;
}

const errorKey = {
  offline: 'leech.contrast.offline',
  signed_out: 'leech.contrast.guest',
  daily_limit: 'leech.contrast.dailyLimit',
  busy: 'leech.contrast.busy',
  no_lexicon: 'leech.contrast.noLexicon',
  failed: 'leech.contrast.failed',
} as const satisfies Record<ContrastRequestError, string>;

function Side({ side }: { side: ContrastDraftSide }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control bg-surface-sunken px-3 py-2.5">
      <p lang="en" className="font-serif text-xl font-semibold break-words text-fg">
        {side.term}
      </p>
      <p className="text-[0.9375rem] text-fg">{side.meaning}</p>
      {side.sentence && (
        <p lang="en" className="font-serif text-[0.9375rem] leading-snug text-fg-muted italic">
          {side.sentence}
        </p>
      )}
    </div>
  );
}

export function ContrastEditor({ pair, onAdded, requestDeps = defaultContrastDeps }: ContrastEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const key = [pair.a.note_id, pair.a.sense_id, pair.b.note_id, pair.b.sense_id].join(':');
  const draft = useLiveQuery(() => getContrastDraft(pair).catch(() => null), [key]);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<ContrastRequestError | 'ready' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The shared difference fills the field until the user types.
  const shared = draft?.difference ?? null;
  const value = touched ? text : (shared ?? '');

  if (draft === undefined) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (draft === null) return <p className="text-sm text-fg-muted">{t('leech.gone')}</p>;

  const ask = async () => {
    setAsking(true);
    setNote(null);
    const res = await requestContrast(draft, requestDeps);
    setAsking(false);
    setNote(res.ok ? 'ready' : res.error);
  };

  const add = async () => {
    const clean = value.trim();
    if (!clean) return setError(t('leech.contrast.emptyText'));
    if (clean.length > MAX_CONTRAST_TEXT) return setError(t('leech.contrast.tooLong', { max: MAX_CONTRAST_TEXT }));
    setSaving(true);
    try {
      const created = await createContrastCard({
        a: { note_id: draft.a.note_id, sense_id: draft.a.sense_id, sentence: draft.a.sentence, sentence_tr: draft.a.sentence_tr },
        b: { note_id: draft.b.note_id, sense_id: draft.b.sense_id, sentence: draft.b.sentence, sentence_tr: draft.b.sentence_tr },
        difference: clean,
        shared_id: draft.shared_id,
      });
      toast({ title: t('leech.contrast.added'), description: t('leech.contrast.addedBody'), tone: 'success' });
      onAdded?.(created.id);
    } catch (e) {
      if (!(e instanceof ActionError)) void logError(e, 'leech.contrast.add');
      // invalid_input here: "a ↔ b" or a sentence is over a server limit; trying again won't help.
      if (e instanceof ActionError && e.code === 'invalid_input') setError(t('leech.contrast.termTooLong'));
      else toast({ title: t('leech.contrast.saveFailed'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const status = note === 'ready' ? t('leech.contrast.ready') : note ? t(errorKey[note]) : null;
  const canAsk = draft.can_ask && !shared && !draft.existing_note_id;

  return (
    <div className="flex flex-col gap-4" data-testid="contrast-editor">
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <Side side={draft.a} />
        <Side side={draft.b} />
      </div>
      {draft.existing_note_id ? (
        <p role="status" className="text-[0.9375rem] text-fg-muted">
          {t('leech.contrast.existing')}
        </p>
      ) : (
        <>
          <TextArea
            id={`${id}-difference`}
            label={t('leech.contrast.differenceLabel')}
            hint={t('leech.contrast.differenceHint')}
            error={error ?? undefined}
            rows={3}
            lang="tr"
            maxLength={MAX_CONTRAST_TEXT}
            value={value}
            onChange={(e) => {
              setTouched(true);
              setError(null);
              setText(e.target.value);
            }}
          />
          {(canAsk || !draft.can_ask) && !shared && (
            <div className="flex flex-col gap-2">
              {canAsk && (
                <Button variant="secondary" className="self-start" loading={asking} onClick={() => void ask()}>
                  {asking ? t('leech.contrast.asking') : t('leech.contrast.ask')}
                </Button>
              )}
              {!draft.can_ask && <p className="text-sm text-fg-muted">{t('leech.contrast.noLexicon')}</p>}
            </div>
          )}
          <p role="status" aria-live="polite" className="min-h-0 text-sm text-fg-muted empty:hidden">
            {status}
          </p>
          <Button fullWidth loading={saving} onClick={() => void add()}>
            {t('leech.contrast.add')}
          </Button>
        </>
      )}
    </div>
  );
}
