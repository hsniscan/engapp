// docs/ai-report.md must contain the exact prompt and schema that ai-report sends.
import doc from '../../docs/ai-report.md?raw';
import { describe, expect, it } from 'vitest';
import { REPORT_PROMPT_VERSION } from '../../supabase/functions/_shared/report-contracts';
import {
  REPORT_RESPONSE_SCHEMA,
  REPORT_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/report-prompt';

describe('docs/ai-report.md', () => {
  it('documents the current prompt version, prompt and schema verbatim', () => {
    expect(doc).toContain(`\`${REPORT_PROMPT_VERSION}\``);
    expect(doc).toContain(REPORT_SYSTEM_PROMPT);
    const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
      try {
        return [JSON.parse(m[1]!) as unknown];
      } catch {
        return [];
      }
    });
    expect(jsonBlocks).toContainEqual(REPORT_RESPONSE_SCHEMA);
  });
});
