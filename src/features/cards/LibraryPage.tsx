// "Tüm kelimelerim" (/library, docs/design.md §4.6): every word with search, stage chips, the
// rest of the filters in a sheet, a row menu (Düzenle, Askıya al, Sil → "Geri al") and a bulk
// bar for the selected words (data/wordActions.ts, ADR 0063). ?note=<id> opens the word sheet
// (read view; &edit=1 opens it in edit mode); ?deck=<id> narrows the list to one deck.
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  db,
  getDeckNoteIds,
  getDeckSummaries,
  listTags,
  bulkSetSuspended,
  bulkSoftDeleteNotes,
  logError,
  markNotesKnown,
  restoreNotes,
  undoMarkNotesKnown,
} from '@/data';
import { CEFR, noteLevel } from '@/domain/level';
import type { CardType } from '@/domain/types';
import { LevelBadge } from '@/features/levels/LevelBadge';
import { useLevelData } from '@/features/levels/useLevelData';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  Dialog,
  DialogClose,
  DropdownMenu,
  EmptyState,
  IconButton,
  PageFrame,
  Select,
  Skeleton,
  StagePill,
  Switch,
  TextField,
  buttonClasses,
  cn,
  stageBg,
  toast,
} from '@/ui';
import { ConfirmDialog } from './ConfirmDialog';
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
  rowStage,
} from './libraryFilter';
import { NoteDetailSheet } from './NoteDetailSheet';
import { DeckEditorDialog } from '@/features/decks/DeckEditorDialog';
import { describeDeckFilter } from '@/features/decks/describe';
import { WORD_STAGES, type WordStage } from '@/domain/stages';
import { TagSheet } from '@/features/decks/TagSheet';
import { ChipCount } from '@/features/decks/parts';
import { practiceHref } from '@/features/extra/links';
import { scanWhere } from '@/data/scan';

const PAGE_SIZE = 60;
const nf = new Intl.NumberFormat('tr-TR');

/**
 * Live notes with their senses, cards and levels, grouped. One pass over three tables plus the
 * cached lexicon rows (~5 ms for 1,000 notes); levels fill in once the level file has loaded.
 */
function useLibraryRows(): LibraryRow[] | undefined {
  const raw = useLiveQuery(async () => {
    const [notes, senses, cards] = await Promise.all([
      scanWhere(db.notes, (n) => n.deleted_at === null),
      scanWhere(db.senses, (s) => s.deleted_at === null),
      scanWhere(db.cards, (c) => c.deleted_at === null),
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

const isSuspendedRow = (r: LibraryRow) => r.cards.length > 0 && r.suspendedCards === r.cards.length;

export function LibraryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const openNoteId = params.get('note');
  const openInEdit = params.get('edit') === '1';
  const rows = useLibraryRows();
  // Smart decks (v0.2 İP8): ?deck=<id> narrows the list to the deck.
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
  // Kelimelerim's search icon lands here with ?find=1: focus the field once.
  const searchRef = useRef<HTMLInputElement>(null);
  const wantFocus = params.get('find') === '1';
  useEffect(() => {
    if (!wantFocus || rows === undefined) return;
    searchRef.current?.focus();
    setParams(
      (p) => {
        p.delete('find');
        return p;
      },
      { replace: true },
    );
  }, [wantFocus, rows, setParams]);

  const effective = useMemo(() => ({ ...filters, q: deferredQ }), [filters, deferredQ]);
  const deckFilterIds = deckId && deckIds?.id === deckId ? deckIds.ids : undefined;
  const inDeck = useCallback(
    (list: LibraryRow[]) => {
      if (!deckId) return list;
      if (!deckFilterIds) return []; // loading, or a deck this version cannot evaluate
      return list.filter((r) => deckFilterIds.has(r.note.id));
    },
    [deckId, deckFilterIds],
  );
  const filtered = useMemo(
    () => inDeck(rows ? filterRows(rows, effective) : []),
    [rows, effective, inDeck],
  );
  // Counts on the stage chips: everything the other filters let through.
  const chipCounts = useMemo(() => {
    const base = inDeck(
      rows ? filterRows(rows, { ...effective, state: 'all', suspended: 'all' }) : [],
    );
    const c: Record<WordStage | 'all' | 'suspended', number> = {
      all: base.length,
      suspended: 0,
      new: 0,
      learning: 0,
      consolidating: 0,
      learned: 0,
      mastered: 0,
    };
    for (const r of base) {
      const s = rowStage(r);
      if (s) c[s]++;
      if (isSuspendedRow(r)) c.suspended++;
    }
    return c;
  }, [rows, effective, inDeck]);
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
  // Keyed on the filter values only: opening a word (?note=) must not reset the paging and
  // the scroll position underneath the sheet.
  const filterKey = JSON.stringify([effective, deckId]);
  const [limitFor, setLimitFor] = useState(filterKey);
  if (limitFor !== filterKey) {
    // New search or filter: start again from the first page.
    setLimitFor(filterKey);
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
    (id: string | null, edit = false) =>
      setParams((p) => {
        if (id) p.set('note', id);
        else p.delete('note');
        if (id && edit) p.set('edit', '1');
        else p.delete('edit');
        return p;
      }),
    [setParams],
  );
  const closeNote = useCallback(() => openNote(null), [openNote]);

  const totalCards = useMemo(() => rows?.reduce((n, r) => n + r.cards.length, 0) ?? 0, [rows]);
  const sheetFilterCount =
    (filters.type !== 'all' ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.dup ? 1 : 0) +
    (filters.level !== 'all' ? 1 : 0) +
    (filters.suspended === 'active' ? 1 : 0);
  const filterCount = activeFilterCount(filters);
  const stageChip = filters.suspended === 'suspended' ? 'suspended' : filters.state;

  return (
    <PageFrame
      back={{ to: '/decks', label: t('deckHub.library.parent') }}
      title={t('deckHub.library.title')}
      description={
        rows && rows.length > 0
          ? t('library.summary', { notes: nf.format(rows.length), cards: nf.format(totalCards) })
          : undefined
      }
    >
      {rows === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton lines={6} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          tone="card"
          icon="cards"
          title={t('library.empty')}
          description={t('library.emptyHint')}
          action={
            <>
              <Link to="/add" className={buttonClasses({ variant: 'primary' })}>
                {t('home.addCard')}
              </Link>
              <Link to="/decks?tab=bank" className={buttonClasses({ variant: 'ghost' })}>
                {t('library.emptyBank')}
              </Link>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {activeDeck && (
            <Card tone="sunken" padding="sm" className="flex flex-col gap-1 px-4">
              <p className="text-meta text-fg-muted">
                <strong className="font-semibold text-fg">
                  {t('deckHub.library.deckLine', { name: activeDeck.deck.name })}
                </strong>{' '}
                · {describeDeckFilter(t, activeDeck.filter)}
              </p>
              <div className="-ml-3 flex flex-wrap">
                <Link
                  to={`/decks/${encodeURIComponent(activeDeck.deck.id)}`}
                  className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                >
                  {t('deckHub.library.deckOpen')}
                </Link>
                {activeDeck.count !== null && activeDeck.count > 0 && (
                  <Link
                    to={practiceHref({
                      source: 'deck',
                      size: 10,
                      tag: null,
                      deck: activeDeck.deck.id,
                    })}
                    className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                  >
                    {t('library.decks.practice')}
                  </Link>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditDeck(true)}>
                  {t('library.decks.edit')}
                </Button>
              </div>
            </Card>
          )}

          {/* Search stays under the header while the list scrolls (canvas behind it). */}
          <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 bg-canvas px-4 pt-2 pb-1 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            <div role="search" className="flex items-end gap-2">
              <TextField
                ref={searchRef}
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
                count={sheetFilterCount}
              />
            </div>
            <ChipRow label={t('library.filter.state')}>
              <Chip
                selected={stageChip === 'all'}
                onClick={() => setFilters({ state: 'all', suspended: 'all' })}
              >
                <ChipCount
                  label={t('library.filter.allChip')}
                  count={chipCounts.all}
                  selected={stageChip === 'all'}
                />
              </Chip>
              {WORD_STAGES.map((k) => (
                <Chip
                  key={k}
                  selected={stageChip === k}
                  onClick={() =>
                    setFilters(
                      stageChip === k
                        ? { state: 'all', suspended: 'all' }
                        : { state: k, suspended: 'all' },
                    )
                  }
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 rounded-full',
                      stageBg[k],
                      k === 'new' && 'ring-1 ring-border-strong ring-inset',
                    )}
                  />
                  <ChipCount
                    label={t(`ui.stage.${k}`)}
                    count={chipCounts[k]}
                    selected={stageChip === k}
                  />
                </Chip>
              ))}
              {(chipCounts.suspended > 0 || stageChip === 'suspended') && (
                <Chip
                  icon="pause"
                  selected={stageChip === 'suspended'}
                  onClick={() =>
                    setFilters(
                      stageChip === 'suspended'
                        ? { state: 'all', suspended: 'all' }
                        : { state: 'all', suspended: 'suspended' },
                    )
                  }
                >
                  <ChipCount
                    label={t('cards.suspended')}
                    count={chipCounts.suspended}
                    selected={stageChip === 'suspended'}
                  />
                </Chip>
              )}
            </ChipRow>
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
              className="pl-4"
            />
            <div className="flex items-center gap-1 text-meta text-fg-muted">
              <p aria-live="polite" className="tabular">
                {t('library.showing', {
                  count: filtered.length,
                  shown: nf.format(filtered.length),
                })}
              </p>
              {(filterCount > 0 || q) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-2"
                  onClick={() => {
                    setQ('');
                    setParams((p) => writeFilters(p, { ...EMPTY_FILTERS, sort: filters.sort }), {
                      replace: true,
                    });
                  }}
                >
                  {t('library.clearFilters')}
                </Button>
              )}
            </div>
          </div>

          {deckId && deckIds?.id === deckId && deckIds.ids === null && activeDeck ? (
            <EmptyState
              tone="card"
              icon="info"
              title={activeDeck.deck.name}
              description={t('library.decks.unsupported')}
            />
          ) : deckId && activeDeck && activeDeck.count === 0 ? (
            <EmptyState
              tone="card"
              icon="layers"
              title={t('library.decks.empty')}
              description={t('library.decks.emptyHint')}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              tone="placeholder"
              compact
              icon="search"
              title={t('library.noMatch')}
              description={t('library.noMatchHint')}
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-border bg-surface">
              <ul aria-label={t('library.listLabel')} className="divide-y divide-border">
                {visible.map((r) => (
                  <NoteRow
                    key={r.note.id}
                    row={r}
                    selected={selected.has(r.note.id)}
                    selecting={selected.size > 0}
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
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && rows && (
        <BulkBar rows={filtered} selected={selected} onClear={() => setSelected(new Set())} />
      )}

      <NoteDetailSheet noteId={openNoteId} startInEdit={openInEdit} onClose={closeNote} />
      <DeckEditorDialog
        open={editDeck && !!activeDeck}
        onOpenChange={setEditDeck}
        deck={activeDeck?.deck ?? null}
      />
    </PageFrame>
  );
}

/**
 * One word: the checkbox selects; the row opens the word sheet; the ⋯ menu edits, suspends or
 * deletes it at once (with "Geri al").
 */
const NoteRow = memo(function NoteRow({
  row,
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  row: LibraryRow;
  selected: boolean;
  /** Some row is selected: the bulk bar owns the actions, so the row menus step aside. */
  selecting: boolean;
  onToggle: (id: string, on: boolean) => void;
  onOpen: (id: string, edit?: boolean) => void;
}) {
  const { t } = useTranslation();
  const { note, senses, cards } = row;
  const stage = rowStage(row);
  const allSuspended = isSuspendedRow(row);
  const meanings =
    senses.length === 1
      ? senseText(senses[0]!)
      : senses.map((s, i) => `${i + 1}. ${senseText(s)}`).join('  ·  ');

  const suspend = (on: boolean) =>
    void bulkSetSuspended([note.id], on).then(
      () =>
        toast.undo({
          title: on
            ? t('library.row.suspended', { term: note.term })
            : t('library.row.unsuspended', { term: note.term }),
          undoLabel: t('ui.undo'),
          onUndo: () =>
            void bulkSetSuspended([note.id], !on).catch((e) => logError(e, 'Library.rowUndo')),
        }),
      (e: unknown) => {
        void logError(e, 'Library.rowSuspend');
        toast({ title: t('library.bulk.failed'), tone: 'danger' });
      },
    );
  const remove = () =>
    void bulkSoftDeleteNotes([note.id]).then(
      (res) =>
        toast.undo({
          title: t('library.detail.noteDeleted', { term: note.term }),
          undoLabel: t('ui.undo'),
          onUndo: () =>
            void restoreNotes(res.ids, res.at).catch((e) => logError(e, 'Library.rowUndo')),
        }),
      (e: unknown) => {
        void logError(e, 'Library.rowDelete');
        toast({ title: t('library.bulk.failed'), tone: 'danger' });
      },
    );

  return (
    <li
      className={cn(
        'flex items-center gap-1 pr-1 pl-3 [content-visibility:auto] [contain-intrinsic-size:auto_72px] sm:pl-4',
        selected && 'bg-selected',
      )}
    >
      <Checkbox
        hideLabel
        label={t('library.selectNote', { term: note.term })}
        checked={selected}
        onCheckedChange={(v) => onToggle(note.id, v === true)}
      />
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-control py-3 pl-1 text-left focus-visible:outline-offset-[-2px]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span lang="en" className="truncate font-serif text-lead font-medium text-fg">
            {note.term}
          </span>
          <span
            className={cn(
              'line-clamp-2 text-meta',
              senses.length ? 'text-fg-muted' : 'text-fg-subtle italic',
            )}
          >
            {senses.length ? meanings : t('library.noSenses')}
          </span>
          {(allSuspended || row.suspendedCards > 0 || note.possible_duplicate) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
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
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {row.level && <LevelBadge level={row.level} />}
          {stage && <StagePill stage={stage} />}
        </span>
      </button>
      {!selecting && (
        <DropdownMenu
          label={t('library.row.actions', { term: note.term })}
          trigger={<IconButton icon="more" label={t('library.row.actions', { term: note.term })} />}
          items={[
            { label: t('library.row.edit'), icon: 'pencil', onSelect: () => onOpen(note.id, true) },
            ...(cards.length === 0
              ? []
              : allSuspended
                ? [
                    {
                      label: t('library.bulk.unsuspend'),
                      icon: 'refresh' as const,
                      onSelect: () => suspend(false),
                    },
                  ]
                : [
                    {
                      label: t('common.suspend'),
                      icon: 'pause' as const,
                      onSelect: () => suspend(true),
                    },
                  ]),
            { kind: 'separator' },
            { label: t('common.delete'), icon: 'trash', danger: true, onSelect: remove },
          ]}
        />
      )}
    </li>
  );
});

interface FilterProps {
  filters: LibraryFilters;
  tags: string[];
  onChange: (patch: Partial<LibraryFilters>) => void;
}

const ANY_TAG = '__any';

/** The filters behind the "Süz" button (stage and Askıda are the chips on the page). */
function FilterSheet({
  count,
  hasDuplicates,
  filters,
  tags,
  onChange,
}: FilterProps & { count: number; hasDuplicates: boolean }) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={t('library.filter.title')}
      trigger={
        <Button variant="secondary" leadingIcon="filter" className="shrink-0 px-3">
          <span className="sr-only sm:not-sr-only">{t('library.filter.short')}</span>
          {count > 0 && (
            <>
              <span
                aria-hidden="true"
                className="tabular inline-flex size-5 items-center justify-center rounded-full bg-accent text-caption text-accent-fg"
              >
                {count}
              </span>
              <span className="sr-only">{t('library.filter.activeSr', { count })}</span>
            </>
          )}
        </Button>
      }
      footer={
        <>
          <Button
            variant="ghost"
            disabled={count === 0}
            onClick={() =>
              onChange({ type: 'all', suspended: 'all', tag: '', dup: false, level: 'all' })
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
          label={t('library.filter.suspended')}
          value={filters.suspended}
          onValueChange={(v) => onChange({ suspended: v as SuspendedFilter })}
          options={[
            { value: 'all', label: t('library.filter.suspendedAll') },
            { value: 'active', label: t('library.filter.suspendedActive') },
            { value: 'suspended', label: t('library.filter.suspendedOnly') },
          ]}
        />
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

/** Sticky action bar for the selected words. Sits above the phone tab bar. */
function BulkBar({
  rows,
  selected,
  onClear,
}: {
  /** The rows the current filter shows: an action never touches a selected row it hides. */
  rows: LibraryRow[];
  selected: Set<string>;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const chosen = rows.filter((r) => selected.has(r.note.id));
  const allSuspended = chosen.length > 0 && chosen.every(isSuspendedRow);
  const n = chosen.length;
  // The confirm dialog keeps the count it opened with (rows leave the list while it works).
  const [frozenN, setFrozenN] = useState(n);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setProgress(null);
    try {
      return await fn();
    } catch (e) {
      void logError(e, 'Library.bulk');
      toast({ title: t('library.bulk.failed'), tone: 'danger' });
      return undefined;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const onProgress = (done: number, total: number) => setProgress({ done, total });

  const suspend = async (on: boolean) => {
    const ids = chosen.map((r) => r.note.id);
    const count = ids.length;
    const ok = await run(() => bulkSetSuspended(ids, on, { onProgress }).then(() => true));
    if (ok)
      toast.undo({
        title: on
          ? t('library.bulk.suspended', { count })
          : t('library.bulk.unsuspended', { count }),
        undoLabel: t('ui.undo'),
        onUndo: () => void bulkSetSuspended(ids, !on).catch((e) => logError(e, 'Library.bulkUndo')),
      });
  };

  const markKnown = async () => {
    const res = await run(() => markNotesKnown(chosen.map((r) => r.note.id)));
    if (!res) return;
    onClear();
    toast.undo({
      title: t('library.bulk.known', { count: res.ids.length }),
      undoLabel: t('ui.undo'),
      onUndo: () => void undoMarkNotesKnown(res).catch((e) => logError(e, 'Library.knownUndo')),
    });
  };

  // While the bar floats over the list, keyboard focus scrolls rows clear of it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--floating-bar', '4.5rem');
    return () => {
      root.style.removeProperty('--floating-bar');
    };
  }, []);

  return (
    <div className="pointer-events-none sticky bottom-[calc(var(--nav-height)+var(--nav-fab-rise)+env(safe-area-inset-bottom)+0.5rem)] z-20 mt-4 flex justify-center md:bottom-4">
      <div
        role="region"
        aria-label={t('library.bulk.label')}
        aria-busy={busy}
        className="pointer-events-auto flex w-full max-w-xl animate-pop-in items-center gap-1 rounded-card border border-border bg-surface-raised py-1.5 pr-1.5 pl-1 shadow-overlay"
      >
        <IconButton icon="x" label={t('library.bulk.clear')} onClick={onClear} disabled={busy} />
        <p
          className="tabular min-w-0 flex-1 truncate text-ui font-semibold text-fg"
          aria-live="polite"
        >
          {progress ? (
            t('library.bulk.progress', { done: progress.done, total: progress.total })
          ) : (
            <>
              {/* Phones: "2 seçili" fits beside the actions; the full sentence is still read. */}
              <span aria-hidden="true" className="sm:hidden">
                {t('library.bulk.countShort', { count: n })}
              </span>
              <span className="max-sm:sr-only">{t('library.bulk.count', { count: n })}</span>
            </>
          )}
          {!progress && selected.size > n && (
            <span className="block text-caption font-normal text-fg-muted">
              {t('library.bulk.hidden', { count: selected.size - n })}
            </span>
          )}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="tag"
          disabled={busy || n === 0}
          onClick={() => setTagging(true)}
        >
          {t('library.bulk.tag')}
        </Button>
        <IconButton
          icon="check"
          label={t('library.bulk.markKnown')}
          disabled={busy || n === 0}
          onClick={() => void markKnown()}
        />
        <IconButton
          icon={allSuspended ? 'refresh' : 'pause'}
          label={allSuspended ? t('library.bulk.unsuspend') : t('common.suspend')}
          disabled={busy || n === 0}
          onClick={() => void suspend(!allSuspended)}
        />
        <IconButton
          icon="trash"
          label={t('library.bulk.delete', { count: n })}
          onClick={() => {
            setFrozenN(n);
            setConfirm(true);
          }}
          disabled={busy || n === 0}
          className="hover:text-danger-text"
        />
      </div>
      <TagSheet open={tagging} onOpenChange={setTagging} notes={chosen.map((r) => r.note)} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('library.bulk.confirmTitle', { count: frozenN })}
        description={
          progress
            ? t('library.bulk.progress', { done: progress.done, total: progress.total })
            : t('library.deleteBody')
        }
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={async () => {
          const ids = chosen.map((r) => r.note.id);
          const res = await run(() => bulkSoftDeleteNotes(ids, { onProgress }));
          setConfirm(false);
          if (!res) return;
          onClear();
          toast.undo({
            title: t('library.bulk.deleted', { count: res.ids.length }),
            undoLabel: t('ui.undo'),
            onUndo: () =>
              void restoreNotes(res.ids, res.at).catch((e) => logError(e, 'Library.deleteUndo')),
          });
        }}
      />
    </div>
  );
}
