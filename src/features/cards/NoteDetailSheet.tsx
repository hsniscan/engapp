// The word sheet (docs/design.md §4.7): opens in a calm read view (term, IPA and its voice,
// stage, meanings, examples, memory, picture, memory aids) with the word's actions; "Düzenle"
// switches the same sheet to the edit form. Reversible actions (suspend, Biliyorum, reset,
// delete) happen at once and offer "Geri al" (ADR 0063); deleting a meaning still asks.
// On-demand AI pictures and sentences are gone (ADR 0061); what is cached is still shown.
import { LIMITS } from '@/domain/limits';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNow } from '@/features/settings/useNow';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionError,
  addNoteWithSenses,
  editNote,
  editSense,
  getNoteDetail,
  listTags,
  bulkSoftDeleteNotes,
  logError,
  markNotesKnown,
  resetNoteProgress,
  restoreNotes,
  setSuspended,
  softDeleteSense,
  undoMarkNotesKnown,
  undoNoteReset,
  type NoteDetail,
} from '@/data';
import { noteStage } from '@/domain/deckFilter';
import { cardStage } from '@/domain/stages';
import { type Card as CardRow, CardState, type NoteTermType, type Sense } from '@/domain/types';
import { FalseFriendStrips } from '@/features/family/FalseFriendStrip';
import { FamilySection } from '@/features/family/FamilySection';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  Eyebrow,
  IconButton,
  SegmentedControl,
  StagePill,
  StatTile,
  Term,
  TextArea,
  TextField,
  toast,
} from '@/ui';
import { LevelSection } from '@/features/levels/LevelSection';
import { EncounterLine } from '@/features/reader/EncounterLine';
import { ExamplesSection } from '@/features/examples/ExamplesPanel';
import { ImageSection } from '@/features/images/ImageSection';
import { MnemonicSection } from '@/features/mnemonics';
import { useAppSettings } from '@/features/settings/useAppSettings';
import { useSpeech } from '@/features/review/useSpeech';
import { ConfirmDialog } from './ConfirmDialog';
import { cardTypeLabel, posLabel } from './labels';
import { senseText } from './libraryFilter';
import { locateTerm } from './locateTerm';
import { SentencePreview } from './SentencePreview';
import { SheetActions } from './SheetActions';
import { TagInput } from './TagInput';

interface SenseEdit {
  meaning: string;
  sentence: string;
  sentenceTr: string;
}

const senseEdit = (s: Sense): SenseEdit => ({
  meaning: senseText(s),
  sentence: s.source_sentence ?? '',
  sentenceTr: s.source_sentence_tr ?? '',
});

interface NewSense extends SenseEdit {
  key: string;
}

interface Draft {
  term: string;
  ipa: string;
  tags: string[];
  termType: NoteTermType;
  senses: Record<string, SenseEdit>;
  added: NewSense[];
}

function draftFrom(d: NoteDetail): Draft {
  return {
    term: d.note.term,
    ipa: d.note.ipa ?? '',
    tags: d.note.tags,
    termType: d.note.term_type,
    senses: Object.fromEntries(d.senses.map((s) => [s.id, senseEdit(s)])),
    added: [],
  };
}

let newCounter = 0;

type Mode = 'read' | 'edit';

/** The word sheet for one note: read view first, "Düzenle" for the edit form. */
export function NoteDetailSheet({
  noteId,
  startInEdit = false,
  onClose,
}: {
  noteId: string | null;
  /** Open straight in the edit form (the row menu's "Düzenle"); saving then closes the sheet. */
  startInEdit?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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

  // Read or edit, chosen again whenever another word opens.
  const [mode, setMode] = useState<Mode>(startInEdit ? 'edit' : 'read');
  const [modeFor, setModeFor] = useState({ noteId, startInEdit });
  if (modeFor.noteId !== noteId || modeFor.startInEdit !== startInEdit) {
    setModeFor({ noteId, startInEdit });
    if (noteId) setMode(startInEdit ? 'edit' : 'read');
  }

  const data = live ?? shown;
  // Unsaved edits: Escape, the ✕, Vazgeç or a tap outside ask before throwing them away (B4).
  const dirty = useRef(false);
  const [ask, setAsk] = useState<null | 'close' | 'read'>(null);
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  const leaveEdit = () => (startInEdit ? onClose() : setMode('read'));
  const requestClose = () => {
    if (mode === 'edit' && dirty.current) setAsk('close');
    else onClose();
  };
  const requestRead = () => {
    if (dirty.current) setAsk('read');
    else leaveEdit();
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && requestClose()}
        title={data ? <Term size="title">{data.note.term}</Term> : ''}
        description={
          data ? (
            mode === 'edit' ? (
              <DetailMeta detail={data} />
            ) : data.note.ipa ? (
              <span className="font-serif">{data.note.ipa}</span>
            ) : undefined
          ) : undefined
        }
        className="sm:w-[min(calc(100vw-2rem),36rem)]"
      >
        {data &&
          (mode === 'read' ? (
            <ReadView key={data.note.id} detail={data} onEdit={() => setMode('edit')} onClose={onClose} />
          ) : (
            <EditBody
              key={data.note.id}
              detail={data}
              onSaved={leaveEdit}
              onCancel={requestRead}
              onDirty={setDirty}
            />
          ))}
      </Dialog>
      <ConfirmDialog
        open={ask !== null}
        onOpenChange={(o) => !o && setAsk(null)}
        title={t('library.detail.discardTitle')}
        description={t('library.detail.discardBody')}
        confirmLabel={t('library.detail.discard')}
        cancelLabel={t('library.detail.keepEditing')}
        onConfirm={() => {
          const then = ask;
          setAsk(null);
          dirty.current = false;
          if (then === 'close') onClose();
          else leaveEdit();
        }}
      />
    </>
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

/** The card the word's stage and memory come from: its unsuspended recognition card. */
function mainCard(cards: readonly CardRow[]): CardRow | undefined {
  const live = cards.filter((c) => c.deleted_at === null);
  return (
    live.find((c) => c.card_type === 'recognition' && !c.suspended) ??
    live.find((c) => !c.suspended) ??
    live[0]
  );
}

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });

// ------------------------------------------------------------------------------- read view

function ReadView({
  detail,
  onEdit,
  onClose,
}: {
  detail: NoteDetail;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { note, senses, cards } = detail;
  const speech = useSpeech(useAppSettings().settings?.voice ?? 'en-US');
  const now = useNow();
  const stage = noteStage(detail);
  const allSuspended = cards.length > 0 && cards.every((c) => c.suspended);
  const main = mainCard(cards);
  const pos = senses.find((s) => s.pos)?.pos ?? null;
  const ownSentences = senses.filter((s) => s.source_sentence?.trim());
  const failed = (e: unknown, where: string) => {
    void logError(e, where);
    toast({ title: t('library.detail.saveFailed'), tone: 'danger' });
  };

  const suspend = (on: boolean) =>
    setSuspended({ note_id: note.id }, on).then(
      () =>
        toast.undo({
          title: on
            ? t('library.row.suspended', { term: note.term })
            : t('library.row.unsuspended', { term: note.term }),
          undoLabel: t('ui.undo'),
          onUndo: () =>
            void setSuspended({ note_id: note.id }, !on).catch((e: unknown) =>
              logError(e, 'NoteDetail.suspendUndo'),
            ),
        }),
      (e: unknown) => failed(e, 'NoteDetail.suspend'),
    );

  const markKnown = async () => {
    try {
      const res = await markNotesKnown([note.id]);
      toast.undo({
        title: t('library.detail.knownDone', { term: note.term }),
        undoLabel: t('ui.undo'),
        onUndo: () =>
          void undoMarkNotesKnown(res).catch((e) => logError(e, 'NoteDetail.knownUndo')),
      });
      onClose();
    } catch (e) {
      failed(e, 'NoteDetail.known');
    }
  };

  const reset = async () => {
    try {
      const res = await resetNoteProgress(note.id);
      toast.undo({
        title: t('library.detail.resetDone', { term: note.term }),
        undoLabel: t('ui.undo'),
        onUndo: () => void undoNoteReset(res).catch((e) => logError(e, 'NoteDetail.resetUndo')),
      });
    } catch (e) {
      failed(e, 'NoteDetail.reset');
    }
  };

  const remove = async () => {
    try {
      const res = await bulkSoftDeleteNotes([note.id]);
      toast.undo({
        title: t('library.detail.noteDeleted', { term: note.term }),
        undoLabel: t('ui.undo'),
        onUndo: () =>
          void restoreNotes(res.ids, res.at).catch((e) => logError(e, 'NoteDetail.undo')),
      });
      onClose();
    } catch (e) {
      failed(e, 'NoteDetail.delete');
    }
  };

  const dueText = (() => {
    if (!main || main.state === CardState.New) return t('library.detail.notStudied');
    const days = Math.round((main.due - now) / 86_400_000);
    return days <= 0 ? t('library.detail.dueNow') : rtf.format(days, 'day');
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {allSuspended ? (
            <Badge tone="outline">{t('cards.suspended')}</Badge>
          ) : (
            stage && <StagePill stage={stage} />
          )}
          {pos && <Badge tone="outline">{posLabel(t, pos)}</Badge>}
        </div>
        {speech.available && (
          <IconButton
            icon="speaker"
            variant="tonal"
            label={t('library.detail.listen', { term: note.term })}
            onClick={() => speech.speak(note.term)}
          />
        )}
      </div>

      {note.possible_duplicate && (
        <Card tone="sunken" padding="sm" className="px-4 text-meta text-warn-text">
          {t('library.detail.duplicateHint')}
        </Card>
      )}
      <FalseFriendStrips term={note.term_norm} className="max-w-none" />

      <section aria-labelledby={`${id}-meaning`} className="flex flex-col gap-2">
        <Eyebrow as="h3" className="sr-only">
          <span id={`${id}-meaning`}>{t('library.detail.meaning')}</span>
        </Eyebrow>
        {senses.length === 0 ? (
          <p className="text-ui text-fg-subtle italic">{t('library.noSenses')}</p>
        ) : senses.length === 1 ? (
          <p className="text-heading font-semibold text-fg">{senseText(senses[0]!)}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {senses.map((s, i) => (
              <li key={s.id} className="flex items-baseline gap-2">
                <span className="tabular text-ui font-semibold text-fg-muted">{i + 1}.</span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-title font-semibold text-fg">{senseText(s)}</span>
                  {s.pos && <span className="text-meta text-fg-muted">{posLabel(t, s.pos)}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {ownSentences.length > 0 && (
        <section aria-labelledby={`${id}-own`} className="flex flex-col gap-3">
          <Eyebrow as="h3">
            <span id={`${id}-own`}>{t('library.detail.ownExample')}</span>
          </Eyebrow>
          <ul className="flex flex-col gap-3">
            {ownSentences.map((s) => (
              <li key={s.id} className="flex items-start gap-2">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Term italic className="text-fg">
                    {s.source_sentence}
                  </Term>
                  {s.source_sentence_tr && (
                    <span className="text-ui text-fg-muted">{s.source_sentence_tr}</span>
                  )}
                </span>
                {speech.available && (
                  <IconButton
                    icon="speaker"
                    size="sm"
                    label={t('library.detail.listenSentence')}
                    onClick={() => speech.speak(s.source_sentence!)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {senses.some((s) => s.lexicon_sense_id) && (
        <ExamplesSection
          term={note.term}
          senses={senses}
          headingId={`${id}-examples`}
          speech={{ available: speech.available, speak: speech.speak }}
        />
      )}

      <Card tone="sunken" padding="sm" className="flex flex-col gap-3 px-4 py-4">
        <Eyebrow as="h3">{t('library.detail.memory')}</Eyebrow>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <StatTile bare value={<span className="text-title">{dueText}</span>} label={t('library.detail.next')} />
          <StatTile
            bare
            value={<span className="text-title">{main && main.state !== CardState.New ? main.scheduled_days : '–'}</span>}
            unit={main && main.state !== CardState.New ? t('library.detail.daysUnit') : undefined}
            label={t('library.detail.interval')}
          />
          <StatTile bare value={<span className="text-title">{main?.reps ?? 0}</span>} label={t('library.detail.reps')} />
          <StatTile bare value={<span className="text-title">{main?.lapses ?? 0}</span>} label={t('library.detail.lapses')} />
        </div>
        <EncounterLine noteId={note.id} />
      </Card>

      {senses.some((s) => s.lexicon_sense_id) &&
        note.term_type !== 'affix' &&
        note.term_type !== 'contrast' && <ImageSection senses={senses} headingId={`${id}-image`} />}
      {senses.length > 0 && note.term_type !== 'affix' && (
        <MnemonicSection termNorm={note.term_norm} senses={senses} headingId={`${id}-mnemonic`} />
      )}
      <FamilySection note={note} />
      <LevelSection detail={detail} />

      <section aria-labelledby={`${id}-cards`} className="flex flex-col gap-2">
        <h3 id={`${id}-cards`} className="text-ui font-semibold text-fg">
          {t('library.detail.cards')}
        </h3>
        <CardList cards={cards} senses={senses} />
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="secondary" leadingIcon="pencil" onClick={onEdit}>
          {t('common.edit')}
        </Button>
        {cards.length > 0 && (
          <Button
            variant="ghost"
            leadingIcon={allSuspended ? 'refresh' : 'pause'}
            onClick={() => void suspend(!allSuspended)}
          >
            {allSuspended ? t('library.bulk.unsuspend') : t('common.suspend')}
          </Button>
        )}
        <Button
          variant="ghost"
          leadingIcon="trash"
          className="text-danger-text"
          onClick={() => void remove()}
        >
          {t('library.detail.deleteNote')}
        </Button>
        <DropdownMenu
          label={t('library.detail.moreActions')}
          trigger={<IconButton icon="more" label={t('library.detail.moreActions')} className="ml-auto" />}
          items={[
            { label: t('library.detail.markKnown'), icon: 'check', onSelect: () => void markKnown() },
            ...(cards.some((c) => c.reps > 0 || c.state !== 0)
              ? [{ label: t('library.detail.reset'), icon: 'refresh' as const, onSelect: () => void reset() }]
              : []),
          ]}
        />
      </div>
      <p className="-mt-3 text-meta text-fg-muted">{t('library.detail.markKnownHint')}</p>
    </div>
  );
}

function CardList({ cards, senses }: { cards: CardRow[]; senses: Sense[] }) {
  const { t } = useTranslation();
  const order = { recognition: 0, production: 1, cloze: 2, image: 3, dictation: 4 } as const;
  const senseNo = new Map(senses.map((s, i) => [s.id, i + 1]));
  const sorted = [...cards].sort(
    (a, b) =>
      order[a.card_type] - order[b.card_type] ||
      (senseNo.get(a.sense_id ?? '') ?? 0) - (senseNo.get(b.sense_id ?? '') ?? 0),
  );
  const now = useNow();
  const due = (c: CardRow) => {
    if (c.state === 0) return null;
    const days = Math.round((c.due - now) / 86_400_000);
    return days <= 0
      ? t('library.detail.dueNow')
      : t('library.detail.due', { when: rtf.format(days, 'day') });
  };
  return (
    <ul className="divide-y divide-border rounded-card border border-border">
      {sorted.map((c) => {
        const n = c.sense_id ? senseNo.get(c.sense_id) : null;
        const d = due(c);
        return (
          <li
            key={c.id}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-meta"
          >
            <span className="flex-1 text-fg">
              {cardTypeLabel(t, c.card_type)}
              {n ? (
                <span className="text-fg-muted"> · {t('library.detail.senseRef', { n })}</span>
              ) : null}
            </span>
            {d && <span className="tabular text-fg-muted">{d}</span>}
            {!c.unlocked && <Badge tone="outline">{t('library.detail.locked')}</Badge>}
            {c.suspended ? (
              <Badge tone="outline">{t('cards.suspended')}</Badge>
            ) : (
              <StagePill stage={cardStage(c)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------------------- edit form

function EditBody({
  detail,
  onSaved,
  onCancel,
  onDirty,
}: {
  detail: NoteDetail;
  onSaved: () => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { note, senses } = detail;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(detail));
  const [termError, setTermError] = useState<string>();
  const [senseErrors, setSenseErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmSense, setConfirmSense] = useState<Sense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const knownTags = useLiveQuery(() => listTags(), []);

  // Senses deleted or added elsewhere (sync, another tab): keep the draft in step.
  const [seenSenses, setSeenSenses] = useState(senses);
  if (seenSenses !== senses) {
    setSeenSenses(senses);
    setDraft((d) => {
      const next = { ...d.senses };
      let changed = false;
      for (const s of senses) {
        if (!next[s.id]) {
          next[s.id] = senseEdit(s);
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
          e.sentence.trim() !== (s.source_sentence ?? '').trim() ||
          e.sentenceTr.trim() !== (s.source_sentence_tr ?? '').trim())
      );
    });
  }, [draft, note, senses]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

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
        const sentenceTr = e.sentenceTr.trim();
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
        if (
          patch.source_sentence !== undefined ||
          sentenceTr !== (s.source_sentence_tr ?? '').trim()
        )
          patch.source_sentence_tr = sentenceTr || null;
        if (Object.keys(patch).length) await editSense(s.id, patch);
      }
      const added = draft.added.filter((a) => a.meaning.trim());
      if (added.length) {
        await addNoteWithSenses({
          term: newTerm,
          senses: added.map((a) => ({
            meaning_tr: a.meaning.trim(),
            source_sentence: a.sentence.trim() || null,
            source_sentence_tr: a.sentenceTr.trim() || null,
            span: a.sentence.trim() ? locateTerm(a.sentence.trim(), newTerm) : null,
          })),
        });
      }
      toast({ title: t('library.detail.saved'), tone: 'success' });
      onDirty(false);
      onSaved();
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

  const deleteSense = async () => {
    if (!confirmSense) return;
    setDeleting(true);
    try {
      await softDeleteSense(confirmSense.id);
      setConfirmSense(null);
    } catch (e) {
      void logError(e, 'NoteDetail.deleteSense');
      toast({ title: t('library.detail.saveFailed'), tone: 'danger' });
    } finally {
      setDeleting(false);
    }
  };

  const setSense = (key: string, patch: Partial<SenseEdit>, base: SenseEdit) =>
    setDraft((d) => ({ ...d, senses: { ...d.senses, [key]: { ...base, ...patch } } }));
  const setAdded = (key: string, patch: Partial<SenseEdit>) =>
    setDraft((d) => ({
      ...d,
      added: d.added.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    }));

  return (
    <div className="flex flex-col gap-6">
      {note.possible_duplicate && (
        <Card tone="sunken" padding="sm" className="px-4 text-meta text-warn-text">
          {t('library.detail.duplicateHint')}
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          maxLength={LIMITS.term}
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
          maxLength={LIMITS.ipa}
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
      {note.term_type !== 'affix' && (
        <SegmentedControl<NoteTermType>
          legend={t('cards.add.termType')}
          value={draft.termType}
          onValueChange={(v) => setDraft((d) => ({ ...d, termType: v }))}
          options={[
            { value: 'word', label: t('cards.termType.word') },
            { value: 'phrase', label: t('cards.termType.phrase') },
            { value: 'pattern', label: t('cards.termType.pattern') },
          ]}
        />
      )}
      <TagInput
        label={t('cards.tags.label')}
        value={draft.tags}
        onChange={(tags) => setDraft((d) => ({ ...d, tags }))}
        suggestions={knownTags?.map((x) => x.tag)}
      />

      <section aria-labelledby={`${id}-senses`} className="flex flex-col gap-3">
        <h3 id={`${id}-senses`} className="text-ui font-semibold text-fg">
          {t('cards.add.senses')}
        </h3>
        <ol className="flex flex-col gap-3">
          {senses.map((s, i) => {
            const e = draft.senses[s.id] ?? senseEdit(s);
            const sentence = e.sentence.trim();
            return (
              <li key={s.id}>
                <Card tone="sunken" padding="sm" className="flex flex-col gap-3 px-4">
                  <div className="-mb-1 flex items-center justify-between gap-2">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-meta text-fg-muted">
                      <span className="tabular text-ui font-semibold text-fg">{i + 1}.</span>
                      {[s.pos && posLabel(t, s.pos), s.gloss_en].filter(Boolean).join(' · ') ||
                        t('cards.add.senseN')}
                    </p>
                    <IconButton
                      icon="trash"
                      size="sm"
                      label={t('library.detail.deleteSense', { n: i + 1 })}
                      disabled={senses.length === 1}
                      onClick={() => setConfirmSense(s)}
                      className="-mr-2"
                    />
                  </div>
                  <TextField
                    maxLength={LIMITS.meaning_tr}
                    label={t('cards.add.meaning')}
                    value={e.meaning}
                    error={senseErrors[s.id]}
                    hint={
                      s.lexicon_sense_id && e.meaning.trim() !== s.meaning_tr
                        ? t('library.detail.lexiconMeaning', { meaning: s.meaning_tr })
                        : undefined
                    }
                    onChange={(ev) => setSense(s.id, { meaning: ev.target.value }, e)}
                  />
                  <TextArea
                    maxLength={LIMITS.source_sentence}
                    label={t('cards.add.sentence')}
                    optional
                    rows={2}
                    value={e.sentence}
                    lang="en"
                    className="min-h-16 font-serif"
                    onChange={(ev) => setSense(s.id, { sentence: ev.target.value }, e)}
                  />
                  {sentence && (
                    <SentencePreview sentence={sentence} span={locateTerm(sentence, term)} />
                  )}
                  {sentence && (
                    <TextArea
                      label={t('cards.add.sentenceTr')}
                      optional
                      rows={2}
                      value={e.sentenceTr}
                      lang="tr"
                      className="min-h-16"
                      onChange={(ev) => setSense(s.id, { sentenceTr: ev.target.value }, e)}
                    />
                  )}
                </Card>
              </li>
            );
          })}
          {draft.added.map((a, j) => (
            <li key={a.key}>
              <Card tone="placeholder" padding="sm" className="flex flex-col gap-3 px-4">
                <div className="-mb-1 flex items-center justify-between gap-2">
                  <p className="flex items-baseline gap-2 text-meta text-fg-muted">
                    <span className="tabular text-ui font-semibold text-fg">
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
                  maxLength={LIMITS.meaning_tr}
                  id={`${id}-${a.key}`}
                  label={t('cards.add.meaning')}
                  value={a.meaning}
                  error={senseErrors[a.key]}
                  onChange={(ev) => setAdded(a.key, { meaning: ev.target.value })}
                />
                <TextArea
                  maxLength={LIMITS.source_sentence}
                  label={t('cards.add.sentence')}
                  optional
                  rows={2}
                  value={a.sentence}
                  lang="en"
                  className="min-h-16 font-serif"
                  onChange={(ev) => setAdded(a.key, { sentence: ev.target.value })}
                />
                {a.sentence.trim() && (
                  <SentencePreview
                    sentence={a.sentence.trim()}
                    span={locateTerm(a.sentence.trim(), term)}
                  />
                )}
                {a.sentence.trim() && (
                  <TextArea
                    label={t('cards.add.sentenceTr')}
                    optional
                    rows={2}
                    value={a.sentenceTr}
                    lang="tr"
                    className="min-h-16"
                    onChange={(ev) => setAdded(a.key, { sentenceTr: ev.target.value })}
                  />
                )}
              </Card>
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          leadingIcon="plus"
          className="self-start"
          onClick={() => {
            const key = `n${++newCounter}`;
            setDraft((d) => ({
              ...d,
              added: [...d.added, { key, meaning: '', sentence: '', sentenceTr: '' }],
            }));
            requestAnimationFrame(() => document.getElementById(`${id}-${key}`)?.focus());
          }}
        >
          {t('cards.add.addSense')}
        </Button>
      </section>

      {/* Kaydet stays in reach while scrolling a long note. */}
      <SheetActions>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </SheetActions>

      <ConfirmDialog
        open={confirmSense !== null}
        onOpenChange={(o) => !o && setConfirmSense(null)}
        title={
          confirmSense
            ? t('library.detail.deleteSenseTitle', { meaning: senseText(confirmSense) })
            : ''
        }
        description={t('library.detail.deleteSenseBody')}
        confirmLabel={t('common.delete')}
        busy={deleting}
        onConfirm={deleteSense}
      />
    </div>
  );
}

