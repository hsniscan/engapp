// "Serin korundu" on Bugün (v0.5 İP10, docs/decisions/0052-smart-review.md): the calm note on
// the day after a streak protection covered a missed day. Opening Bugün also applies the
// protections (ensureStreakFreezes writes only when a missed day is to be covered).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissFreezeNote, ensureStreakFreezes, getStreakFreezeView, logError } from '@/data';
import { HomeIcon } from '@/features/home/homeIcons';
import { IconButton } from '@/ui';

export function StreakFreezeNote() {
  const { t } = useTranslation();
  useEffect(() => {
    void ensureStreakFreezes().catch((e: unknown) => void logError(e, 'smart.ensureFreezes'));
  }, []);
  const view = useLiveQuery(() => getStreakFreezeView(), []);
  const note = view?.note;
  if (!view || !note) return null;
  return (
    <aside
      aria-labelledby="streak-freeze-title"
      className="flex items-start gap-3 rounded-[18px] border border-border bg-surface py-3 pr-1.5 pl-4"
      data-testid="streak-freeze-note"
    >
      <HomeIcon name="flame" size={20} strokeWidth={1.8} className="mt-0.5 text-warn-text" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        <h2 id="streak-freeze-title" className="text-[0.9375rem] font-semibold">
          {t('smart.freeze.title')}
        </h2>
        <p className="text-sm text-fg-muted">
          {t('smart.freeze.body', { count: note.covered })}{' '}
          {note.left > 0
            ? t('smart.freeze.left', { count: note.left })
            : t('smart.freeze.leftNone', { perMonth: view.perMonth })}
        </p>
        <p className="text-xs text-fg-subtle">{t('smart.freeze.rule', { perMonth: view.perMonth })}</p>
      </div>
      <IconButton
        icon="x"
        label={t('common.close')}
        tooltip={false}
        className="-mt-1"
        onClick={() =>
          void dismissFreezeNote(note.day).catch((e: unknown) => void logError(e, 'smart.freezeNote'))
        }
      />
    </aside>
  );
}
