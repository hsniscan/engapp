// Client of the ai-story edge function (v0.5 İP8, decision 0050): the day's target words,
// level, difficulty and topics in; the checked story out. Validated with the server's own
// contract, and the request is built only from those fields (the contract is closed).
import {
  storyRequest,
  storyResponse,
  type StoryRequest,
  type StoryResponse,
} from '../../supabase/functions/_shared/story-contract';
import { call, type AiClientDeps } from './client';

export type { StoryRequest, StoryResponse };

export async function fetchStory(input: StoryRequest, deps: AiClientDeps = {}): Promise<StoryResponse> {
  const body = storyRequest.parse(input);
  // Two model calls at most on the server (12 s each); leave room for the round trip.
  return call('ai-story', body, (x) => storyResponse.parse(x), { timeoutMs: 40_000, ...deps });
}
