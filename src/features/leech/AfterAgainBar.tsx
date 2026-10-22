// A short line above the next card after an "Again" answer: the leech flag the moment a card
// is forgotten for the 6th time ("Başka yoldan bakalım"), otherwise the optional question
// "başka bir kelimeyle mi karıştı?". Nothing here changes a card by itself.
import { useTranslation } from 'react-i18next';
import type { Id } from '@/domain/types';
import { Button, cn, Icon, IconButton } from '@/ui';

export interface LeechNotice {
  cardId: Id;
  noteId: Id;
  term: string;
  lapses: number;
  /** This answer made the card a leech. */
  crossed: boolean;
  /** The word can be mixed up with another (not a root/affix or contrast card). */
  confusable: boolean;
}

export function AfterAgainBar({
  notice,
  onOpenSheet,
  onPickConfusion,
  onDismiss,
}: {
  notice: LeechNotice;
  onOpenSheet: () => void;
  onPickConfusion: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  if (!notice.crossed && !notice.confusable) return null;
  return (
    <div
      role="status"
      data-testid={notice.crossed ? 'leech-flag' : 'confusion-prompt'}
      className={cn(
        'mb-3 flex items-center gap-2 rounded-control py-1.5 pr-1 pl-3 text-sm',
        notice.crossed ? 'bg-warn-soft text-warn-text' : 'bg-surface-sunken text-fg-muted',
      )}
    >
      {notice.crossed && <Icon name="alert" size={16} className="shrink-0" />}
      <p className="min-w-0 flex-1">
        {notice.crossed
          ? t('leech.afterAgain.crossed', { term: notice.term, count: notice.lapses })
          : t('leech.afterAgain.confused', { term: notice.term })}
      </p>
      <Button
        size="sm"
        variant={notice.crossed ? 'secondary' : 'ghost'}
        className="shrink-0"
        onClick={notice.crossed ? onOpenSheet : onPickConfusion}
      >
        {notice.crossed ? t('leech.afterAgain.crossedAction') : t('leech.afterAgain.confusedAction')}
      </Button>
      <IconButton icon="x" size="sm" label={t('common.close')} className="shrink-0" onClick={onDismiss} />
    </div>
  );
}
