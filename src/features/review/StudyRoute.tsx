// PLACEHOLDER (agent B, redesign router): /study?mode=word|production|cloze runs a session of
// that study type, /study alone shows the StudyModes picker. The study-session owner replaces
// this file; until then every mode opens the old combined session and the picker is the old
// "Biraz daha çalış" page (its old address /more redirects here).
import { useSearchParams } from 'react-router';
import { MoreStudyPage } from '@/features/extra/MoreStudyPage';
import { ReviewRoute } from './ReviewScreen';

export function StudyRoute() {
  const [search] = useSearchParams();
  return search.has('mode') ? <ReviewRoute /> : <MoreStudyPage />;
}
