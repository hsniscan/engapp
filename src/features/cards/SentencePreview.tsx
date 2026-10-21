import { useTranslation } from 'react-i18next';
import { Icon } from '@/ui';
import type { Span } from './locateTerm';

/** Shows the example sentence with the located term highlighted, or why no cloze card will be made. */
export function SentencePreview({
  sentence,
  span,
  id,
}: {
  sentence: string;
  span: Span | null;
  id?: string;
}) {
  const { t } = useTranslation();
  if (!sentence.trim()) return null;
  if (!span) {
    return (
      <p id={id} className="flex items-start gap-1.5 text-sm text-warn-text" aria-live="polite">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
        <span>{t('cards.sentence.notFound')}</span>
      </p>
    );
  }
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-fg-muted" aria-live="polite">
      <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success-text" />
      <span>
        {t('cards.sentence.found')}{' '}
        <span lang="en" className="font-serif text-[0.9375rem] text-fg italic">
          {sentence.slice(0, span[0])}
          <mark className="rounded-[3px] bg-accent-soft px-0.5 text-accent-text not-italic">
            {sentence.slice(span[0], span[1])}
          </mark>
          {sentence.slice(span[1])}
        </span>
      </span>
    </p>
  );
}
