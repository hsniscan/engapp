// Okuma (v0.5 İP1; Keşfet → Okuma from v0.5.1; Çam look v0.5.2): "Metinlerim" (continue where
// you left off, delete with "Geri al") and the graded library below it (İP5's
// GradedLibraryList). A library text the user opened is listed once, here, with its progress
// (decision 0054); the library list below leaves it out.
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { deleteText, listTexts, logError, restoreText } from '@/data';
import { readerPath, readingProgress, type ReaderText } from '@/domain/texts';
import { openAddSheet } from '@/features/add/addSheetStore';
import { GradedLibraryList } from '@/features/library/GradedLibraryList';
import {
  Button,
  EmptyState,
  IconButton,
  ListGroup,
  ListRow,
  ProgressBar,
  SectionHeader,
  Skeleton,
  toast,
} from '@/ui';
import { useTextKindLabel } from './kindLabel';
import { progressLabel } from './progressLabel';

export function ReadingTab() {
  const { t } = useTranslation();
  const kindLabel = useTextKindLabel();
  const texts = useLiveQuery(() => listTexts(), []);

  // Deleting is reversible: done at once, with "Geri al" (docs/design.md §4.19).
  const remove = async (text: ReaderText) => {
    try {
      const gone = await deleteText(text.id);
      toast.undo({
        title: t('reader.list.deleted', { title: text.title }),
        undoLabel: t('ui.undo'),
        onUndo: () =>
          void restoreText(text.id, gone.deleted_at ?? 0).catch(
            (e: unknown) => void logError(e, 'reader.restore'),
          ),
      });
    } catch (e) {
      void logError(e, 'reader.delete');
      toast({ title: t('reader.list.deleteFailed'), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="my-texts">
        <SectionHeader
          id="my-texts"
          title={t('reader.list.title')}
          action={
            <Button variant="ghost" size="sm" leadingIcon="plus" onClick={() => openAddSheet('text')}>
              {t('reader.list.add')}
            </Button>
          }
        />
        {texts === undefined ? (
          <Skeleton lines={3} />
        ) : texts.length === 0 ? (
          <EmptyState
            compact
            tone="placeholder"
            icon="file"
            title={t('reader.list.emptyTitle')}
            description={t('reader.list.empty')}
            action={
              <Button variant="secondary" leadingIcon="plus" onClick={() => openAddSheet('text')}>
                {t('reader.list.add')}
              </Button>
            }
          />
        ) : (
          <ListGroup data-testid="my-texts">
            {texts.map((text) => {
              const p = readingProgress(text);
              return (
                <div key={text.id} className="flex items-center pr-2">
                  <ListRow
                    to={readerPath(text.id)}
                    term
                    className="min-w-0 flex-1 pr-2"
                    title={text.title}
                    description={
                      <span className="flex flex-col gap-1.5">
                        <span>
                          {kindLabel(text)} · {progressLabel(t, text)}
                        </span>
                        {p.state === 'started' && p.pct > 0 && (
                          <span aria-hidden="true" className="block max-w-48">
                            <ProgressBar value={p.pct} label={progressLabel(t, text)} />
                          </span>
                        )}
                      </span>
                    }
                  />
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={t('reader.list.delete', { title: text.title })}
                    tooltip={false}
                    onClick={() => void remove(text)}
                  />
                </div>
              );
            })}
          </ListGroup>
        )}
      </section>

      <GradedLibraryList hideOwn />
    </div>
  );
}
