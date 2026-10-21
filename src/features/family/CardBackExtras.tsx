import { useTranslation } from 'react-i18next';
import { morphemeMeaning, morphemeOfNote, wordsWithMorpheme } from '@/domain/morphology';
import type { Note } from '@/domain/types';
import { FalseFriendStrips } from './FalseFriendStrip';
import { useMorphology, useUserWords } from './hooks';

/**
 * Extra lines on the back of a card: the false-friend warning for a word, and for a root or
 * affix card its short explanation and the user's words that carry it.
 */
export function CardBackExtras({ note }: { note: Pick<Note, 'term' | 'term_norm' | 'term_type'> }) {
  if (note.term_type === 'affix') return <AffixBack termNorm={note.term_norm} />;
  return <FalseFriendStrips term={note.term_norm} />;
}

function AffixBack({ termNorm }: { termNorm: string }) {
  const { t } = useTranslation();
  const index = useMorphology();
  const words = useUserWords();
  if (!index || !words) return null;
  const m = morphemeOfNote(index, termNorm);
  if (!m) return null;
  const mine = wordsWithMorpheme(index, m.id, words.words);
  const { note } = morphemeMeaning(m);
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2 border-t border-border pt-4" data-testid="affix-back">
      {note && <p className="text-[0.9375rem] text-fg-muted">{note}</p>}
      {mine.length > 0 && (
        <p className="text-[0.9375rem] text-fg-muted">
          <span>{t('family.yourWords')}: </span>
          <span lang="en" className="font-serif text-fg">
            {mine
              .slice(0, 8)
              .map((w) => w.term)
              .join(' · ')}
          </span>
        </p>
      )}
    </div>
  );
}
