import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DeckSummary } from '@/data';
import { cn, Icon } from '@/ui';
import { Chip } from './Chip';

/**
 * Deck shortcuts above the Cards list: "Tüm kelimeler", one chip per deck (with its count)
 * and a link to the deck screen. Scrolls sideways on a phone instead of wrapping.
 */
export function DeckChips({
  decks,
  active,
  onSelect,
}: {
  decks: DeckSummary[];
  active: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const nf = new Intl.NumberFormat('tr-TR');
  return (
    <div
      role="group"
      aria-label={t('library.decks.label')}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {decks.length > 0 && (
        <Chip pressed={active === null} onClick={() => onSelect(null)}>
          {t('library.decks.all')}
        </Chip>
      )}
      {decks.map(({ deck, count }) => (
        <Chip
          key={deck.id}
          pressed={active === deck.id}
          meta={count === null ? '–' : nf.format(count)}
          onClick={() => onSelect(active === deck.id ? null : deck.id)}
          className="max-w-[16rem]"
        >
          {deck.name}
        </Chip>
      ))}
      <Link
        to="/decks"
        className={cn(
          "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border-strong/70 px-3.5 text-sm whitespace-nowrap text-fg-muted after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
          'transition-colors duration-(--duration-micro) hover:border-border-strong hover:text-fg',
        )}
      >
        <Icon name={decks.length ? 'layers' : 'plus'} size={16} className="-ml-0.5" />
        {decks.length ? t('library.decks.manage') : t('library.decks.create')}
      </Link>
    </div>
  );
}
