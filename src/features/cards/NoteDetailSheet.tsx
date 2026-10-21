import { useLiveQuery } from 'dexie-react-hooks';
import { useNow } from '@/features/settings/useNow';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionError,
  addNoteWithSenses,
  editNote,
  editSense,
  getNoteDetail,
  logError,
  setSuspended,
  softDeleteNote,
  softDeleteSense,
  type NoteDetail,
} from '@/data';
import type { Card, Sense, TermType } from '@/domain/types';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  IconButton,
  SegmentedControl,
  Surface,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@/ui';
import { ConfirmDialog } from './ConfirmDialog';
import { cardTypeLabel, posLabel, stateKey } from './labels';
import { senseText } from './libraryFilter';
import { locateTerm } from './locateTerm';
import { SentencePreview } from './SentencePreview';
import { TagInput } from './TagInput';

interface SenseEdit {
  meaning: string;
  sentence: string;
}

interface NewSense extends SenseEdit {
  key: string;
}

interface Draft {
  term: string;
  ipa: string;
  tags: string[];
  termType: TermType;
  senses: Record<string, SenseEdit>;
  added: NewSense[];
}

function draftFrom(d: NoteDetail): Draft {
  return {
    term: d.note.term,
    ipa: d.note.ipa ?? '',
    tags: d.note.tags,
    termType: d.note.term_type,
    senses: Object.fromEntries(
      d.senses.map((s) => [s.id, { meaning: senseText(s), sentence: s.source_sentence ?? '' }]),
    ),
    added: [],
  };
}

let newCounter = 0;

/** Detail sheet for one note: edit term, IPA, tags and senses; add/delete senses; suspend or delete the note. */
export function NoteDetailSheet({
  noteId,
  onClose,
}: {
  noteId: string | null;
  onClose: () => void;
}) {
  // useLiveQuery keeps the previous result while a new id loads, so tag results with their id.
  const result = useLiveQuery(
    async () => ({ id: noteId, detail: noteId ? await getNoteDetail(noteId) : null }),
    [noteId],
  );
  const detail = result && result.id === noteId ? result.detail : undefined;
  const live = detail && detail.note.deleted_at === null ? detail : null;
  // Keep the last content while the sheet animates out.
  const [shown, setShown] = useState<NoteDetail | null>(null);
  if (live && live !== shown) setShown(live);
  const open = !!noteId && (detail === undefined ? !!shown : !!live);
  useEffect(() => {
    if (noteId && detail === null) onClose(); // unknown id in the URL
  }, [noteId, detail, onClose]);

  const data = live ?? shown;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={data?.note.term ?? ''}
      description={data ? <DetailMeta detail={data} /> : undefined}
      className="sm:w-[min(calc(100vw-2rem),36rem)]"
    >
      {data && <DetailBody key={data.note.id} detail={data} onClose={onClose} />}
    </Dialog>
  );
}

function DetailMeta({ detail }: { detail: NoteDetail }) {
  const { t } = useTranslation();
  const date = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(detail.note.created_at);
  return <>{t('library.detail.meta', { cards: detail.cards.length, date })}</>;
}

function DetailBody({ detail, onClose }: { detail: NoteDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const { note, senses, cards } = detail;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(detail));
  const [termError, setTermError] = useState<string>();
  const [senseErrors, setSenseErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'note' } | { kind: 'sense'; sense: Sense } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  // Senses deleted or added elsewhere (sync, another tab): keep the draft in step.
  const [seenSenses, setSeenSenses] = useState(senses);
  if (seenSenses !== senses) {
    setSeenSenses(senses);
    setDraft((d) => {
      const next = { ...d.senses };
      let changed = false;
      for (const s of senses) {
        if (!next[s.id]) {
          next[s.id] = { meaning: senseText(s), sentence: s.source_sentence ?? '' };
          changed = true;
        }
      }
      for (const k of Object.keys(next)) {
        if (!senses.some((s) => s.id === k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? { ...d, senses: next } : d;
    });
  }

  const allSuspended = cards.length > 0 && cards.every((c) => c.suspended);
  const term = draft.term.trim() || note.term;

  const dirty = useMemo(() => {
    if (
      draft.term.trim() !== note.term ||
      draft.ipa.trim() !== (note.ipa ?? '') ||
      draft.termType !== note.term_type
    )
      return true;
    if (draft.tags.join('\u0000') !== note.tags.join('\u0000')) return true;
    if (draft.added.some((a) => a.meaning.trim() || a.sentence.trim())) return true;
    return senses.some((s) => {
      const e = draft.senses[s.id];
      return (
        !!e &&
        (e.meaning.trim() !== senseText(s) ||
          e.sentence.trim() !== (s.source_sentence ?? '').trim())
      );
    });
  }, [draft, note, senses]);

  const save = async () => {
    const errs: Record<string, string> = {};
    for (const s of senses)
      if (!draft.senses[s.id]?.meaning.trim()) errs[s.id] = t('cards.add.meaningRequired');
    for (const a of draft.added)
      if (a.sentence.trim() && !a.meaning.trim()) errs[a.key] = t('cards.add.meaningRequired');
    setSenseErrors(errs);
    if (!draft.term.trim()) {
      setTermError(t('cards.add.termRequired'));
      return;
    }
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const newTerm = draft.term.trim();
      const termChanged = newTerm !== note.term;
      if (
        termChanged ||
        draft.ipa.trim() !== (note.ipa ?? '') ||
        draft.termType !== note.term_type ||
        draft.tags.join('\u0000') !== note.tags.join('\u0000')
      ) {
        await editNote(note.id, {
          term: newTerm,
          ipa: draft.ipa.trim() || null,
          tags: draft.tags,
          term_type: draft.termType,
        });
      }
      for (const s of senses) {
        const e = draft.senses[s.id];
        if (!e) continue;
        const meaning = e.meaning.trim();
        const sentence = e.sentence.trim();
        const patch: Parameters<typeof editSense>[1] = {};
        if (meaning !== senseText(s)) {
          // A lexicon sense keeps the shared meaning and stores the user's wording as an override.
          if (s.lexicon_sense_id)
            patch.meaning_tr_override = meaning === s.meaning_tr ? null : meaning;
          else Object.assign(patch, { meaning_tr: meaning, meaning_tr_override: null });
        }
        if (sentence !== (s.source_sentence ?? '').trim() || (termChanged && sentence)) {
          patch.source_sentence = sentence || null;
          patch.span = sentence ? locateTerm(sentence, newTerm) : null;
        }
        if (Object.keys(patch).length) await editSense(s.id, patch);
      }
      const added = draft.added.filter((a) => a.meaning.trim());
      if (added.length) {
        await addNoteWithSenses({
          term: newTerm,
          senses: added.map((a) => ({
            meaning_tr: a.meaning.trim(),
            source_sentence: a.sentence.trim() || null,
            span: a.sentence.trim() ? locateTerm(a.sentence.trim(), newTerm) : null,
          })),
        });
      }
      toast({ title: t('library.detail.saved'), tone: 'success' });
      onClose();
    } catch (e) {
      if (e instanceof ActionError && e.code === 'duplicate_term')
        setTermError(t('library.detail.duplicateTerm'));
      else {
        void logError(e, 'NoteDetail.save');
        toast({ title: t('library.detail.saveFailed'), tone: 'danger' });
      }
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.kind === 'note') {
        await softDeleteNote(note.id);
        toast({ title: t('library.detail.noteDeleted', { term: note.term }), tone: 'neutral' });
        setConfirm(null);
        onClose();
      } else {
        await softDeleteSense(confirm.sense.id);
        setConfirm(null);
      }
    } catch (e) {
      void logError(e, 'NoteDetail.delete');
      toast({ title: t('library.detail.saveFailed'), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {note.possible_duplicate && (
        <p className="rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text">
          {t('library.detail.duplicateHint')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('cards.add.term')}
          value={draft.term}
          error={termError}
          onChange={(e) => {
            setDraft((d) => ({ ...d, term: e.target.value }));
            setTermError(undefined);
          }}
          lang="en"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <TextField
          label={t('cards.add.ipa')}
          optional
          value={draft.ipa}
          onChange={(e) => setDraft((d) => ({ ...d, ipa: e.target.value }))}
          className="font-serif"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <SegmentedControl<TermType>
        legend={t('cards.add.termType')}
        value={draft.termType}
        onValueChange={(v) => setDraft((d) => ({ ...d, termType: v }))}
        options={[
          { value: 'word', label: t('cards.termType.word') },
          { value: 'phrase', label: t('cards.termType.phrase') },
          { value: 'pattern', label: t('cards.termType.pattern') },
        ]}
      />
      <TagInput
        label={t('cards.tags.label')}
        value={draft.tags}
        onChange={(tags) => setDraft((d) => ({ ...d, tags }))}
      />

      <section aria-labelledby={`${id}-senses`} className="flex flex-col gap-3">
        <h3 id={`${id}-senses`} className="font-serif text-lg font-semibold text-fg">
          {t('cards.add.senses')}
        </h3>
        <ol className="flex flex-col gap-3">
          {senses.map((s, i) => {
            const e = draft.senses[s.id] ?? {
              meaning: senseText(s),
              sentence: s.source_sentence ?? '',
            };
            const sentence = e.sentence.trim();
            return (
              <li key={s.id}>
                <Surface tone="flat" padding="sm" className="flex flex-col gap-3 px-4">
                  <div className="-mb-1 flex items-center justify-between gap-2">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-fg-muted">
                      <span className="tabular font-serif text-base font-semibold text-fg">
                        {i + 1}.
                      </span>
                      {[s.pos && posLabel(t, s.pos), s.gloss_en].filter(Boolean).join(' · ') ||
                        t('cards.add.senseN')}
                    </p>
                    <IconButton
                      icon="trash"
                      size="sm"
                      label={t('library.detail.deleteSense', { n: i + 1 })}
                      disabled={senses.length === 1}
                      onClick={() => setConfirm({ kind: 'sense', sense: s })}
                      className="-mr-2"
                    />
                  </div>
                  <TextField
                    label={t('cards.add.meaning')}
                    value={e.meaning}
                    error={senseErrors[s.id]}
                    hint={
                      s.lexicon_sense_id && e.meaning.trim() !== s.meaning_tr
                        ? t('library.detail.lexiconMeaning', { meaning: s.meaning_tr })
                        : undefined
                    }
                    onChange={(ev) =>
                      setDraft((d) => ({
                        ...d,
                        senses: { ...d.senses, [s.id]: { ...e, meaning: ev.target.value } },
                      }))
                    }
                  />
                  <TextArea
                    label={t('cards.add.sentence')}
                    optional
                    rows={2}
                    value={e.sentence}
                    lang="en"
                    className="min-h-16 font-serif"
                    onChange={(ev) =>
                      setDraft((d) => ({
                        ...d,
                        senses: { ...d.senses, [s.id]: { ...e, sentence: ev.target.value } },
                      }))
                    }
                  />
                  {sentence && (
                    <SentencePreview sentence={sentence} span={locateTerm(sentence, term)} />
                  )}
                </Surface>
              </li>
            );
          })}
          {draft.added.map((a, j) => (
            <li key={a.key}>
              <Surface tone="flat" padding="sm" className="flex flex-col gap-3 border-dashed px-4">
                <div className="-mb-1 flex items-center justify-between gap-2">
                  <p className="flex items-baseline gap-2 text-sm text-fg-muted">
                    <span className="tabular font-serif text-base font-semibold text-fg">
                      {senses.length + j + 1}.
                    </span>
                    {t('library.detail.newSense')}
                  </p>
                  <IconButton
                    icon="x"
                    size="sm"
                    label={t('cards.add.removeSense', { n: senses.length + j + 1 })}
                    onClick={() =>
                      setDraft((d) => ({ ...d, added: d.added.filter((x) => x.key !== a.key) }))
                    }
                    className="-mr-2"
                  />
                </div>
                <TextField
                  id={`${id}-${a.key}`}
                  label={t('cards.add.meaning')}
                  value={a.meaning}
                  error={senseErrors[a.key]}
                  onChange={(ev) =>
                    setDraft((d) => ({
                      ...d,
                      added: d.added.map((x) =>
                        x.key === a.key ? { ...x, meaning: ev.target.value } : x,
                      ),
                    }))
                  }
                />
                <TextArea
                  label={t('cards.add.sentence')}
                  optional
                  rows={2}
                  value={a.sentence}
                  lang="en"
                  className="min-h-16 font-serif"
                  onChange={(ev) =>
                    setDraft((d) => ({
                      ...d,
                      added: d.added.map((x) =>
                        x.key === a.key ? { ...x, sentence: ev.target.value } : x,
                      ),
                    }))
                  }
                />
                {a.sentence.trim() && (
                  <SentencePreview
                    sentence={a.sentence.trim()}
                    span={locateTerm(a.sentence.trim(), term)}
                  />
                )}
              </Surface>
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          leadingIcon="plus"
          className="self-start"
          onClick={() => {
            const key = `n${++newCounter}`;
            setDraft((d) => ({ ...d, added: [...d.added, { key, meaning: '', sentence: '' }] }));
            requestAnimationFrame(() => document.getElementById(`${id}-${key}`)?.focus());
          }}
        >
          {t('cards.add.addSense')}
        </Button>
      </section>

      <section aria-labelledby={`${id}-cards`} className="flex flex-col gap-2">
        <h3 id={`${id}-cards`} className="font-serif text-lg font-semibold text-fg">
          {t('library.detail.cards')}
        </h3>
        <CardList cards={cards} senses={senses} />
        <Switch
          label={t('library.detail.suspendNote')}
          description={t('library.detail.suspendHint')}
          checked={allSuspended}
          onCheckedChange={(v) => {
            setSuspended({ note_id: note.id }, v).catch((e: unknown) => {
              void logError(e, 'NoteDetail.suspend');
              toast({ title: t('library.detail.saveFailed'), tone: 'danger' });
            });
          }}
        />
      </section>

      <div className="border-t border-border pt-4">
        <Button
          variant="ghost"
          leadingIcon="trash"
          className="-ml-2 text-danger-text"
          onClick={() => setConfirm({ kind: 'note' })}
        >
          {t('library.detail.deleteNote')}
        </Button>
      </div>

      {/* Sticky action row: Kaydet stays in reach while scrolling a long note. */}
      <div className="sticky bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] z-10 -mx-5 -mt-2 grid grid-cols-2 gap-2 border-t border-border bg-surface-raised px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-[-1.5rem] sm:-mx-6 sm:flex sm:justify-end sm:px-6 sm:pb-6">
        <DialogClose asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === 'sense'
            ? t('library.detail.deleteSenseTitle', { meaning: senseText(confirm.sense) })
            : t('library.detail.deleteNoteTitle', { term: note.term })
        }
        description={
          confirm?.kind === 'sense' ? t('library.detail.deleteSenseBody') : t('library.deleteBody')
        }
        confirmLabel={t('common.delete')}
        busy={deleting}
        onConfirm={doDelete}
      />
    </div>
  );
}

const STATE_TONE = {
  new: 'neutral',
  learning: 'accent',
  review: 'success',
  relearning: 'warn',
} as const;

function CardList({ cards, senses }: { cards: Card[]; senses: Sense[] }) {
  const { t } = useTranslation();
  const order = { recognition: 0, production: 1, cloze: 2 } as const;
  const senseNo = new Map(senses.map((s, i) => [s.id, i + 1]));
  const sorted = [...cards].sort(
    (a, b) =>
      order[a.card_type] - order[b.card_type] ||
      (senseNo.get(a.sense_id ?? '') ?? 0) - (senseNo.get(b.sense_id ?? '') ?? 0),
  );
  const now = useNow();
  const rel = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  const due = (c: Card) => {
    if (c.state === 0) return null;
    const days = Math.round((c.due - now) / 86_400_000);
    return days <= 0
      ? t('library.detail.dueNow')
      : t('library.detail.due', { when: rel.format(days, 'day') });
  };
  return (
    <ul className="divide-y divide-border rounded-card border border-border">
      {sorted.map((c) => {
        const n = c.sense_id ? senseNo.get(c.sense_id) : null;
        const d = due(c);
        return (
          <li
            key={c.id}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="flex-1 text-fg">
              {cardTypeLabel(t, c.card_type)}
              {n ? (
                <span className="text-fg-muted"> · {t('library.detail.senseRef', { n })}</span>
              ) : null}
            </span>
            {d && <span className="tabular text-fg-muted">{d}</span>}
            {!c.unlocked && <Badge tone="outline">{t('library.detail.locked')}</Badge>}
            {c.suspended && <Badge tone="outline">{t('cards.suspended')}</Badge>}
            <Badge tone={STATE_TONE[stateKey(c.state)]} dot>
              {t(`cards.state.${stateKey(c.state)}`)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
