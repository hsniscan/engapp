// docs/ai-pipeline.md must contain the exact prompts and schemas that the code sends.
import doc from '../../docs/ai-pipeline.md?raw';
import { describe, expect, it } from 'vitest';
import {
  ENRICH_PROMPT_VERSION,
  ENRICH_RESPONSE_SCHEMA,
  ENRICH_SYSTEM_PROMPT,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_RESPONSE_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/prompts';

describe('docs/ai-pipeline.md', () => {
  it('documents the current prompt versions, prompts and schemas verbatim', () => {
    expect(doc).toContain(`\`${EXTRACT_PROMPT_VERSION}\``);
    expect(doc).toContain(`\`${ENRICH_PROMPT_VERSION}\``);
    expect(doc).toContain(EXTRACT_SYSTEM_PROMPT);
    expect(doc).toContain(ENRICH_SYSTEM_PROMPT);
    // JSON blocks are compared parsed (formatting may differ).
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(EXTRACT_RESPONSE_SCHEMA);
    expect(jsonBlocks).toContainEqual(ENRICH_RESPONSE_SCHEMA);
  });
});
