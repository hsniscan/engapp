import { useTranslation } from 'react-i18next';
import { clearPairNoteFeedback, logError, setPairNoteFeedback } from '@/data';
import { falseFriendsFor, type FalseFriendNote } from '@/domain/pairNotes';
import { cn, Icon, toast } from '@/ui';
import { useFalseFriendIndex, useHiddenPairNotes } from './hooks';

/**
 * The false-friend warnings for a term ("actually ≠ aktüel"), one strip each: an alert icon
 * and a label (never colour alone), what each word means, and "Gizle" / "Hatalı".
 */
export function FalseFriendStrips({ term, className }: { term: string; className?: string }) {
  const index = useFalseFriendIndex();
  const all = index ? falseFriendsFor(term, index) : [];
  const hidden = useHiddenPairNotes(all.map((n) => n.key));
  if (!index || !hidden) return null;
  const notes = all.filter((n) => !hidden.has(n.key));
  if (!notes.length) return null;
  return (
    <div className={cn('flex w-full max-w-md flex-col gap-2', className)}>
      {notes.map((n) => (
        <FalseFriendStrip key={n.key} note={n} />
      ))}
    </div>
  );
}

function FalseFriendStrip({ note }: { note: FalseFriendNote }) {
  const { t } = useTranslation();
  const c = note.content;
  const act = (verdict: 'dismissed' | 'reported') => (e: React.MouseEvent) => {
    // The strip sits on the review card: a click must not reach the card.
    e.stopPropagation();
    setPairNoteFeedback(note.key, verdict).then(
      () =>
        toast({
          title: t(verdict === 'dismissed' ? 'family.falseFriend.hidden' : 'family.falseFriend.reported'),
          ...(verdict === 'reported' ? { description: t('family.falseFriend.reportedBody') } : {}),
          tone: 'neutral',
          action: {
            label: t('common.undo'),
            onClick: () => void clearPairNoteFeedback(note.key),
          },
        }),
      (err: unknown) => void logError(err, 'FalseFriendStrip.feedback'),
    );
  };
  return (
    <section
      aria-label={t('family.falseFriend.label')}
      data-testid="false-friend"
      className="rounded-control border border-warn/40 bg-warn-soft px-3 pt-2.5 pb-1.5 text-left text-sm"
    >
      <div className="flex gap-2.5">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn-text" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-warn-text">
            <strong className="font-semibold">{t('family.falseFriend.label')}</strong>
            <span aria-hidden="true"> · </span>
            <span className="text-[0.8125rem]">
              {t(c.strength === 'full' ? 'family.falseFriend.full' : 'family.falseFriend.partial')}
            </span>
          </p>
          <p className="text-fg">
            <span lang="en" className="font-serif font-semibold">
              {note.term}
            </span>{' '}
            = {c.en_meaning_tr}
          </p>
          <p className="text-fg">
            <span lang="tr" className="font-serif font-semibold">
              {c.tr_word}
            </span>{' '}
            = {c.tr_meaning_tr}
            {c.tr_meaning_en && (
              <span className="text-fg-muted">
                {' '}
                ({t('family.falseFriend.trEn', { en: c.tr_meaning_en })})
              </span>
            )}
          </p>
          {c.note_tr && <p className="text-[0.8125rem] text-fg-muted">{c.note_tr}</p>}
        </div>
      </div>
      <div className="mt-0.5 flex justify-end gap-1">
        <button
          type="button"
          onClick={act('dismissed')}
          className="inline-flex h-9 items-center rounded-control px-2.5 text-[0.8125rem] font-medium text-warn-text hover:bg-warn/15"
        >
          {t('family.falseFriend.hide')}
        </button>
        <button
          type="button"
          onClick={act('reported')}
          aria-label={t('family.falseFriend.reportLabel')}
          className="inline-flex h-9 items-center rounded-control px-2.5 text-[0.8125rem] font-medium text-warn-text hover:bg-warn/15"
        >
          {t('family.falseFriend.report')}
        </button>
      </div>
    </section>
  );
}
