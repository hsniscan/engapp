// Create or edit a smart deck: a name and a few toggles (status, tags, when added) with a
// live count of the words the deck holds right now.
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionError, countDeckFilter, createDeck, listTags, logError, updateDeck } from '@/data';
import {
  ADDED_WITHIN_CHOICES,
  DECK_STATES,
  type DeckFilter,
  type DeckState,
  MAX_DECK_NAME,
  normalizeDeckFilter,
  parseDeckFilter,
} from '@/domain/deckFilter';
import { hasTag, sameTag } from '@/domain/tags';
import type { Deck } from '@/domain/types';
import { Button, Dialog, DialogClose, SegmentedControl, TextField, toast } from '@/ui';
import { Chip } from './Chip';

export function DeckEditorDialog({
  open,
  onOpenChange,
  deck,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: a new deck. */
  deck: Deck | null;
  onSaved?: (deck: Deck) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={deck ? t('decks.editor.titleEdit') : t('decks.editor.titleNew')}
      className="sm:w-[min(calc(100vw-2rem),34rem)]"
    >
      {open && (
        <EditorBody
          key={deck?.id ?? 'new'}
          deck={deck}
          onDone={(d) => {
            onOpenChange(false);
            onSaved?.(d);
          }}
        />
      )}
    </Dialog>
  );
}

type Added = 'any' | `${(typeof ADDED_WITHIN_CHOICES)[number]}`;

function EditorBody({ deck, onDone }: { deck: Deck | null; onDone: (d: Deck) => void }) {
  const { t } = useTranslation();
  const id = useId();
  // The filter as the dialog opened it (null: made by a newer app version).
  const [original] = useState<DeckFilter | null>(() => {
    const parsed = deck ? parseDeckFilter(deck.filter) : null;
    return parsed ? (parsed.ok ? parsed.filter : null) : { v: 1 };
  });
  const unsupported = original === null;

  const [name, setName] = useState(deck?.name ?? '');
  const [nameError, setNameError] = useState<string>();
  const [states, setStates] = useState<DeckState[]>(original?.states ?? []);
  const [tags, setTags] = useState<string[]>(original?.tags ?? []);
  const [tagMode, setTagMode] = useState<'any' | 'all'>(original?.tagMode ?? 'any');
  const [added, setAdded] = useState<Added>(
    original?.addedWithinDays &&
      (ADDED_WITHIN_CHOICES as readonly number[]).includes(original.addedWithinDays)
      ? (String(original.addedWithinDays) as Added)
      : 'any',
  );
  const [busy, setBusy] = useState(false);

  const known = useLiveQuery(() => listTags(), []);
  // Tags in the filter that no note carries any more still show (and can be turned off).
  const tagOptions = useMemo(() => {
    const list = (known ?? []).map((x) => ({ tag: x.tag, count: x.count }));
    for (const tag of original?.tags ?? [])
      if (
        !hasTag(
          list.map((x) => x.tag),
          tag,
        )
      )
        list.push({ tag, count: 0 });
    return list;
  }, [known, original?.tags]);

  const filter: DeckFilter | null = useMemo(
    () =>
      unsupported
        ? null
        : normalizeDeckFilter({
            // Keys this editor has no controls for yet (levels, topics) are kept as they were.
            ...original,
            states,
            tags,
            tagMode,
            addedWithinDays: added === 'any' ? undefined : Number(added),
          }),
    [unsupported, original, states, tags, tagMode, added],
  );
  const filterKey = JSON.stringify(filter);
  const count = useLiveQuery(
    () => (filter ? countDeckFilter(filter) : Promise.resolve(null)),
    [filterKey],
  );

  const toggleState = (s: DeckState) =>
    setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const toggleTag = (tag: string) =>
    setTags((cur) => (hasTag(cur, tag) ? cur.filter((x) => !sameTag(x, tag)) : [...cur, tag]));

  const save = async () => {
    if (!name.trim()) {
      setNameError(t('decks.editor.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      const saved = deck
        ? await updateDeck(deck.id, { name, ...(filter ? { filter } : {}) })
        : await createDeck({ name, filter: filter ?? { v: 1 } });
      toast({ title: deck ? t('decks.saved') : t('decks.created'), tone: 'success' });
      onDone(saved);
    } catch (e) {
      if (e instanceof ActionError && e.code === 'invalid_input')
        setNameError(t('decks.editor.nameRequired'));
      else {
        void logError(e, 'DeckEditor.save');
        toast({ title: t('decks.failed'), tone: 'danger' });
      }
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <TextField
        label={t('decks.editor.name')}
        placeholder={t('decks.editor.namePlaceholder')}
        value={name}
        maxLength={MAX_DECK_NAME}
        error={nameError}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(undefined);
        }}
        autoComplete="off"
      />

      {unsupported ? (
        <p className="rounded-control bg-warn-soft px-3 py-2.5 text-sm text-warn-text">
          {t('decks.editor.unsupported')}
        </p>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">{t('decks.editor.states')}</legend>
            <div className="flex flex-wrap gap-2">
              {DECK_STATES.map((s) => (
                <Chip key={s} pressed={states.includes(s)} onClick={() => toggleState(s)}>
                  {t(`decks.state.${s}`)}
                </Chip>
              ))}
            </div>
            <p className="text-sm text-fg-muted">{t('decks.editor.statesHint')}</p>
          </fieldset>

          <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-tags`}>
            <legend className="mb-1 text-sm font-medium text-fg">{t('decks.editor.tags')}</legend>
            {tagOptions.length === 0 ? (
              <p id={`${id}-tags`} className="text-sm text-fg-muted">
                {t('decks.editor.tagsNone')}
              </p>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto p-0.5">
                {tagOptions.map((x) => (
                  <Chip
                    key={x.tag}
                    pressed={hasTag(tags, x.tag)}
                    meta={x.count || undefined}
                    onClick={() => toggleTag(x.tag)}
                  >
                    #{x.tag}
                  </Chip>
                ))}
              </div>
            )}
            {tags.length > 1 && (
              <SegmentedControl
                legend={t('decks.editor.tagMode')}
                value={tagMode}
                onValueChange={setTagMode}
                options={[
                  { value: 'any', label: t('decks.editor.tagAny') },
                  { value: 'all', label: t('decks.editor.tagAll') },
                ]}
                className="mt-2"
              />
            )}
          </fieldset>

          <SegmentedControl<Added>
            legend={t('decks.editor.added')}
            value={added}
            onValueChange={setAdded}
            options={[
              { value: 'any', label: t('decks.editor.addedAny') },
              { value: '7', label: t('decks.editor.added7') },
              { value: '30', label: t('decks.editor.added30') },
            ]}
          />

          <p
            aria-live="polite"
            className="rounded-control bg-surface-sunken px-3 py-2.5 text-[0.9375rem] text-fg"
          >
            {count === undefined || count === null ? ' ' : t('decks.editor.preview', { count })}
            {filter &&
              !filter.states &&
              !filter.tags &&
              !filter.addedWithinDays &&
              !filter.levels &&
              !filter.topics && (
                <span className="block text-sm text-fg-muted">{t('decks.editor.previewAll')}</span>
              )}
          </p>
        </>
      )}

      <div className="sticky bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] z-10 -mx-5 -mt-2 grid grid-cols-2 gap-2 border-t border-border bg-surface-raised px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-[-1.5rem] sm:-mx-6 sm:flex sm:justify-end sm:px-6 sm:pb-6">
        <DialogClose asChild>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" loading={busy} disabled={busy}>
          {deck ? t('common.save') : t('decks.editor.create')}
        </Button>
      </div>
    </form>
  );
}
