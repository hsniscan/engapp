// Renders a sanitised picture SVG to PNG in the light and the dark theme (Node only), for the
// coverage check and the imagecheck-v2 vision call (decision 0030). @resvg/resvg-wasm is pure
// wasm: no native binaries, so it works on any runner. The edge runtime does not use this.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import {
  BACKDROP,
  findBackdrop,
  visibleCoverage,
} from '../../supabase/functions/_shared/image-check.ts';
import { IMAGE_PALETTE, svgForTheme } from '../../supabase/functions/_shared/image-contract.ts';
import type { Rendered } from '../../supabase/functions/_shared/image-pipeline.ts';

const require = createRequire(import.meta.url);
let ready: Promise<void> | null = null;

/** The card background behind the picture in each theme (for the PNG the checker sees). */
const PAPER = { light: IMAGE_PALETTE.paper[0], dark: IMAGE_PALETTE.paper[1] };

export async function loadRenderer(): Promise<(svg: string) => Rendered> {
  await (ready ??= initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
  return (svg) => ({ light: renderTheme(svg, 'light'), dark: renderTheme(svg, 'dark') });
}

function renderTheme(svg: string, theme: 'light' | 'dark') {
  const themed = svgForTheme(svg, theme);
  const fitTo = { mode: 'width' as const, value: 256 };
  const bare = new Resvg(themed, { fitTo }).render();
  const coverage = visibleCoverage(bare.pixels, bare.width, theme, findBackdrop(svg) ?? BACKDROP);
  const png = new Resvg(themed, { fitTo, background: PAPER[theme] }).render().asPng();
  return { png: Buffer.from(png).toString('base64'), coverage };
}
