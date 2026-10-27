// Client of the ai-story edge function (v0.5 İP8, decision 0050): the day's target words,
// level, difficulty and topics in; the checked story out. Validated with the server's own
// contract, and the request is built only from those fields (the contract is closed).
//
// v0.5.1 (decision 0056): a picked text ("Kelimelerimle metin oluştur") adds `source`, `genre`
// and `length`. A daily story is sent exactly as before (no new keys), so it keeps working
// against a server that does not know them yet.
import {
  storyRequest,
  storyResponse,
  type StoryRequest,
  type StoryResponse,
} from '../../supabase/functions/_shared/story-contract';
import { call, type AiClientDeps } from './client';

export type { StoryRequest, StoryResponse };

/** What goes over the wire for a request (pure; the privacy test reads it). */
export function storyWireBody(input: StoryRequest): Record<string, unknown> {
  const body = storyRequest.parse(input);
  if (body.source === 'picked') return body;
  const { source: _s, genre: _g, length: _l, ...daily } = body;
  return daily;
}

export async function fetchStory(
  input: StoryRequest,
  deps: AiClientDeps = {},
): Promise<StoryResponse> {
  const body = storyWireBody(input);
  // Two model calls at most on the server (12 s each); leave room for the round trip.
  return call('ai-story', body, (x) => storyResponse.parse(x), { timeoutMs: 40_000, ...deps });
}
