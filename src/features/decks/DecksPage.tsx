// "Desteler": smart decks (create, edit, reorder, delete), the user's tags (rename, delete)
// and the way into AI theme grouping.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  deleteDeck,
  deleteTag,
  type DeckSummary,
  getDeckSummaries,
  getThemePreview,
  listTags,
  logError,
  moveDeck,
  renameTag,
} from '@/data';
import { cleanTag, MAX_TAG_LENGTH } from '@/domain/tags';
import type { Deck } from '@/domain/types';
import {
  Button,
  buttonClasses,
  Dialog,
  DialogClose,
  DropdownMenu,
  EmptyState,
  IconButton,
  Page,
  Skeleton,
  Surface,
  TextField,
  toast,
} from '@/ui';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import { practiceHref } from '@/features/extra/links';
import { useLevelData } from '@/features/levels/useLevelData';
import { DeckEditorDialog } from './DeckEditorDialog';
import { describeDeckFilter } from './describe';

export function DecksPage() {
  const { t } = useTranslation();
  // Counts of level decks change once the level file has loaded.
  const levelData = useLevelData();
  const decks = useLiveQuery(() => getDeckSummaries(), [levelData]);
  const [editing, setEditing] = useState<{ deck: Deck | null } | null>(null);

  return (
    <Page
      title={t('decks.title')}
      description={t('decks.description')}
      actions={
        decks && decks.length > 0 ? (
          // Phones get the full-width button under the list instead.
          <div className="hidden sm:block">
            <Button leadingIcon="plus" onClick={() => setEditing({ deck: null })}>
              {t('decks.new')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-8">
        {decks === undefined ? (
          <Surface aria-busy="true">
            <Skeleton lines={4} />
          </Surface>
        ) : decks.length === 0 ? (
          <Surface>
            <EmptyState
              icon="layers"
              title={t('decks.emptyTitle')}
              description={t('decks.emptyBody')}
              action={
                <Button leadingIcon="plus" onClick={() => setEditing({ deck: null })}>
                  {t('decks.emptyAction')}
                </Button>
              }
            />
          </Surface>
        ) : (
          <section className="flex flex-col gap-3">
            <Surface padding="none" className="overflow-hidden">
              <ul aria-label={t('decks.listLabel')}>
                {decks.map((d, i) => (
                  <DeckRow
                    key={d.deck.id}
                    summary={d}
                    first={i === 0}
                    last={i === decks.length - 1}
                    onEdit={() => setEditing({ deck: d.deck })}
                  />
                ))}
              </ul>
            </Surface>
            <Button
              variant="secondary"
              leadingIcon="plus"
              onClick={() => setEditing({ deck: null })}
              className="sm:hidden"
              fullWidth
            >
              {t('decks.new')}
            </Button>
          </section>
        )}

        <TagsSection />
        <ThemesEntry />
      </div>

      <DeckEditorDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        deck={editing?.deck ?? null}
      />
    </Page>
  );
}

function DeckRow({
  summary,
  first,
  last,
  onEdit,
}: {
  summary: DeckSummary;
  first: boolean;
  last: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deck, filter, count } = summary;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const nf = new Intl.NumberFormat('tr-TR');

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ title: done, tone: 'success' });
    } catch (e) {
      void logError(e, 'Decks.action');
      toast({ title: t('decks.failed'), tone: 'danger' });
    }
  };

  return (
    <li className="flex items-center gap-1 border-b border-border pr-2 last:border-b-0">
      <Link
        to={`/library?deck=${encodeURIComponent(deck.id)}`}
        className="group flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 focus-visible:outline-offset-[-2px] sm:pl-5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-serif text-lg leading-snug font-semibold text-fg group-hover:underline group-hover:decoration-border-strong group-hover:underline-offset-4">
            {deck.name}
          </span>
          <span className="line-clamp-2 text-sm text-fg-muted">
            {describeDeckFilter(t, filter)}
          </span>
        </span>
        <span className="tabular shrink-0 text-sm text-fg-muted">
          {count === null
            ? t('decks.needsUpdate')
            : t('decks.count', { count, formattedCount: nf.format(count) })}
        </span>
      </Link>
      <DropdownMenu
        label={t('decks.actions', { name: deck.name })}
        trigger={<IconButton icon="more" label={t('decks.actions', { name: deck.name })} />}
        items={[
          {
            label: t('decks.open'),
            icon: 'cards',
            onSelect: () => void navigate(`/library?deck=${encodeURIComponent(deck.id)}`),
          },
          {
            label: t('decks.practice'),
            icon: 'refresh',
            disabled: !count,
            onSelect: () =>
              void navigate(practiceHref({ source: 'deck', size: 10, tag: null, deck: deck.id })),
          },
          { label: t('decks.edit'), icon: 'pencil', onSelect: onEdit },
          { kind: 'separator' },
          {
            label: t('decks.up'),
            icon: 'chevron-up',
            disabled: first,
            onSelect: () => void run(() => moveDeck(deck.id, -1)),
          },
          {
            label: t('decks.down'),
            icon: 'chevron-down',
            disabled: last,
            onSelect: () => void run(() => moveDeck(deck.id, 1)),
          },
          { kind: 'separator' },
          {
            label: t('decks.delete'),
            icon: 'trash',
            danger: true,
            onSelect: () => setConfirm(true),
          },
        ]}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('decks.deleteTitle', { name: deck.name })}
        description={t('decks.deleteBody')}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await run(() => deleteDeck(deck.id), t('decks.deleted'));
          setBusy(false);
          setConfirm(false);
        }}
      />
    </li>
  );
}

function TagsSection() {
  const { t } = useTranslation();
  const tags = useLiveQuery(() => listTags(), []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ tag: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const nf = new Intl.NumberFormat('tr-TR');

  return (
    <section aria-labelledby="tags-title" className="flex flex-col gap-3">
      <div>
        <h2 id="tags-title" className="font-serif text-xl font-semibold text-fg">
          {t('decks.tags.title')}
        </h2>
        <p className="mt-1 text-[0.9375rem] text-fg-muted">
          {tags && tags.length === 0 ? t('decks.tags.empty') : t('decks.tags.body')}
        </p>
      </div>
      {tags === undefined ? (
        <Skeleton lines={2} />
      ) : (
        tags.length > 0 && (
          <Surface padding="none" className="overflow-hidden">
            <ul aria-label={t('decks.tags.listLabel')} className="divide-y divide-border">
              {tags.map((x) => (
                <li key={x.tag} className="flex items-center gap-1 pr-2">
                  <Link
                    to={`/library?tag=${encodeURIComponent(x.tag)}`}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-3 pl-4 hover:underline hover:decoration-border-strong hover:underline-offset-4 focus-visible:outline-offset-[-2px] sm:pl-5"
                  >
                    <span className="truncate font-medium text-fg">#{x.tag}</span>
                    <span className="tabular ml-auto shrink-0 text-sm text-fg-muted">
                      {t('decks.count', { count: x.count, formattedCount: nf.format(x.count) })}
                    </span>
                  </Link>
                  <DropdownMenu
                    label={t('decks.tags.actions', { tag: x.tag })}
                    trigger={
                      <IconButton icon="more" label={t('decks.tags.actions', { tag: x.tag })} />
                    }
                    items={[
                      {
                        label: t('decks.tags.rename'),
                        icon: 'pencil',
                        onSelect: () => setRenaming(x.tag),
                      },
                      {
                        label: t('decks.tags.delete'),
                        icon: 'trash',
                        danger: true,
                        onSelect: () => setDeleting(x),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Surface>
        )
      )}
      <RenameTagDialog tag={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? t('decks.tags.deleteTitle', { tag: deleting.tag }) : ''}
        description={deleting ? t('decks.tags.deleteBody', { count: deleting.count }) : ''}
        confirmLabel={t('common.delete')}
        busy={busy}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await deleteTag(deleting.tag);
            toast({ title: t('decks.tags.deleted'), tone: 'success' });
          } catch (e) {
            void logError(e, 'Tags.delete');
            toast({ title: t('decks.failed'), tone: 'danger' });
          }
          setBusy(false);
          setDeleting(null);
        }}
      />
    </section>
  );
}

function RenameTagDialog({ tag, onClose }: { tag: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (tag !== shownFor) {
    setShownFor(tag);
    if (tag) setValue(tag);
  }
  const next = cleanTag(value);
  return (
    <Dialog
      open={tag !== null}
      onOpenChange={(o) => !o && onClose()}
      title={tag ? t('decks.tags.renameTitle', { tag }) : ''}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">{t('common.cancel')}</Button>
          </DialogClose>
          <Button
            loading={busy}
            disabled={!next || next === tag || busy}
            onClick={async () => {
              if (!tag) return;
              setBusy(true);
              try {
                await renameTag(tag, next);
                toast({ title: t('decks.tags.renamed'), tone: 'success' });
                onClose();
              } catch (e) {
                void logError(e, 'Tags.rename');
                toast({ title: t('decks.failed'), tone: 'danger' });
              }
              setBusy(false);
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('decks.tags.renameLabel')}
        hint={t('decks.tags.renameHint')}
        value={value}
        maxLength={MAX_TAG_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        autoCapitalize="none"
        autoComplete="off"
      />
    </Dialog>
  );
}

function ThemesEntry() {
  const { t } = useTranslation();
  const pending = useLiveQuery(async () => !!(await getThemePreview()), []);
  return (
    <Surface as="section" aria-labelledby="themes-title" padding="none" className="p-5 sm:p-6">
      <h2 id="themes-title" className="font-serif text-xl font-semibold text-fg">
        {t('decks.themes.title')}
      </h2>
      <p className="mt-1 text-[0.9375rem] text-fg-muted">
        {pending ? t('decks.themes.pending') : t('decks.themes.body')}
      </p>
      <Link
        to="/decks/themes"
        className={buttonClasses({ variant: 'secondary', className: 'mt-5 w-full sm:w-auto' })}
      >
        {pending ? t('decks.themes.resume') : t('decks.themes.start')}
      </Link>
    </Surface>
  );
}
