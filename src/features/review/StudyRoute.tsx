// /study (redesign IA): "?mode=word|production|cloze" starts that study type, "?mode=mixed" all
// three in one session, no mode shows the StudyModes picker. "/review" stays an alias of
// mode=word (ReviewRoute), "/review?mode=ahead" is tomorrow's cards.
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
  if (isStudyMode(mode)) return <ReviewScreen key={location.key} studyMode={mode} />;
  return <StudyModesPage />;
}

export default StudyRoute;
