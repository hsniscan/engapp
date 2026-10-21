import { LIMITS } from '@/domain/limits';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { editSense, logError, type CardView } from '@/data';
import { findSpan } from '@/domain/recognition';
import { Button, Dialog, DialogClose, TextArea, TextField, toast } from '@/ui';

export interface EditSheetProps {
  view: CardView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/** Inline edit of the shown sense: the Turkish meaning (as an override), the example sentence and its translation. */
export function EditSheet({ view, open, onOpenChange, onSaved }: EditSheetProps) {
  const { t } = useTranslation();
  const sense = view ? (view.sense ?? view.senses[0] ?? null) : null;
  return (
    <Dialog
      open={open && !!sense}
      onOpenChange={onOpenChange}
      title={t('review.editTitle')}
      description={view ? t('review.editDescription', { term: view.note.term }) : undefined}
    >
      {view && sense && (
        <EditForm
          key={sense.id + sense.updated_at}
          view={view}
          senseId={sense.id}
          onDone={() => {
            onOpenChange(false);
            onSaved();
          }}
        />
      )}
    </Dialog>
  );
}

function EditForm({
  view,
  senseId,
  onDone,
}: {
  view: CardView;
  senseId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const sense = view.senses.find((s) => s.id === senseId) ?? view.sense!;
  const [meaning, setMeaning] = useState(sense.meaning_tr_override ?? sense.meaning_tr);
  const [sentence, setSentence] = useState(sense.source_sentence ?? '');
  const [sentenceTr, setSentenceTr] = useState(sense.source_sentence_tr ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const index = view.senses.findIndex((s) => s.id === sense.id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = meaning.trim();
    if (!m) {
      setError(t('review.editMeaningRequired'));
      return;
    }
    const s = sentence.trim();
    const sentenceChanged = s !== (sense.source_sentence ?? '');
    const tr = sentenceTr.trim();
    setSaving(true);
    try {
      await editSense(sense.id, {
        meaning_tr_override: m === sense.meaning_tr ? null : m,
        ...(sentenceChanged
          ? { source_sentence: s || null, span: s ? findSpan(s, view.note.term) : null }
          : {}),
        ...(sentenceChanged || tr !== (sense.source_sentence_tr ?? '') ? { source_sentence_tr: tr || null } : {}),
      });
      toast({ title: t('review.saved'), tone: 'success' });
      onDone();
    } catch (err) {
      void logError(err, 'review:editSense');
      toast({ title: t('review.saveError'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <TextField
        label={
          view.senses.length > 1
            ? t('review.editMeaningNumbered', { n: index + 1 })
            : t('review.editMeaning')
        }
        value={meaning}
        maxLength={LIMITS.meaning_tr}
        onChange={(e) => {
          setMeaning(e.target.value);
          setError(null);
        }}
        error={error ?? undefined}
        hint={
          sense.meaning_tr_override && sense.meaning_tr !== meaning
            ? t('review.editMeaningOriginal', { meaning: sense.meaning_tr })
            : undefined
        }
        autoComplete="off"
      />
      <TextArea
        maxLength={LIMITS.source_sentence}
        label={t('review.editSentence')}
        hint={t('review.editSentenceHint')}
        optional
        lang="en"
        rows={3}
        value={sentence}
        onChange={(e) => setSentence(e.target.value)}
      />
      <TextArea
        label={t('cards.add.sentenceTr')}
        optional
        lang="tr"
        rows={2}
        value={sentenceTr}
        onChange={(e) => setSentenceTr(e.target.value)}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
