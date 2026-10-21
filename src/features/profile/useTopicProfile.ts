import { useLiveQuery } from 'dexie-react-hooks';
import { getTopicProfile, type TopicProfile } from '@/data';

/**
 * The live interest profile (undefined while loading). Other features use `ranked`, or
 * `orderContexts(contexts, profile.weights)` from '@/domain/profile'.
 */
export function useTopicProfile(): TopicProfile | undefined {
  return useLiveQuery(() => getTopicProfile(), []);
}
