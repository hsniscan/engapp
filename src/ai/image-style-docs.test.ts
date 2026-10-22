// docs/image-style.md must show the parts library and the palette exactly as the code has them.
import doc from '../../docs/image-style.md?raw';
import { describe, expect, it } from 'vitest';
import { IMAGE_PALETTE } from '../../supabase/functions/_shared/image-contract';
import { IMAGE_PARTS } from '../../supabase/functions/_shared/image-parts';
import { IMAGE_REFS } from '../../supabase/functions/_shared/image-refs';

describe('docs/image-style.md', () => {
  it('shows every part verbatim', () => {
    for (const p of IMAGE_PARTS) {
      expect(doc).toContain(`### ${p.name}`);
      expect(doc).toContain(`\`\`\`svg\n${p.svg}\n\`\`\``);
    }
  });

  it('lists every palette role with its light and dark value', () => {
    for (const [role, [light, dark]] of Object.entries(IMAGE_PALETTE)) {
      expect(doc).toMatch(new RegExp(`\\| ${role} +\\| \`${light}\` \\| \`${dark}\` \\|`));
    }
  });

  it('shows every reference', () => {
    for (const r of IMAGE_REFS) expect(doc).toContain(`image-style/refs/${r.slug}.svg`);
  });
});
