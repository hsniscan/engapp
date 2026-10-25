// "Etiketler" from Destelerim → Düzenleme araçları: the user's tags with their counts, open one
// in Tüm kelimelerim, rename (merging) or delete it. Moved here from the old Desteler page.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { deleteTag, listTags, logError, renameTag } from '@/data';
import { cleanTag, MAX_TAG_LENGTH } from '@/domain/tags';
import {
  Button,
  Dialog,
  DialogClose,
  DropdownMenu,
  IconButton,
  Skeleton,
  TextField,
  toast,
} from '@/ui';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import { nf } from './deckUi';

export function TagsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const tags = useLiveQuery(() => listTags(), []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ tag: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('decks.tags.title')}
        description={tags && tags.length === 0 ? t('decks.tags.empty') : t('decks.tags.body')}
      >
        {tags === undefined ? (
          <Skeleton lines={3} />
        ) : (
          tags.length > 0 && (
            <ul
              aria-label={t('decks.tags.listLabel')}
              className="-mx-2 divide-y divide-border overflow-y-auto"
            >
              {tags.map((x) => (
                <li key={x.tag} className="flex items-center gap-1">
                  <Link
                    to={`/library?tag=${encodeURIComponent(x.tag)}`}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-control px-2 hover:bg-hover"
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
          )
        )}
      </Dialog>
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
    </>
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
