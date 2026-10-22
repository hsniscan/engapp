// "Bu karta başka yoldan bakalım" (v0.3 İP6): ways to study a card the learner keeps
// forgetting. Every path is the user's choice; the app never suspends, resets or deletes a
// card on its own. Split and reset only change cards (review logs stay as they are).
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConfusables,
  getContrastCard,
  hideConfusablePair,
  logError,
  resetCard,
  saveContrastText,
  setSuspended,
  splitSenses,
  undoLeechAction,
  type LeechSheetData,
} from '@/data';
import { MAX_CONTRAST_TEXT, type ConfusablePair } from '@/domain/confusables';
import { familyOf, morphemeOfNote, wordInfo } from '@/domain/morphology';
import type { Id } from '@/domain/types';
import { ExamplesSection, type ExamplesSpeech } from '@/features/examples/ExamplesPanel';
import { FamilySection } from '@/features/family/FamilySection';
import { useMorphology, useUserWords } from '@/features/family/hooks';
import { ImageSection } from '@/features/images/ImageSection';
import { MnemonicSection } from '@/features/mnemonics';
import { Button, cn, Dialog, Icon, TextArea, toast, type IconName } from '@/ui';
import { ConfusionPicker, ReportedNote } from './ConfusionPicker';
import { ContrastEditor } from './ContrastEditor';
import { familyIdOf, useLeechSheet } from './hooks';

type View =
  | { kind: 'paths' }
  | { kind: 'picker' }
  | { kind: 'reported'; pair: ConfusablePair }
  | { kind: 'contrast'; pair: Pick<ConfusablePair, 'a' | 'b'> };

export interface LeechSheetProps {
  /** The card the sheet is about; null closes it. */
  cardId: Id | null;
  onOpenChange: (open: boolean) => void;
  /** Start on the confusion picker (after an Again answer). */
  startWith?: 'paths' | 'picker';
  /** The card was suspended by a path (split, reset, suspend): a review session moves on. */
  onCardSuspended?: (cardId: Id) => void;
  /** Cards came back or were added (undo, split, reset): a review session reloads its queue. */
  onCardsChanged?: () => void;
  speech?: ExamplesSpeech;
}

export function LeechSheet({ cardId, onOpenChange, startWith = 'paths', onCardSuspended, onCardsChanged, speech }: LeechSheetProps) {
  const { t } = useTranslation();
  const data = useLeechSheet(cardId);
  // A new card (or a new opening) starts on the requested view.
  const viewKey = `${cardId}:${startWith}`;
  const [viewState, setViewState] = useState<{ key: string; view: View }>({ key: viewKey, view: { kind: startWith } });
  const view: View = viewState.key === viewKey ? viewState.view : { kind: startWith };
  const setView = (v: View) => setViewState({ key: viewKey, view: v });

  const term = data?.note.term ?? '';
  let title: ReactNode = t('leech.sheetTitle');
  let description: ReactNode = data
    ? data.lapses > 0
      ? t('leech.sheetLead', { term, count: data.lapses })
      : t('leech.sheetLeadCalm', { term })
    : null;
  if (view.kind === 'picker' || view.kind === 'reported') {
    title = t('leech.picker.title');
    description = t('leech.picker.description', { term });
  } else if (view.kind === 'contrast') {
    title = t('leech.contrast.title');
    description = t('leech.contrast.description', { a: view.pair.a.term, b: view.pair.b.term });
  }

  const back =
    view.kind !== 'paths' && startWith === 'paths' ? (
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => setView({ kind: 'paths' })}>
        {t('common.back')}
      </Button>
    ) : null;

  return (
    <Dialog open={cardId !== null} onOpenChange={onOpenChange} title={title} description={description} variant="sheet">
      <div className="flex flex-col gap-3" data-testid="leech-sheet">
        {back}
        {data === undefined ? null : data === null ? (
          <p className="text-sm text-fg-muted">{t('leech.gone')}</p>
        ) : view.kind === 'paths' ? (
          <Paths
            data={data}
            speech={speech}
            onPicker={() => setView({ kind: 'picker' })}
            onContrast={(pair) => setView({ kind: 'contrast', pair })}
            onSuspended={(id) => {
              onOpenChange(false);
              onCardSuspended?.(id);
            }}
            onCardsChanged={onCardsChanged}
          />
        ) : view.kind === 'picker' ? (
          <ConfusionPicker
            noteId={data.note.id}
            senseId={data.card.sense_id ?? data.cardSenses[0]?.id ?? null}
            onReported={(pair) => setView({ kind: 'reported', pair })}
          />
        ) : view.kind === 'reported' ? (
          <ReportedNote
            pair={view.pair}
            onContrast={() => setView({ kind: 'contrast', pair: view.pair })}
            onUndone={() => setView({ kind: 'picker' })}
          />
        ) : (
          <ContrastEditor pair={view.pair} onAdded={() => onOpenChange(false)} />
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ paths

interface PathProps {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Path({ id, icon, title, body, open, onToggle, children }: PathProps) {
  const base = useId();
  const panel = `${base}-${id}`;
  return (
    <li className="rounded-card border border-border bg-surface" data-path={id}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
          className="flex min-h-14 w-full items-start gap-3 rounded-card px-3 py-3 text-left hover:bg-surface-sunken"
        >
          <Icon name={icon} className="mt-0.5 shrink-0 text-accent-text" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium text-fg">{title}</span>
            <span className="text-sm text-fg-muted">{body}</span>
          </span>
          <span aria-hidden="true" className={cn('mt-0.5 text-fg-muted transition-transform', open && 'rotate-180')}>
            ▾
          </span>
        </button>
      </h3>
      {open && (
        <div id={panel} className="flex flex-col gap-3 border-t border-border px-3 pt-3 pb-4">
          {children}
        </div>
      )}
    </li>
  );
}

function Paths({
  data,
  speech,
  onPicker,
  onContrast,
  onSuspended,
  onCardsChanged,
}: {
  data: LeechSheetData;
  speech?: ExamplesSpeech;
  onPicker: () => void;
  onContrast: (pair: Pick<ConfusablePair, 'a' | 'b'>) => void;
  onSuspended: (cardId: Id) => void;
  onCardsChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const { note, card, cardSenses } = data;
  const index = useMorphology();
  const words = useUserWords();
  const type = note.term_type;
  const isContrast = type === 'contrast';
  const hasFamily =
    !!index &&
    (type === 'affix'
      ? !!morphemeOfNote(index, note.term_norm)
      : !isContrast &&
        (!!familyOf(index, note.term_norm, words?.terms ?? new Set()) || !!wordInfo(index, note.term_norm)?.morphemes.length));
  const toggle = (id: string) => () => setOpen((o) => (o === id ? null : id));

  const paths: PathProps[] = [];
  if (isContrast) {
    paths.push({
      id: 'difference',
      icon: 'pencil',
      title: t('leech.paths.difference'),
      body: t('leech.paths.differenceBody'),
      open: open === 'difference',
      onToggle: toggle('difference'),
      children: <DifferenceEditor noteId={note.id} />,
    });
  }
  if (!isContrast && type !== 'affix' && cardSenses.length > 0) {
    paths.push({
      id: 'mnemonic',
      icon: 'heart',
      title: t('leech.paths.mnemonic'),
      body: t('leech.paths.mnemonicBody'),
      open: open === 'mnemonic',
      onToggle: toggle('mnemonic'),
      children: <MnemonicSection termNorm={note.term_norm} senses={cardSenses} />,
    });
  }
  if (!isContrast && type !== 'affix' && cardSenses.some((s) => s.lexicon_sense_id)) {
    // v0.4 İP3: the picture of the sense, or "Görsel üret" when it has none.
    paths.push({
      id: 'image',
      icon: 'image',
      title: t('images.leech.title'),
      body: t('images.leech.body'),
      open: open === 'image',
      onToggle: toggle('image'),
      children: <ImageSection senses={cardSenses.filter((s) => s.lexicon_sense_id)} initialSenseId={card.sense_id} bare />,
    });
  }
  if (!isContrast && cardSenses.some((s) => s.lexicon_sense_id)) {
    paths.push({
      id: 'examples',
      icon: 'file',
      title: t('leech.paths.examples'),
      body: t('leech.paths.examplesBody'),
      open: open === 'examples',
      onToggle: toggle('examples'),
      children: <ExamplesSection term={note.term} senses={cardSenses} initialSenseId={card.sense_id} speech={speech} />,
    });
  }
  if (hasFamily) {
    paths.push({
      id: 'family',
      icon: 'layers',
      title: t('leech.paths.family'),
      body: t('leech.paths.familyBody'),
      open: open === 'family',
      onToggle: toggle('family'),
      children: <FamilySection note={note} />,
    });
  }
  if (!isContrast && type !== 'affix') {
    paths.push({
      id: 'confusion',
      icon: 'search',
      title: t('leech.paths.confusion'),
      body: t('leech.paths.confusionBody'),
      open: open === 'confusion',
      onToggle: toggle('confusion'),
      children: <ConfusionPath noteId={note.id} onPicker={onPicker} onContrast={onContrast} />,
    });
  }
  if (data.canSplit) {
    paths.push({
      id: 'split',
      icon: 'cards',
      title: t('leech.paths.split'),
      body: t('leech.paths.splitBody', { count: data.splitSenseIds.length }),
      open: open === 'split',
      onToggle: toggle('split'),
      children: <SplitPath cardId={card.id} onSuspended={onSuspended} onCardsChanged={onCardsChanged} />,
    });
  }
  paths.push({
    id: 'restart',
    icon: 'refresh',
    title: t('leech.paths.restart'),
    body: t('leech.paths.restartBody'),
    open: open === 'restart',
    onToggle: toggle('restart'),
    children: <RestartPath cardId={card.id} suspended={card.suspended} onSuspended={onSuspended} onCardsChanged={onCardsChanged} />,
  });

  return (
    <>
      <ul className="flex flex-col gap-2" aria-label={t('leech.sheetTitle')}>
        {paths.map((p) => (
          <Path key={p.id} {...p} />
        ))}
      </ul>
      <p className="flex items-start gap-2 text-sm text-fg-muted">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
        <span>{t('leech.safeNote')}</span>
      </p>
    </>
  );
}

function ConfusionPath({
  noteId,
  onPicker,
  onContrast,
}: {
  noteId: Id;
  onPicker: () => void;
  onContrast: (pair: Pick<ConfusablePair, 'a' | 'b'>) => void;
}) {
  const { t } = useTranslation();
  const index = useMorphology();
  const familyIdKey = index ? 1 : 0;
  const pairs = useLiveQuery(
    () => getConfusables({ noteId, limit: 5, familyOf: familyIdOf(index) }).then((v) => v.pairs),
    [noteId, familyIdKey],
  );
  return (
    <>
      {pairs && pairs.length > 0 && <PairList pairs={pairs} onContrast={onContrast} />}
      <Button variant="secondary" leadingIcon="search" className="self-start" onClick={onPicker}>
        {t('leech.afterAgain.confusedAction')}
      </Button>
    </>
  );
}

/** Suggested pairs: "Fark kartı yap" and "Önerme". Shared by the sheet and the Stats list. */
export function PairList({
  pairs,
  onContrast,
}: {
  pairs: readonly ConfusablePair[];
  onContrast: (pair: ConfusablePair) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {pairs.map((p) => (
        <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span lang="en" className="font-serif text-lg font-semibold break-words text-fg">
              {p.a.term} <span className="text-fg-muted">↔</span> {p.b.term}
            </span>
            <span className="text-sm text-fg-muted">{t(`leech.contrast.reason.${p.reason}`)}</span>
          </span>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => onContrast(p)}>
              {t('leech.contrast.make')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void hideConfusablePair(p)
                  .then(() => toast({ title: t('leech.contrast.hidden') }))
                  .catch((e: unknown) => void logError(e, 'leech.hidePair'));
              }}
            >
              {t('leech.contrast.hide')}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function SplitPath({
  cardId,
  onSuspended,
  onCardsChanged,
}: {
  cardId: Id;
  onSuspended: (cardId: Id) => void;
  onCardsChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      className="self-start"
      loading={busy}
      onClick={() => {
        setBusy(true);
        splitSenses(cardId)
          .then((created) => {
            onSuspended(cardId);
            onCardsChanged?.();
            toast({
              title: t('leech.splitDone'),
              description: t('leech.splitDoneBody', { count: created.length }),
              action: {
                label: t('common.undo'),
                onClick: () =>
                  void undoLeechAction(cardId, created).then(() => {
                    toast({ title: t('leech.undone') });
                    onCardsChanged?.();
                  }),
              },
            });
          })
          .catch((e: unknown) => {
            void logError(e, 'leech.split');
            toast({ title: t('leech.failed'), tone: 'danger' });
          })
          .finally(() => setBusy(false));
      }}
    >
      {t('leech.split')}
    </Button>
  );
}

function RestartPath({
  cardId,
  suspended,
  onSuspended,
  onCardsChanged,
}: {
  cardId: Id;
  suspended: boolean;
  onSuspended: (cardId: Id) => void;
  onCardsChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => {
    void logError(e, 'leech.restart');
    toast({ title: t('leech.failed'), tone: 'danger' });
  };

  const suspend = () => {
    setBusy(true);
    setSuspended({ card_ids: [cardId] }, true)
      .then(() => {
        onSuspended(cardId);
        toast({
          title: t('leech.suspended'),
          description: t('leech.suspendedBody'),
          action: {
            label: t('common.undo'),
            onClick: () =>
              void setSuspended({ card_ids: [cardId] }, false).then(() => {
                toast({ title: t('leech.undone') });
                onCardsChanged?.();
              }),
          },
        });
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const reset = () => {
    setBusy(true);
    resetCard(cardId)
      .then((copy) => {
        onSuspended(cardId);
        onCardsChanged?.();
        toast({
          title: t('leech.resetDone'),
          description: t('leech.resetDoneBody'),
          action: {
            label: t('common.undo'),
            onClick: () =>
              void undoLeechAction(cardId, [copy.id]).then(() => {
                toast({ title: t('leech.undone') });
                onCardsChanged?.();
              }),
          },
        });
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  if (confirm) {
    return (
      <div className="flex flex-col gap-3 rounded-control bg-surface-sunken p-3" role="group" aria-label={t('leech.resetConfirmTitle')}>
        <p className="font-medium text-fg">{t('leech.resetConfirmTitle')}</p>
        <p className="text-sm text-fg-muted">{t('leech.resetConfirmBody')}</p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button variant="danger" loading={busy} onClick={reset}>
            {t('leech.reset')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {!suspended && (
        <Button variant="secondary" leadingIcon="pause" loading={busy} onClick={suspend}>
          {t('leech.suspend')}
        </Button>
      )}
      <Button variant="secondary" leadingIcon="refresh" onClick={() => setConfirm(true)}>
        {t('leech.reset')}
      </Button>
    </div>
  );
}

/** A contrast card's difference line, edited in the user's own table. */
export function DifferenceEditor({ noteId, onSaved }: { noteId: Id; onSaved?: () => void }) {
  const { t } = useTranslation();
  const view = useLiveQuery(() => getContrastCard(noteId), [noteId]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!view) return null;
  const value = text ?? view.difference ?? '';
  const save = () => {
    const clean = value.trim();
    if (!clean) return setError(t('leech.contrast.emptyText'));
    setBusy(true);
    saveContrastText(noteId, clean)
      .then(() => {
        toast({ title: t('leech.contrast.saved'), tone: 'success' });
        onSaved?.();
      })
      .catch((e: unknown) => {
        void logError(e, 'leech.saveDifference');
        toast({ title: t('leech.contrast.saveFailed'), tone: 'danger' });
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-3">
      <TextArea
        label={t('leech.contrast.differenceLabel')}
        hint={t('leech.contrast.differenceHint')}
        error={error ?? undefined}
        rows={3}
        lang="tr"
        maxLength={MAX_CONTRAST_TEXT}
        value={value}
        onChange={(e) => {
          setError(null);
          setText(e.target.value);
        }}
      />
      <Button className="self-start" loading={busy} onClick={save}>
        {t('common.save')}
      </Button>
    </div>
  );
}
