// docs/ai-pipeline.md must contain the morpheme job's prompt and schema exactly as sent.
import doc from '../../docs/ai-pipeline.md?raw';
import { describe, expect, it } from 'vitest';
import {
  MORPHEME_PROMPT_VERSION,
  MORPHEME_RESPONSE_SCHEMA,
  MORPHEME_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/morphemes';

describe('docs/ai-pipeline.md, morpheme job', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${MORPHEME_PROMPT_VERSION}\``);
    expect(doc).toContain(MORPHEME_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(MORPHEME_RESPONSE_SCHEMA);
  });
});
