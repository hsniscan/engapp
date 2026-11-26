// /study (redesign IA): "?mode=word|production|cloze" starts that study type, "?mode=mixed" all
// three in one session, no mode shows the StudyModes picker. "/review" stays an alias of
// mode=word (ReviewRoute), "/review?mode=ahead" is tomorrow's cards. "&deck=<id>" keeps a
// session to one smart deck.
import { useLocation, useSearchParams } from 'react-router';
import { isStudyMode } from '@/domain/studyMode';
import { ReviewScreen } from './ReviewScreen';
import { StudyModesPage } from './StudyModesPage';

export { ReviewRoute } from './ReviewScreen';

/** A fresh session for every navigation (also a second start of the same mode). */
export function StudyRoute() {
  const location = useLocation();
  const [search] = useSearchParams();
  const mode = search.get('mode');
  if (mode === 'ahead') return <ReviewScreen key={location.key} ahead />;
  if (mode === 'mixed') return <ReviewScreen key={location.key} />;
  // "&deck=<id>": only that deck's words (Desteler → "Çalış").
  const deck = search.get('deck');
  // "&new=10&seed=…" (ADR 0080): the deck session's size and the shuffle of its new words.
  const deckNew = intParam(search.get('new'), 0, 100);
  const deckSeed = intParam(search.get('seed'), 0, 0xffffffff);
  if (isStudyMode(mode))
    return (
      <ReviewScreen
        key={location.key}
        studyMode={mode}
        {...(deck ? { deckId: deck } : {})}
        {...(deck && deckNew !== null ? { deckNew } : {})}
        {...(deck && deckSeed !== null ? { deckSeed } : {})}
      />
    );
  return <StudyModesPage />;
}

/** A whole number in [min, max] from the URL, or null. */
function intParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export default StudyRoute;
