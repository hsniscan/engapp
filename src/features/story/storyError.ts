// Which calm Turkish line a failed story request gets (`story.errors`).
import { AiClientError } from '@/ai/client';
import { StoryUnavailable } from '@/data/story';

export type StoryError = 'offline' | 'guest' | 'used' | 'budget' | 'notEnough' | 'generic';

export function storyError(e: unknown): StoryError {
  if (e instanceof StoryUnavailable) return 'notEnough';
  if (!(e instanceof AiClientError)) return 'generic';
  switch (e.code) {
    case 'offline':
      return 'offline';
    case 'not_signed_in':
    case 'unauthorized':
      return 'guest';
    case 'daily_limit':
      return 'used';
    case 'budget_exhausted':
      return 'budget';
    default:
      return 'generic';
  }
}
