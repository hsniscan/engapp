import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  db,
  getDeckNoteIds,
  getDeckSummaries,
  listTags,
  logError,
  setSuspended,
  softDeleteNote,
} from '@/data';
import { CEFR, noteLevel } from '@/domain/level';
import type { CardType } from '@/domain/types';
import { LevelBadge } from '@/features/levels/LevelBadge';
import { useLevelData } from '@/features/levels/useLevelData';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  EmptyState,
  Icon,
  IconButton,
  Page,
  Select,
  Skeleton,
  Surface,
  Switch,
  TextField,
  buttonClasses,
  cn,
  toast,
} from '@/ui';
import { ConfirmDialog } from './ConfirmDialog';
import { STATE_KEYS, stateKey, type StateKey } from './labels';
import {
  activeFilterCount,
  buildRows,
  EMPTY_FILTERS,
  filterRows,
  filtersFromParams,
  senseText,
  writeFilters,
  type LevelFilter,
  type LibraryFilters,
  type LibraryRow,
  type SortOrder,
  type SuspendedFilter,
} from './libraryFilter';
import { NoteDetailSheet } from './NoteDetailSheet';
import { useNow } from '@/features/settings/useNow';
import { DeckChips } from '@/features/decks/DeckChips';
import { DeckEditorDialog } from '@/features/decks/DeckEditorDialog';
import { describeDeckFilter } from '@/features/decks/describe';
import { TagSheet } from '@/features/decks/TagSheet';
import { practiceHref } from '@/features/extra/links';

const PAGE_SIZE = 60;

/**
 * Live notes with their senses, cards and levels, grouped. One pass over three tables plus the
 * cached lexicon rows (~5 ms for 1,000 notes); levels fill in once the level file has loaded.
 */
function useLibraryRows(): LibraryRow[] | undefined {
  const raw = useLiveQuery(async () => {
    const [notes, senses, cards] = await Promise.all([
      db.notes.filter((n) => n.deleted_at === null).toArray(),
      db.senses.filter((s) => s.deleted_at === null).toArray(),
      db.cards.filter((c) => c.deleted_at === null).toArray(),
    ]);
    const ids = [...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is string => !!x))];
    const lex = (await db.lexicon_cache.bulkGet(ids)).filter((r) => !!r);
    return { notes, senses, cards, lexicon: new Map(lex.map((r) => [r.id, r])) };
  }, []);
  const levelData = useLevelData();
  return useMemo(() => {
    if (!raw) return undefined;
    const lexOf = (id: string) => raw.lexicon.get(id);
    return buildRows(raw.notes, raw.senses, raw.cards, (note, ss) =>
      noteLevel(note, ss, lexOf, levelData),
    );
  }, [raw, levelData]);
}

export function LibraryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const openNoteId = params.get('note');
  const rows = useLibraryRows();
  // Smart decks (v0.2 İP8): chips above the list; ?deck=<id> narrows the list to the deck.
  const deckId = params.get('deck');
  // Deck counts use levels from the level file once it has loaded (levelData).
  const levelData = useLevelData();
  const decks = useLiveQuery(() => getDeckSummaries(), [levelData]);
  const deckIds = useLiveQuery(
    async () => ({ id: deckId, ids: deckId ? await getDeckNoteIds(deckId) : null }),
    [deckId, levelData],
  );
  const activeDeck = decks?.find((d) => d.deck.id === deckId) ?? null;
  const [editDeck, setEditDeck] = useState(false);
  const selectDeck = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          if (id) p.set('deck', id);
          else p.delete('deck');
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The search box is local state (instant typing); the URL follows without adding history entries.
  const [q, setQ] = useState(filters.q);
  const deferredQ = useDeferredValue(q);
  const setFilters = useCallback(
    (patch: Partial<LibraryFilters>) =>
      setParams((p) => writeFilters(p, { ...filtersFromParams(p), ...patch }), { replace: true }),
    [setParams],
  );
  useEffect(() => {
    const id = setTimeout(() => {
      if (deferredQ !== filters.q) setFilters({ q: deferredQ });
    }, 300);
    return () => clearTimeout(id);
  }, [deferredQ, filters.q, setFilters]);

  const effective = useMemo(() => ({ ...filters, q: deferredQ }), [filters, deferredQ]);
  const deckFilterIds = deckId && deckIds?.id === deckId ? deckIds.ids : undefined;
  const filtered = useMemo(() => {
    const list = rows ? filterRows(rows, effective) : [];
    if (!deckId) return list;
    if (!deckFilterIds) return []; // loading, or a deck this version cannot evaluate
    return list.filter((r) => deckFilterIds.has(r.note.id));
  }, [rows, effective, deckId, deckFilterIds]);
  const tagList = useLiveQuery(() => listTags(), []);
  const tags = useMemo(
    () => (tagList ?? []).map((x) => x.tag).sort((a, b) => a.localeCompare(b, 'tr')),
    [tagList],
  );
  const hasDuplicates = useMemo(
    () => rows?.some((r) => r.note.possible_duplicate) ?? false,
    [rows],
  );

  // Paging: render 60 rows, add more when the sentinel scrolls into view (or the button is pressed).
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [limitFor, setLimitFor] = useState(effective);
  if (limitFor !== effective) {
    // New search or filter: start again from the first page.
    setLimitFor(effective);
    setLimit(PAGE_SIZE);
  }
  const sentinel = useRef<HTMLDivElement>(null);
  const more = filtered.length > limit;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE_SIZE);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);
  const visible = filtered.slice(0, limit);

  // Selection (note ids). Ids of notes deleted elsewhere drop out on their own.
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const selected = useMemo(() => {
    if (!rows || rawSelected.size === 0) return rawSelected;
    const live = new Set(rows.map((r) => r.note.id));
    return [...rawSelected].every((id) => live.has(id))
      ? rawSelected
      : new Set([...rawSelected].filter((id) => live.has(id)));
  }, [rows, rawSelected]);
  const toggle = useCallback(
    (id: string, on: boolean) =>
      setSelected((s) => {
        const n = new Set(s);
        if (on) n.add(id);
        else n.delete(id);
        return n;
      }),
    [setSelected],
  );
  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.note.id));
  const someSelected = filtered.some((r) => selected.has(r.note.id));

  const openNote = useCallback(
    (id: string | null) =>
      setParams((p) => {
        if (id) p.set('note', id);
        else p.delete('note');
        return p;
      }),
    [setParams],
  );

  const totalCards = useMemo(() => rows?.reduce((n, r) => n + r.cards.length, 0) ?? 0, [rows]);
  const filterCount = activeFilterCount(filters);
  const nf = new Intl.NumberFormat('tr-TR');

  return (
    <Page
      title={t('library.title')}
      width="wide"
      description={
        rows && rows.length > 0
          ? t('library.summary', { notes: nf.format(rows.length), cards: nf.format(totalCards) })
          : undefined
      }
      actions={
        rows && rows.length > 0 ? (
          <Link
            to="/add"
            className={buttonClasses({ variant: 'secondary', className: 'hidden sm:inline-flex' })}
          >
            <Icon name="plus" size={18} />
            {t('home.addCard')}
          </Link>
        ) : undefined
      }
    >
      {rows === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-11" />
          <Skeleton lines={6} />
        </div>
      ) : rows.length === 0 ? (
        <Surface>
          <EmptyState
            icon="cards"
            title={t('library.empty')}
            description={t('library.emptyHint')}
            action={
              <Link to="/add" className={buttonClasses({ variant: 'primary' })}>
                <Icon name="plus" size={18} />
                {t('home.addCard')}
              </Link>
            }
          />
        </Surface>
      ) : (
        <div className="flex flex-col gap-4">
          {decks && (
            <div className="flex flex-col gap-2">
              <DeckChips decks={decks} active={deckId} onSelect={selectDeck} />
              {activeDeck && (
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                  <span className="min-w-0">{describeDeckFilter(t, activeDeck.filter)}</span>
                  {activeDeck.count !== null && activeDeck.count > 0 && (
                    <Link
                      to={practiceHref({ source: 'deck', size: 10, tag: null, deck: activeDeck.deck.id })}
                      className="inline-flex min-h-11 items-center font-medium text-accent-text underline-offset-4 hover:underline"
                    >
                      {t('library.decks.practice')}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditDeck(true)}
                    className="inline-flex min-h-11 items-center font-medium text-accent-text underline-offset-4 hover:underline"
                  >
                    {t('library.decks.edit')}
                  </button>
                </p>
              )}
            </div>
          )}
          <div role="search" className="flex items-end gap-2">
            <TextField
              label={t('common.search')}
              hideLabel
              type="search"
              leadingIcon="search"
              placeholder={t('library.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              fieldClassName="flex-1"
              enterKeyHint="search"
              autoComplete="off"
            />
            <FilterSheet
              filters={filters}
              tags={tags}
              hasDuplicates={hasDuplicates}
              onChange={setFilters}
              count={filterCount}
            />
          </div>
          <div className="hidden gap-3 md:grid md:grid-cols-3 2xl:grid-cols-6">
            <FilterSelects filters={filters} tags={tags} onChange={setFilters} />
            <SortSelect filters={filters} onChange={setFilters} />
          </div>

          <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Checkbox
              label={t('library.selectAll', { count: filtered.length })}
              checked={allVisibleSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(v) =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const r of filtered) {
                    if (v === true) n.add(r.note.id);
                    else n.delete(r.note.id);
                  }
                  return n;
                })
              }
              disabled={filtered.length === 0}
              className="pl-3 sm:pl-4"
            />
            <div className="flex items-center gap-3 text-sm text-fg-muted">
              {(hasDuplicates || filters.dup) && (
                <button
                  type="button"
                  aria-pressed={filters.dup}
                  onClick={() => setFilters({ dup: !filters.dup })}
                  className={cn(
                    'hidden min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline md:inline-flex',
                    filters.dup ? 'text-accent-text' : 'text-warn-text',
                  )}
                >
                  {filters.dup && <Icon name="check" size={16} />}
                  {t('library.filter.dupOnly')}
                </button>
              )}
              <p aria-live="polite" className="tabular">
                {t('library.showing', {
                  count: filtered.length,
                  shown: nf.format(filtered.length),
                })}
              </p>
              {(filterCount > 0 || q) && (
                <button
                  type="button"
                  className="min-h-11 font-medium text-accent-text underline-offset-4 hover:underline"
                  onClick={() => {
                    setQ('');
                    setParams((p) => writeFilters(p, { ...EMPTY_FILTERS, sort: filters.sort }), {
                      replace: true,
                    });
                  }}
                >
                  {t('library.clearFilters')}
                </button>
              )}
            </div>
          </div>

          {deckId && deckIds?.id === deckId && deckIds.ids === null && activeDeck ? (
            <Surface>
              <EmptyState icon="info" title={activeDeck.deck.name} description={t('library.decks.unsupported')} />
            </Surface>
          ) : deckId && activeDeck && activeDeck.count === 0 ? (
            <Surface>
              <EmptyState
                icon="layers"
                title={t('library.decks.empty')}
                description={t('library.decks.emptyHint')}
              />
            </Surface>
          ) : filtered.length === 0 ? (
            <Surface>
              <EmptyState
                icon="search"
                title={t('library.noMatch')}
                description={t('library.noMatchHint')}
              />
            </Surface>
          ) : (
            <Surface padding="none" className="overflow-hidden">
              <ul aria-label={t('library.listLabel')}>
                {visible.map((r) => (
                  <NoteRow
                    key={r.note.id}
                    row={r}
                    selected={selected.has(r.note.id)}
                    onToggle={toggle}
                    onOpen={openNote}
                  />
                ))}
              </ul>
              {more && (
                <div ref={sentinel} className="flex justify-center border-t border-border p-3">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                    {t('library.showMore', { count: filtered.length - limit })}
                  </Button>
                </div>
              )}
            </Surface>
          )}
        </div>
      )}

      {selected.size > 0 && rows && (
        <BulkBar rows={rows} selected={selected} onClear={() => setSelected(new Set())} />
      )}

      <NoteDetailSheet noteId={openNoteId} onClose={() => openNote(null)} />
      <DeckEditorDialog
        open={editDeck && !!activeDeck}
        onOpenChange={setEditDeck}
        deck={activeDeck?.deck ?? null}
      />
    </Page>
  );
}

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });

const STATE_TONE: Record<StateKey, 'neutral' | 'accent' | 'success' | 'warn'> = {
  new: 'neutral',
  learning: 'accent',
  review: 'success',
  relearning: 'warn',
};

/** One note. The checkbox selects; the rest of the row opens the detail sheet. */
const NoteRow = memo(function NoteRow({
  row,
  selected,
  onToggle,
  onOpen,
}: {
  row: LibraryRow;
  selected: boolean;
  onToggle: (id: string, on: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { note, senses, cards } = row;
  const recognition = cards.find((c) => c.card_type === 'recognition') ?? cards[0];
  const allSuspended = cards.length > 0 && row.suspendedCards === cards.length;
  const now = useNow();
  const studied = cards.filter((c) => !c.suspended && c.state !== 0);
  const nextDue = studied.length ? Math.min(...studied.map((c) => c.due)) : null;
  const dueLabel = (due: number) => {
    const days = Math.round((due - now) / 86_400_000);
    return days <= 0
      ? t('library.detail.dueNow')
      : t('library.detail.due', { when: rtf.format(days, 'day') });
  };
  const meanings =
    senses.length === 1
      ? senseText(senses[0]!)
      : senses.map((s, i) => `${i + 1}. ${senseText(s)}`).join('  ·  ');
  return (
    <li
      className={cn(
        'flex items-start gap-1 border-b border-border pr-1 pl-3 last:border-b-0 sm:pl-4 [content-visibility:auto] [contain-intrinsic-size:auto_88px]',
        selected && 'bg-selected',
      )}
    >
      <Checkbox
        hideLabel
        label={t('library.selectNote', { term: note.term })}
        checked={selected}
        onCheckedChange={(v) => onToggle(note.id, v === true)}
        className="mt-1.5"
      />
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-control py-3.5 pl-2 text-left focus-visible:outline-offset-[-2px]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span
              lang="en"
              className="font-serif text-lg leading-snug font-semibold text-fg group-hover:underline group-hover:decoration-border-strong group-hover:underline-offset-4"
            >
              {note.term}
            </span>
            {row.level && <LevelBadge level={row.level} className="self-center" />}
            {note.ipa && <span className="font-serif text-sm text-fg-muted">{note.ipa}</span>}
          </span>
          <span
            className={cn(
              'line-clamp-2 text-[0.9375rem]',
              senses.length ? 'text-fg-muted' : 'text-fg-subtle italic',
            )}
          >
            {senses.length ? meanings : t('library.noSenses')}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {recognition && (
              <Badge tone={STATE_TONE[stateKey(recognition.state)]} dot>
                {t(`cards.state.${stateKey(recognition.state)}`)}
              </Badge>
            )}
            {allSuspended ? (
              <Badge tone="outline">{t('cards.suspended')}</Badge>
            ) : (
              row.suspendedCards > 0 && (
                <Badge tone="outline">
                  {t('cards.partlySuspended', { count: row.suspendedCards })}
                </Badge>
              )
            )}
            {note.possible_duplicate && <Badge tone="warn">{t('cards.possibleDuplicate')}</Badge>}
            {note.tags.map((tag) => (
              <span key={tag} className="text-xs text-fg-muted">
                #{tag}
              </span>
            ))}
          </span>
        </span>
        <span className="hidden w-36 shrink-0 flex-col items-end gap-0.5 text-right text-sm md:flex">
          <span className="tabular text-fg">{t('library.cardCount', { count: cards.length })}</span>
          {nextDue !== null && <span className="tabular text-fg-muted">{dueLabel(nextDue)}</span>}
        </span>
        <Icon
          name="chevron-right"
          size={18}
          className="shrink-0 text-fg-subtle group-hover:text-fg-muted"
        />
      </button>
    </li>
  );
});

interface FilterProps {
  filters: LibraryFilters;
  tags: string[];
  onChange: (patch: Partial<LibraryFilters>) => void;
}

const ANY_TAG = '__any';

function FilterSelects({ filters, tags, onChange }: FilterProps) {
  const { t } = useTranslation();
  return (
    <>
      <Select
        label={t('library.filter.type')}
        value={filters.type}
        onValueChange={(v) => onChange({ type: v as CardType | 'all' })}
        options={[
          { value: 'all', label: t('library.filter.allTypes') },
          { value: 'recognition', label: t('cards.cardType.recognition') },
          { value: 'production', label: t('cards.cardType.production') },
          { value: 'cloze', label: t('cards.cardType.cloze') },
          { value: 'image', label: t('cards.cardType.image') },
        ]}
      />
      <Select
        label={t('library.filter.state')}
        value={filters.state}
        onValueChange={(v) => onChange({ state: v as StateKey | 'all' })}
        options={[
          { value: 'all', label: t('library.filter.allStates') },
          ...STATE_KEYS.map((k) => ({ value: k, label: t(`cards.state.${k}`) })),
        ]}
      />
      <Select
        label={t('library.filter.suspended')}
        value={filters.suspended}
        onValueChange={(v) => onChange({ suspended: v as SuspendedFilter })}
        options={[
          { value: 'all', label: t('library.filter.suspendedAll') },
          { value: 'active', label: t('library.filter.suspendedActive') },
          { value: 'suspended', label: t('library.filter.suspendedOnly') },
        ]}
      />
      <Select
        label={t('library.filter.level')}
        value={filters.level}
        onValueChange={(v) => onChange({ level: v as LevelFilter })}
        options={[
          { value: 'all', label: t('library.filter.allLevels') },
          ...CEFR.map((l) => ({ value: l, label: `${l} · ${t(`settings.levels.${l}`)}` })),
          { value: 'none', label: t('library.filter.levelUnknown') },
        ]}
      />
      <Select
        label={t('library.filter.tag')}
        value={filters.tag || ANY_TAG}
        onValueChange={(v) => onChange({ tag: v === ANY_TAG ? '' : v })}
        disabled={tags.length === 0}
        options={[
          { value: ANY_TAG, label: t('library.filter.anyTag') },
          ...tags.map((x) => ({ value: x, label: `#${x}` })),
        ]}
      />
    </>
  );
}

function SortSelect({ filters, onChange }: Pick<FilterProps, 'filters' | 'onChange'>) {
  const { t } = useTranslation();
  return (
    <Select
      label={t('library.filter.sort')}
      value={filters.sort}
      onValueChange={(v) => onChange({ sort: v as SortOrder })}
      options={[
        { value: 'new', label: t('library.filter.sortNew') },
        { value: 'az', label: t('library.filter.sortAz') },
        { value: 'level', label: t('library.filter.sortLevel') },
        { value: 'level_desc', label: t('library.filter.sortLevelDesc') },
      ]}
    />
  );
}

/** Phones and tablets: filters live in a sheet behind one button. Desktop shows them inline too. */
function FilterSheet({
  count,
  hasDuplicates,
  ...props
}: FilterProps & { count: number; hasDuplicates: boolean }) {
  const { t } = useTranslation();
  const { filters, onChange } = props;
  return (
    <Dialog
      title={t('library.filter.title')}
      trigger={
        <button
          type="button"
          className={buttonClasses({ variant: 'secondary', className: 'shrink-0 px-3 md:hidden' })}
        >
          <Icon name="filter" size={18} />
          <span className="sr-only sm:not-sr-only">{t('library.filter.short')}</span>
          {count > 0 && (
            <>
              <span
                aria-hidden="true"
                className="tabular inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-accent-fg"
              >
                {count}
              </span>
              <span className="sr-only">{t('library.filter.activeSr', { count })}</span>
            </>
          )}
        </button>
      }
      footer={
        <>
          <Button
            variant="ghost"
            disabled={count === 0}
            onClick={() =>
              onChange({ type: 'all', state: 'all', suspended: 'all', tag: '', dup: false, level: 'all' })
            }
          >
            {t('library.filter.reset')}
          </Button>
          <DialogClose asChild>
            <Button>{t('common.done')}</Button>
          </DialogClose>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FilterSelects {...props} />
        <SortSelect filters={filters} onChange={onChange} />
        {(hasDuplicates || filters.dup) && (
          <Switch
            label={t('library.filter.dupOnly')}
            description={t('library.filter.dupHint')}
            checked={filters.dup}
            onCheckedChange={(v) => onChange({ dup: v })}
          />
        )}
      </div>
    </Dialog>
  );
}

/** Sticky action bar for the selected notes. Sits above the phone tab bar. */
function BulkBar({
  rows,
  selected,
  onClear,
}: {
  rows: LibraryRow[];
  selected: Set<string>;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((r) => selected.has(r.note.id));
  const allSuspended =
    chosen.length > 0 &&
    chosen.every((r) => r.cards.length > 0 && r.suspendedCards === r.cards.length);
  const n = chosen.length;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: done, tone: 'success' });
    } catch (e) {
      void logError(e, 'Library.bulk');
      toast({ title: t('library.bulk.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const suspend = (on: boolean) =>
    run(
      async () => {
        for (const r of chosen) await setSuspended({ note_id: r.note.id }, on);
      },
      on ? t('library.bulk.suspended', { count: n }) : t('library.bulk.unsuspended', { count: n }),
    );

  // While the bar floats over the list, keyboard focus scrolls rows clear of it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--floating-bar', '4.5rem');
    return () => {
      root.style.removeProperty('--floating-bar');
    };
  }, []);

  return (
    <div className="pointer-events-none sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-20 mt-4 flex justify-center md:bottom-4">
      <div
        role="region"
        aria-label={t('library.bulk.label')}
        className="pointer-events-auto flex w-full max-w-xl animate-pop-in items-center gap-1 rounded-card border border-border bg-surface-raised py-1.5 pr-1.5 pl-1 shadow-overlay"
      >
        <IconButton icon="x" label={t('library.bulk.clear')} onClick={onClear} />
        <p
          className="tabular min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-fg"
          aria-live="polite"
        >
          {t('library.bulk.count', { count: n })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="tag"
          disabled={busy}
          onClick={() => setTagging(true)}
        >
          {t('library.bulk.tag')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={allSuspended ? 'refresh' : 'pause'}
          disabled={busy}
          onClick={() => void suspend(!allSuspended)}
          aria-label={allSuspended ? t('library.bulk.unsuspend') : t('common.suspend')}
          className="max-sm:px-2.5"
        >
          <span aria-hidden="true" className="max-sm:hidden">
            {allSuspended ? t('library.bulk.unsuspend') : t('common.suspend')}
          </span>
        </Button>
        <IconButton
          icon="trash"
          label={t('library.bulk.delete', { count: n })}
          onClick={() => setConfirm(true)}
          disabled={busy}
          className="hover:text-danger-text"
        />
      </div>
      <TagSheet
        open={tagging}
        onOpenChange={setTagging}
        notes={chosen.map((r) => r.note)}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('library.bulk.confirmTitle', { count: n })}
        description={t('library.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={async () => {
          await run(
            async () => {
              for (const r of chosen) await softDeleteNote(r.note.id);
            },
            t('library.bulk.deleted', { count: n }),
          );
          setConfirm(false);
          onClear();
        }}
      />
    </div>
  );
}
