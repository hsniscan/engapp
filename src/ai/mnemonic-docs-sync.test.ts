// docs/ai-mnemonic.md must contain the exact prompt and schema that ai-mnemonic sends.
import doc from '../../docs/ai-mnemonic.md?raw';
import { describe, expect, it } from 'vitest';
import { MNEMONIC_PROMPT_VERSION } from '../../supabase/functions/_shared/mnemonic-contracts';
import {
  MNEMONIC_RESPONSE_SCHEMA,
  MNEMONIC_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/mnemonic-prompt';

describe('docs/ai-mnemonic.md', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${MNEMONIC_PROMPT_VERSION}\``);
    expect(doc).toContain(MNEMONIC_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(MNEMONIC_RESPONSE_SCHEMA);
  });
});
