// docs/ai-image.md must contain the exact prompts and schemas the picture pipeline sends.
import doc from '../../docs/ai-image.md?raw';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CHECK_PROMPT_VERSION,
  IMAGE_PROMPT_VERSION,
  VISUAL_PROMPT_VERSION,
} from '../../supabase/functions/_shared/image-contract';
import {
  IMAGE_CHECK_RESPONSE_SCHEMA,
  IMAGE_CHECK_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/image-check';
import {
  IMAGE_RESPONSE_SCHEMA,
  IMAGE_SYSTEM_PROMPT,
  REDRAW_PROBLEMS,
} from '../../supabase/functions/_shared/image-prompt';
import {
  VISUAL_RESPONSE_SCHEMA,
  VISUAL_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/visual-prompt';

const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => {
  try {
    return [JSON.parse(m[1]!) as unknown];
  } catch {
    return [];
  }
});

describe('docs/ai-image.md', () => {
  it('names the current prompt versions', () => {
    for (const v of [IMAGE_PROMPT_VERSION, VISUAL_PROMPT_VERSION, IMAGE_CHECK_PROMPT_VERSION]) {
      expect(doc).toContain(`\`${v}\``);
    }
  });

  it('shows every system prompt verbatim', () => {
    for (const p of [IMAGE_SYSTEM_PROMPT, VISUAL_SYSTEM_PROMPT, IMAGE_CHECK_SYSTEM_PROMPT]) {
      expect(doc).toContain(`\`\`\`text\n${p}\n\`\`\``);
    }
  });

  it('shows every response schema', () => {
    for (const s of [IMAGE_RESPONSE_SCHEMA, VISUAL_RESPONSE_SCHEMA, IMAGE_CHECK_RESPONSE_SCHEMA]) {
      expect(jsonBlocks).toContainEqual(s);
    }
  });

  it('lists every redraw sentence', () => {
    for (const [k, v] of Object.entries(REDRAW_PROBLEMS))
      expect(doc).toContain(`| \`${k}\` | ${v} |`);
  });
});
