// "Serin korundu" on Bugün (v0.5 İP10, docs/decisions/0052-smart-review.md): the calm note on
// the day after a streak protection covered a missed day. Opening Bugün also applies the
// protections (ensureStreakFreezes writes only when a missed day is to be covered).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissFreezeNote, ensureStreakFreezes, getStreakFreezeView, logError } from '@/data';
import { HomeNote } from '@/features/home/HomeNote';

export function StreakFreezeNote() {
  const { t } = useTranslation();
  useEffect(() => {
    void ensureStreakFreezes().catch((e: unknown) => void logError(e, 'smart.ensureFreezes'));
  }, []);
  const view = useLiveQuery(() => getStreakFreezeView(), []);
  const note = view?.note;
  if (!view || !note) return null;
  return (
    <HomeNote
      titleId="streak-freeze-title"
      icon="flame"
      title={t('smart.freeze.title')}
      data-testid="streak-freeze-note"
      onClose={() =>
        void dismissFreezeNote(note.day).catch((e: unknown) => void logError(e, 'smart.freezeNote'))
      }
    >
      <p>
        {t('smart.freeze.body', { count: note.covered })}{' '}
        {note.left > 0
          ? t('smart.freeze.left', { count: note.left })
          : t('smart.freeze.leftNone', { perMonth: view.perMonth })}
      </p>
      <p>{t('smart.freeze.rule', { perMonth: view.perMonth })}</p>
    </HomeNote>
  );
}
