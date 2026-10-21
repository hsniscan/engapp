// docs/ai-examples.md must contain the exact prompt and schema that ai-examples sends.
import doc from '../../docs/ai-examples.md?raw';
import { describe, expect, it } from 'vitest';
import {
  EXAMPLES_PROMPT_VERSION,
  EXAMPLES_RESPONSE_SCHEMA,
  EXAMPLES_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/examples-prompt';

describe('docs/ai-examples.md', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${EXAMPLES_PROMPT_VERSION}\``);
    expect(doc).toContain(EXAMPLES_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(EXAMPLES_RESPONSE_SCHEMA);
  });
});
