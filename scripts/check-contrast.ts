/**
 * WCAG 2.2 contrast check for the colour tokens in src/ui/tokens/tokens.css, both themes.
 *   node scripts/check-contrast.ts          → table + exit 1 on failure
 *   node scripts/check-contrast.ts --md     → markdown table (pasted into docs/design.md)
 * text = 4.5:1 (AA normal text) · ui = 3:1 (non-text: focus ring, input borders, graphic bars).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/ui/tokens/tokens.css'),
  'utf8',
);
const tokens = new Map<string, { light: string; dark: string }>();
for (const m of css.matchAll(/--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)) {
  tokens.set(m[1]!, { light: m[2]!.toLowerCase(), dark: m[3]!.toLowerCase() });
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

type Kind = 'text' | 'ui';
const pairs: [fg: string, bg: string, kind: Kind, note: string][] = [
  ['fg', 'canvas', 'text', 'body text'],
  ['fg', 'surface', 'text', 'text on cards'],
  ['fg', 'surface-raised', 'text', 'text in dialogs/menus'],
  ['fg-muted', 'canvas', 'text', 'secondary text'],
  ['fg-muted', 'surface', 'text', 'secondary text on cards'],
  ['fg-muted', 'surface-sunken', 'text', 'badge / segmented control'],
  ['fg-subtle', 'canvas', 'text', 'placeholders, quiet sync status'],
  ['fg-subtle', 'surface', 'text', 'input placeholder'],
  ['fg-inverse', 'fg', 'text', 'toast, tooltip'],
  ['accent-fg', 'accent', 'text', 'primary button'],
  ['accent-fg', 'accent-hover', 'text', 'primary button hover'],
  ['accent-text', 'canvas', 'text', 'links'],
  ['accent-text', 'surface', 'text', 'links on cards'],
  ['accent-text', 'accent-soft', 'text', 'accent badge'],
  ['danger-fg', 'danger', 'text', 'danger button'],
  ['danger-fg', 'danger-hover', 'text', 'danger button hover'],
  ['danger-text', 'surface', 'text', 'field error'],
  ['danger-text', 'surface-raised', 'text', 'danger menu item'],
  ['danger-text', 'danger-soft', 'text', 'danger badge / highlighted item'],
  ['success-text', 'success-soft', 'text', 'success badge'],
  ['warn-text', 'warn-soft', 'text', 'warning badge'],
  ['rating-again-text', 'surface', 'text', 'Tekrar label'],
  ['rating-again-text', 'rating-again-soft', 'text', 'Tekrar label (hover)'],
  ['rating-hard-text', 'surface', 'text', 'Zor label'],
  ['rating-hard-text', 'rating-hard-soft', 'text', 'Zor label (hover)'],
  ['rating-good-text', 'surface', 'text', 'İyi label'],
  ['rating-good-text', 'rating-good-soft', 'text', 'İyi label (hover)'],
  ['rating-easy-text', 'surface', 'text', 'Kolay label'],
  ['rating-easy-text', 'rating-easy-soft', 'text', 'Kolay label (hover)'],
  ['fg-muted', 'rating-again-soft', 'text', 'interval on hovered button'],
  ['fg-muted', 'rating-easy-soft', 'text', 'interval on hovered button'],
  ['focus', 'canvas', 'ui', 'focus ring'],
  ['focus', 'surface', 'ui', 'focus ring on cards'],
  ['border-strong', 'surface', 'ui', 'input / checkbox border'],
  ['accent', 'surface-sunken', 'ui', 'progress fill, switch on'],
  ['rating-again', 'surface', 'ui', 'Tekrar hue bar'],
  ['rating-hard', 'surface', 'ui', 'Zor hue bar'],
  ['rating-good', 'surface', 'ui', 'İyi hue bar'],
  ['rating-easy', 'surface', 'ui', 'Kolay hue bar'],
  ['heat-completed', 'canvas', 'ui', 'heatmap: completed day'],
  ['heat-completed', 'heat-active', 'ui', 'heatmap: completed vs active'],
];

const md = process.argv.includes('--md');
let failures = 0;
const rows: string[] = [];
if (md) {
  rows.push('| Foreground | Background | Use | Need | Light | Dark |');
  rows.push('| --- | --- | --- | --- | --- | --- |');
}
for (const [f, b, kind, note] of pairs) {
  const ft = tokens.get(f);
  const bt = tokens.get(b);
  if (!ft || !bt) throw new Error(`Unknown token ${!ft ? f : b}`);
  const need = kind === 'text' ? 4.5 : 3;
  const l = ratio(ft.light, bt.light);
  const d = ratio(ft.dark, bt.dark);
  const ok = (r: number) => r >= need;
  if (!ok(l) || !ok(d)) failures++;
  const cell = (r: number) => `${r.toFixed(2)}${ok(r) ? '' : ' ✗'}`;
  rows.push(
    md
      ? `| \`${f}\` | \`${b}\` | ${note} | ${need}:1 | ${cell(l)} | ${cell(d)} |`
      : `${(f + ' / ' + b).padEnd(44)} ${String(need).padEnd(4)} light ${cell(l).padEnd(8)} dark ${cell(d)}`,
  );
}
console.log(rows.join('\n'));
if (failures) {
  console.error(`\n${failures} pair(s) below target`);
  process.exit(1);
}
