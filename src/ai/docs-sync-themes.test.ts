// docs/ai-pipeline.md must contain the exact ai-themes prompt and schema that the code sends.
import doc from '../../docs/ai-pipeline.md?raw';
import { describe, expect, it } from 'vitest';
import {
  THEMES_PROMPT_VERSION,
  THEMES_RESPONSE_SCHEMA,
  THEMES_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/themes';

describe('docs/ai-pipeline.md (ai-themes)', () => {
  it('documents the current themes prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${THEMES_PROMPT_VERSION}\``);
    expect(doc).toContain(THEMES_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(THEMES_RESPONSE_SCHEMA);
  });
});
