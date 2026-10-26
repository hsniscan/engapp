// POST /functions/v1/ai-story — "Bugünün hikâyesi". Contract: _shared/story-contract.ts;
// design: docs/decisions/0050-daily-story.md; prompt: docs/ai-story.md.
import { createStoryFunction } from '../_shared/setup.ts';

Deno.serve(createStoryFunction((k) => Deno.env.get(k)));
