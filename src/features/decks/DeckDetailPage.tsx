// One of the user's decks (/decks/:id): its words by stage, "Çalış", edit / delete, and for a
// hand-picked (tag) deck "Kelime ekle". A deck made from a suggestion links back to it so the
// rest of the set can be added later.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { db, deleteDeck, logError, setNoteTags } from '@/data';
import { type DeckWordRow, getDeckWords } from '@/data/deckHub';
import { foldForSearch } from '@/features/cards/libraryFilter';
import { STAGE_LABEL_TR, type WordStage } from '@/domain/stages';
import { hasTag } from '@/domain/tags';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DropdownMenu,
  EmptyState,
  IconButton,
  Skeleton,
  Surface,
  TextField,
  toast,
} from '@/ui';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import { posLabel } from '@/features/cards/labels';
import { useLevelData } from '@/features/levels/useLevelData';
import { DeckEditorDialog } from './DeckEditorDialog';
import { describeDeckFilter } from './describe';
import { deckStudyHref, MARK, pct, soleTag } from './deckUi';
import {
  BackBar,
  FilterChip,
  LegendRow,
  type PillTone,
  Ring,
  StatusPill,
} from './parts';
import { specHref, titleIndex } from './suggested';

const PAGE = 60;
type Group = 'all' | 'studying' | 'learned' | 'new';

const groupOf = (s: WordStage | null): Exclude<Group, 'all'> =>
  s === 'learned' || s === 'mastered' ? 'learned' : s === 'learning' || s === 'consolidating' ? 'studying' : 'new';

const STAGE_TONE: Record<WordStage, PillTone> = {
  new: 'outline',
  learning: 'warn',
  consolidating: 'accent',
  learned: 'success',
  mastered: 'success',
};

export function DeckDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const levelData = useLevelData();
  const data = useLiveQuery(async () => (await getDeckWords(id)) ?? null, [id, levelData]);
  const titles = useMemo(() => titleIndex(t), [t]);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
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

  if (data === undefined)
    return (
      <div className="pb-10">
        <BackBar to="/decks" parent={t('deckHub.detail.parent')} />
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <Skeleton lines={6} />
        </div>
      </div>
    );
  if (data === null)
    return (
      <div className="pb-10">
        <BackBar to="/decks" parent={t('deckHub.detail.parent')} />
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <Surface>
            <EmptyState
              icon="layers"
              title={t('deckHub.detail.notFound')}
              description={t('deckHub.detail.notFoundBody')}
              action={
                <Link to="/decks" className="font-medium text-accent-text hover:underline">
                  {t('deckHub.detail.toMine')}
                </Link>
              }
            />
          </Surface>
        </div>
      </div>
    );

  const { deck, filter, words } = data;
  const tag = soleTag(filter);
  const suggested = tag ? titles.get(tag.toLocaleLowerCase('tr')) : undefined;
  const counts = { studying: 0, learned: 0, new: 0 };
  for (const w of words) counts[groupOf(w.stage)]++;
  const list = words.filter((w) => group === 'all' || groupOf(w.stage) === group);
  const studied = counts.learned + counts.studying;

  return (
    <div className="pb-10">
      <BackBar
        to="/decks"
        parent={t('deckHub.detail.parent')}
        actions={
          <DropdownMenu
            label={t('deckHub.detail.actions')}
            trigger={<IconButton icon="more" label={t('deckHub.detail.actions')} />}
            items={[
              { label: t('deckHub.detail.edit'), icon: 'pencil', onSelect: () => setEditing(true) },
              { kind: 'separator' },
              {
                label: t('deckHub.detail.delete'),
                icon: 'trash',
                danger: true,
                onSelect: () => setConfirm(true),
              },
            ]}
          />
        }
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-2">
        <div className="flex flex-col gap-2 px-1">
          {suggested && (
            <span className="self-start rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">
              {t('deckHub.mine.fromSuggestion')}
            </span>
          )}
          <h1 className="font-serif text-[30px] leading-[1.12] font-semibold break-words text-fg">
            {deck.name}
          </h1>
          <p className="text-[15px] text-fg-muted">
            {filter ? describeDeckFilter(t, filter) : t('deckHub.detail.unsupported')}
          </p>
        </div>

        {filter && words.length > 0 && (
          <section
            aria-label={t('deckHub.detail.status')}
            className="flex items-center gap-5 rounded-[20px] border border-border bg-surface p-[18px]"
          >
            <Ring
              total={words.length}
              segments={[
                { value: counts.learned, color: MARK.learned },
                { value: counts.studying, color: MARK.studying },
              ]}
              center={`%${pct(counts.learned, words.length)}`}
              caption={t('deckHub.detail.learnedPct')}
            />
            <ul className="flex flex-1 flex-col gap-3">
              <LegendRow color={MARK.learned} value={counts.learned} label={t('deckHub.detail.learned')} />
              <LegendRow color={MARK.studying} value={counts.studying} label={t('deckHub.detail.studying')} />
              <LegendRow color={MARK.faint} value={counts.new} label={t('deckHub.detail.fresh')} />
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-2.5">
          {studied > 0 && (
            <Link
              to={deckStudyHref(deck.id)}
              className="flex h-[54px] items-center justify-center rounded-[14px] bg-accent text-[17px] font-semibold text-accent-fg hover:bg-accent-hover"
            >
              {t('deckHub.study')}
            </Link>
          )}
          {tag && !suggested && (
            <Button variant="secondary" size="lg" leadingIcon="plus" fullWidth onClick={() => setPicking(true)}>
              {t('deckHub.detail.addWords')}
            </Button>
          )}
          {suggested && (
            <Link
              to={specHref(suggested)}
              className="flex h-[52px] items-center justify-center rounded-[14px] border border-border bg-surface text-[15px] font-semibold text-fg hover:border-border-strong"
            >
              {t('deckHub.detail.suggestedOpen')}
            </Link>
          )}
        </div>

        {filter && (
          <section aria-labelledby="dd-words" className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between px-1 pt-1">
              <h2 id="dd-words" className="font-serif text-[19px] font-semibold text-fg">
                {t('deckHub.detail.words')}
              </h2>
              <span className="text-[13px] text-fg-muted">{t('deckHub.detail.newest')}</span>
            </div>
            {words.length === 0 ? (
              <p className="rounded-[20px] border border-border bg-surface p-4 text-[15px] text-fg-muted">
                {tag && !suggested ? t('deckHub.detail.emptyTag') : t('deckHub.detail.empty')}
              </p>
            ) : (
              <>
                <div
                  role="group"
                  aria-label={t('deckHub.detail.filter')}
                  className="-mr-4 flex gap-2 overflow-x-auto pr-4 [scrollbar-width:none]"
                >
                  {(
                    [
                      ['all', t('deckHub.detail.fAll', { count: words.length })],
                      ['studying', t('deckHub.detail.fStudying', { count: counts.studying })],
                      ['learned', t('deckHub.detail.fLearned', { count: counts.learned })],
                      ['new', t('deckHub.detail.fNew', { count: counts.new })],
                    ] as [Group, string][]
                  ).map(([g, label]) => (
                    <FilterChip
                      key={g}
                      pressed={group === g}
                      onClick={() => {
                        setGroup(g);
                        setShown(PAGE);
                      }}
                    >
                      {label}
                    </FilterChip>
                  ))}
                </div>
                <ul
                  aria-label={t('deckHub.detail.words')}
                  className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-surface"
                >
                  {list.slice(0, shown).map((w) => (
                    <WordRow key={w.note.id} row={w} />
                  ))}
                </ul>
                {list.length > shown && (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE)}
                    className="flex h-12 items-center justify-center text-[15px] font-semibold text-accent-text hover:underline"
                  >
                    {t('deckHub.suggested.more', { count: Math.min(PAGE, list.length - shown) })}
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>

      <DeckEditorDialog open={editing} onOpenChange={setEditing} deck={deck} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('decks.deleteTitle', { name: deck.name })}
        description={t('decks.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deleteDeck(deck.id);
            toast({ title: t('decks.deleted'), tone: 'success' });
            void navigate('/decks', { replace: true });
          } catch (e) {
            void logError(e, 'DeckDetail.delete');
            toast({ title: t('decks.failed'), tone: 'danger' });
          } finally {
            setBusy(false);
            setConfirm(false);
          }
        }}
      />
      {tag && (
        <WordPicker
          open={picking}
          onOpenChange={setPicking}
          deckName={deck.name}
          tag={tag}
        />
      )}
    </div>
  );
}

function WordRow({ row }: { row: DeckWordRow }) {
  const { t } = useTranslation();
  const stage: WordStage = row.stage ?? 'new';
  return (
    <li className="border-b border-surface-sunken last:border-b-0">
      <Link
        to={`/library?note=${encodeURIComponent(row.note.id)}`}
        aria-label={t('deckHub.detail.openWord', { term: row.note.term })}
        className="flex min-h-[58px] items-center gap-2.5 px-4 py-2.5 hover:bg-hover"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span lang="en" className="truncate font-serif text-lg font-semibold text-fg">
              {row.note.term}
            </span>
            {row.pos && <span className="text-xs text-fg-muted">{posLabel(t, row.pos)}</span>}
          </span>
          <span className="truncate text-sm text-fg-muted">{row.meaning ?? t('deckHub.detail.noMeaning')}</span>
        </span>
        <StatusPill tone={STAGE_TONE[stage]}>{STAGE_LABEL_TR[stage]}</StatusPill>
      </Link>
    </li>
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
    () => (open ? db.notes.filter((n) => n.deleted_at === null && !hasTag(n.tags, tag)).toArray() : []),
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
