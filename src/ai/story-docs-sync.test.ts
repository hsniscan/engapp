// docs/ai-story.md must contain the exact prompt and schema that ai-story sends.
import doc from '../../docs/ai-story.md?raw';
import { describe, expect, it } from 'vitest';
import {
  PICKED_PROMPT_VERSION,
  STORY_PROMPT_VERSION,
} from '../../supabase/functions/_shared/story-contract';
import {
  PICKED_SYSTEM_PROMPT,
  STORY_RESPONSE_SCHEMA,
  STORY_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/story-prompt';

describe('docs/ai-story.md', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${STORY_PROMPT_VERSION}\``);
    expect(doc).toContain(STORY_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(STORY_RESPONSE_SCHEMA);
  });

  it('documents the picked-text prompt verbatim (v0.5.1)', () => {
    expect(doc).toContain(`\`${PICKED_PROMPT_VERSION}\``);
    expect(doc).toContain(PICKED_SYSTEM_PROMPT);
  });
});
