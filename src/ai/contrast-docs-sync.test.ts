// docs/ai-contrast.md must contain the exact prompt and schema that ai-contrast sends.
import doc from '../../docs/ai-contrast.md?raw';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PROMPT_VERSION } from '../../supabase/functions/_shared/contrast-contracts';
import { CONTRAST_RESPONSE_SCHEMA, CONTRAST_SYSTEM_PROMPT } from '../../supabase/functions/_shared/contrast-prompt';

describe('docs/ai-contrast.md', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${CONTRAST_PROMPT_VERSION}\``);
    expect(doc).toContain(CONTRAST_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(CONTRAST_RESPONSE_SCHEMA);
  });
});
