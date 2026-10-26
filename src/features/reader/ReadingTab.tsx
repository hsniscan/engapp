// Okuma (v0.5 İP1; Keşfet → Okuma from v0.5.1): "Metinlerim" (continue where you left off,
// delete) and the graded library below it (İP5's GradedLibraryList). A library text the user
// opened is listed once, here, as "Okunuyor %x · Devam et" (v0.5.1, decision 0054); the
// library list below leaves it out.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { deleteText, listTexts, logError } from '@/data';
import { readerPath, type ReaderText } from '@/domain/texts';
import { ConfirmDialog } from '@/features/cards/ConfirmDialog';
import { openAddSheet } from '@/features/add/addSheetStore';
import { GradedLibraryList } from '@/features/library/GradedLibraryList';
import { Button, IconButton, Skeleton, toast } from '@/ui';

const progressPct = (t: ReaderText) =>
  t.finished_at !== null
    ? 100
    : t.body.length
      ? Math.min(99, Math.round((t.progress_offset / t.body.length) * 100))
      : 0;

export function ReadingTab() {
  const { t } = useTranslation();
  const texts = useLiveQuery(() => listTexts(), []);
  const [toDelete, setToDelete] = useState<ReaderText | null>(null);

  const remove = async () => {
    if (!toDelete) return;
    try {
      await deleteText(toDelete.id);
      toast({ title: t('reader.list.deleted') });
    } catch (e) {
      void logError(e, 'reader.delete');
      toast({ title: t('reader.list.deleteFailed'), tone: 'danger' });
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="my-texts" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="my-texts" className="font-serif text-xl font-semibold text-fg">
            {t('reader.list.title')}
          </h2>
          <Button variant="ghost" size="sm" leadingIcon="plus" onClick={() => openAddSheet()}>
            {t('reader.list.add')}
          </Button>
        </div>
        {texts === undefined ? (
          <Skeleton lines={3} />
        ) : texts.length === 0 ? (
          <p className="rounded-[18px] border border-border bg-surface px-4 py-4 text-[0.9375rem] text-fg-muted">
            {t('reader.list.empty')}
          </p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-border overflow-hidden rounded-[18px] border border-border bg-surface"
            data-testid="my-texts"
          >
            {texts.map((text) => {
              const pct = progressPct(text);
              return (
                <li key={text.id} className="flex items-center gap-2 py-1 pr-1.5 pl-4">
                  <Link
                    to={readerPath(text.id)}
                    className="flex min-w-0 flex-1 flex-col gap-1 py-2.5"
                  >
                    <span
                      lang="en"
                      className="truncate font-serif text-[1.0625rem] font-semibold text-fg"
                    >
                      {text.title}
                    </span>
                    <span className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
                      <span>{t(`reader.kind.${text.kind}`)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {text.finished_at !== null
                          ? t('reader.list.finished')
                          : pct > 0
                            ? t('reader.list.reading', { pct })
                            : t('reader.list.unread')}
                      </span>
                      {text.finished_at === null && pct > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-accent-text">
                            {t('reader.list.continue')}
                          </span>
                        </>
                      )}
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-0.5 h-1 w-full max-w-48 overflow-hidden rounded-full bg-surface-sunken"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </Link>
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={t('reader.list.delete', { title: text.title })}
                    onClick={() => setToDelete(text)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <GradedLibraryList hideOwn />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('reader.list.confirmTitle')}
        description={t('reader.list.confirmBody', { title: toDelete?.title ?? '' })}
        confirmLabel={t('reader.list.confirm')}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
