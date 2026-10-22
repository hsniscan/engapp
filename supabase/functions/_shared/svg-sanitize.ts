// Allowlist SVG sanitizer for v0.4 pictures (plan/v0.4-plan.md, Annex A.4). Contract only:
// the implementation lands with İP2. Used by the pipeline before a picture is stored and by
// the client before it is shown.
import type { SanitizeResult } from './image-contract.ts';

export function sanitizeSvg(_svg: string): SanitizeResult {
  throw new Error('sanitizeSvg: not implemented yet (v0.4 İP2)');
}
