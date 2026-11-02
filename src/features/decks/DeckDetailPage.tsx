// One of the user's decks (/decks/:id, docs/design.md §4.9): numbers and the five-stage bar,
// "Bu desteyi çalış", its words, and a menu (edit, move, CSV, delete with "Geri al"). A
// hand-picked (tag) deck has "Kelime ekle"; a deck made from a suggestion links back to it so
// the rest of the set can be added later.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { db, deleteDeck, listDecks, logError, moveDeck, restoreDeck, setNoteTags } from '@/data';
import { getDeckWords } from '@/data/deckHub';
import { foldForSearch } from '@/features/cards/libraryFilter';
import type { WordStage } from '@/domain/stages';
import { hasTag } from '@/domain/tags';
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
  ListGroup,
  ListRow,
  PageFrame,
  SectionHeader,
  Skeleton,
  StageBar,
  StagePill,
  StatTile,
  TextField,
  buttonClasses,
  toast,
  type MenuItem,
} from '@/ui';
import { useLevelData } from '@/features/levels/useLevelData';
import { DeckEditorDialog } from './DeckEditorDialog';
import { describeDeckFilter } from './describe';
import { deckStudyHref, nf, soleTag } from './deckUi';
import { ChipCount } from './parts';
import { specHref, titleIndex } from './suggested';
import { exportWordsCsv } from './exportWords';
import { scanWhere } from '@/data/scan';

const PAGE = 60;
type Group = 'all' | 'studying' | 'learned' | 'new';

const groupOf = (s: WordStage | null): Exclude<Group, 'all'> =>
  s === 'learned' || s === 'mastered'
    ? 'learned'
    : s === 'learning' || s === 'consolidating'
      ? 'studying'
      : 'new';

export function DeckDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const levelData = useLevelData();
  const data = useLiveQuery(async () => (await getDeckWords(id)) ?? null, [id, levelData]);
  const order = useLiveQuery(async () => (await listDecks()).map((d) => d.id), []);
  const titles = useMemo(() => titleIndex(t), [t]);
  const [editing, setEditing] = useState(false);
  const [group, setGroup] = useState<Group>('all');
  const [shown, setShown] = useState(PAGE);
  const picking = params.get('pick') === '1';
  const setPicking = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set('pick', '1');
        else p.delete('pick');
        return p;
      },
      { replace: true },
    );
  const back = { to: '/decks', label: t('deckHub.library.parent') };

  if (data === undefined)
    return (
      <PageFrame back={back} title={t('deckHub.detail.loading')} hideTitle>
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-48" />
          <Skeleton lines={5} />
        </div>
      </PageFrame>
    );
  if (data === null)
    return (
      <PageFrame back={back} title={t('deckHub.detail.notFound')} hideTitle>
        <EmptyState
          tone="card"
          icon="layers"
          title={t('deckHub.detail.notFound')}
          description={t('deckHub.detail.notFoundBody')}
          action={
            <Link to="/decks" className={buttonClasses({ variant: 'secondary' })}>
              {t('deckHub.detail.toMine')}
            </Link>
          }
        />
      </PageFrame>
    );

  const { deck, filter, words } = data;
  const tag = soleTag(filter);
  const suggested = tag ? titles.get(tag.toLocaleLowerCase('tr')) : undefined;
  const counts = { studying: 0, learned: 0, new: 0 };
  const byStage: Record<WordStage, number> = {
    new: 0,
    learning: 0,
    consolidating: 0,
    learned: 0,
    mastered: 0,
  };
  let due = 0;
  for (const w of words) {
    counts[groupOf(w.stage)]++;
    byStage[w.stage ?? 'new']++;
    due += w.dueToday;
  }
  const list = words.filter((w) => group === 'all' || groupOf(w.stage) === group);
  const studied = counts.learned + counts.studying;
  const pos = order?.indexOf(deck.id) ?? -1;
  const move = (dir: -1 | 1) =>
    void moveDeck(deck.id, dir).catch((e) => {
      void logError(e, 'DeckDetail.move');
      toast({ title: t('decks.failed'), tone: 'danger' });
    });
  // Deleting a deck never touches its words, and it can be undone: no question first.
  const remove = async () => {
    try {
      await deleteDeck(deck.id);
      const deckId = deck.id;
      toast.undo({
        title: t('deckHub.detail.deleted', { name: deck.name }),
        undoLabel: t('ui.undo'),
        onUndo: () => void restoreDeck(deckId).catch((e) => logError(e, 'DeckDetail.undo')),
      });
      void navigate('/decks', { replace: true });
    } catch (e) {
      void logError(e, 'DeckDetail.delete');
      toast({ title: t('decks.failed'), tone: 'danger' });
    }
  };

  const menu: MenuItem[] = [
    { label: t('deckHub.detail.edit'), icon: 'pencil', onSelect: () => setEditing(true) },
    ...(pos > 0
      ? [{ label: t('deckHub.detail.up'), icon: 'chevron-up' as const, onSelect: () => move(-1) }]
      : []),
    ...(pos >= 0 && order && pos < order.length - 1
      ? [{ label: t('deckHub.detail.down'), icon: 'chevron-down' as const, onSelect: () => move(1) }]
      : []),
    ...(words.length > 0
      ? [
          {
            label: t('deckHub.detail.export'),
            icon: 'file' as const,
            onSelect: () =>
              void exportWordsCsv(
                t,
                words.map((w) => w.note.id),
                deck.name,
              ),
          },
        ]
      : []),
    { kind: 'separator' },
    {
      label: t('deckHub.detail.delete'),
      icon: 'trash',
      danger: true,
      onSelect: () => void remove(),
    },
  ];

  return (
    <PageFrame
      back={back}
      eyebrow={
        suggested
          ? t('deckHub.mine.fromSuggestion')
          : tag
            ? t('deckHub.mine.kindTag')
            : t('deckHub.mine.kindSmart')
      }
      title={<span className="break-words">{deck.name}</span>}
      description={
        !filter
          ? t('deckHub.detail.unsupported')
          : tag && !suggested
            ? t('deckHub.detail.handPicked')
            : describeDeckFilter(t, filter)
      }
      actions={
        <DropdownMenu
          label={t('deckHub.detail.actions')}
          trigger={<IconButton icon="more" label={t('deckHub.detail.actions')} />}
          items={menu}
        />
      }
    >
      <div className="flex flex-col gap-8">
        <Card padding="lg" className="flex flex-col gap-6" aria-label={t('deckHub.detail.status')}>
          {filter && words.length > 0 && (
            <>
              <div className="grid grid-cols-3 divide-x divide-border [&>*]:px-3 [&>*:first-child]:pl-0">
                <StatTile bare value={nf.format(words.length)} label={t('deckHub.detail.statWords')} />
                <StatTile bare value={nf.format(due)} label={t('deckHub.detail.statDue')} />
                <StatTile
                  bare
                  value={nf.format(counts.learned)}
                  label={t('deckHub.detail.statLearned')}
                />
              </div>
              <StageBar counts={byStage} />
            </>
          )}
          <div className="flex flex-col gap-2">
            {words.length > 0 && (
              <Link
                to={deckStudyHref(deck.id)}
                className={buttonClasses({ size: 'lg', fullWidth: true })}
              >
                {studied > 0 ? t('deckHub.detail.studyDeck') : t('deckHub.detail.startDeck')}
              </Link>
            )}
            {tag && !suggested && (
              <Button
                variant={words.length > 0 ? 'secondary' : 'primary'}
                size="lg"
                leadingIcon="plus"
                fullWidth
                onClick={() => setPicking(true)}
              >
                {t('deckHub.detail.addWords')}
              </Button>
            )}
            {suggested && (
              <Link
                to={specHref(suggested)}
                className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}
              >
                {t('deckHub.detail.suggestedOpen')}
              </Link>
            )}
          </div>
        </Card>

        {filter && (
          <section aria-labelledby="dd-words" className="flex flex-col">
            <SectionHeader
              id="dd-words"
              title={t('deckHub.detail.wordsTitle')}
              description={words.length > 0 ? t('deckHub.detail.newest') : undefined}
            />
            {words.length === 0 ? (
              <EmptyState
                tone="placeholder"
                compact
                icon="cards"
                title={t('deckHub.detail.emptyTitle')}
                description={
                  tag && !suggested ? t('deckHub.detail.emptyTag') : t('deckHub.detail.empty')
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                <ChipRow label={t('deckHub.detail.filter')}>
                  {(
                    [
                      ['all', t('deckHub.detail.fAll'), words.length],
                      ['studying', t('deckHub.detail.fStudying'), counts.studying],
                      ['learned', t('deckHub.detail.fLearned'), counts.learned],
                      ['new', t('deckHub.detail.fNew'), counts.new],
                    ] as [Group, string, number][]
                  ).map(([g, label, n]) => (
                    <Chip
                      key={g}
                      selected={group === g}
                      onClick={() => {
                        setGroup(g);
                        setShown(PAGE);
                      }}
                    >
                      <ChipCount label={label} count={n} selected={group === g} />
                    </Chip>
                  ))}
                </ChipRow>
                <ListGroup aria-label={t('deckHub.detail.words')}>
                  {list.slice(0, shown).map((w) => (
                    <ListRow
                      key={w.note.id}
                      to={`/library?note=${encodeURIComponent(w.note.id)}`}
                      term
                      title={w.note.term}
                      description={w.meaning ?? t('deckHub.detail.noMeaning')}
                      trailing={<StagePill stage={w.stage ?? 'new'} />}
                    />
                  ))}
                </ListGroup>
                {list.length > shown && (
                  <Button
                    variant="ghost"
                    className="self-center"
                    onClick={() => setShown((n) => n + PAGE)}
                  >
                    {t('deckHub.suggested.more', { count: Math.min(PAGE, list.length - shown) })}
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        {!filter && <Badge tone="warn">{t('deckHub.mine.needsUpdate')}</Badge>}
      </div>

      <DeckEditorDialog open={editing} onOpenChange={setEditing} deck={deck} />
      {tag && (
        <WordPicker open={picking} onOpenChange={setPicking} deckName={deck.name} tag={tag} />
      )}
    </PageFrame>
  );
}

/** "Kelime ekle" of a hand-picked deck: tick words of the collection; they get the deck's tag. */
function WordPicker({
  open,
  onOpenChange,
  deckName,
  tag,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deckName: string;
  tag: string;
}) {
  const { t } = useTranslation();
  const notes = useLiveQuery(
    () => (open ? scanWhere(db.notes, (n) => n.deleted_at === null && !hasTag(n.tags, tag)) : []),
    [open, tag],
  );
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const fq = foldForSearch(q.trim());
  const list = (notes ?? [])
    .filter((n) => !fq || foldForSearch(n.term).includes(fq))
    .sort((a, b) => a.term.localeCompare(b.term, 'en'))
    .slice(0, 200);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await setNoteTags(picked, { add: [tag] });
      toast({
        title: t('deckHub.picker.done', { count: r.changed }),
        description: r.full ? t('deckHub.picker.full', { count: r.full }) : undefined,
        tone: r.full ? 'warn' : 'success',
      });
      setPicked(new Set());
      onOpenChange(false);
    } catch (e) {
      void logError(e, 'DeckDetail.pick');
      toast({ title: t('decks.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('deckHub.picker.title', { name: deckName })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">{t('common.cancel')}</Button>
          </DialogClose>
          <Button loading={busy} disabled={picked.size === 0 || busy} onClick={() => void apply()}>
            {t('deckHub.picker.apply', { count: picked.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label={t('deckHub.picker.search')}
          hideLabel
          type="search"
          leadingIcon="search"
          placeholder={t('deckHub.picker.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
        />
        {notes === undefined ? (
          <Skeleton lines={4} />
        ) : list.length === 0 ? (
          <p className="text-[15px] text-fg-muted">{t('deckHub.picker.none')}</p>
        ) : (
          <ul aria-label={t('deckHub.picker.list')} className="-mx-1 flex max-h-[50dvh] flex-col overflow-y-auto">
            {list.map((n) => (
              <li key={n.id} className="px-1">
                <Checkbox
                  label={<span lang="en" className="font-serif text-base font-semibold">{n.term}</span>}
                  checked={picked.has(n.id)}
                  onCheckedChange={(v) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (v === true) next.add(n.id);
                      else next.delete(n.id);
                      return next;
                    })
                  }
                  className="min-h-11"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
