// Allowlist SVG sanitizer for v0.4 pictures (plan/v0.4-plan.md, Annex A.4; decision 0030).
// Used by the pipeline before a picture is stored and by the client before it is shown
// (src/domain/svgSanitize.ts re-exports it). Pure string work: no DOM, no XML library, so it
// runs the same in Deno, Node and the browser.
//
// The input is tokenised by a small XML subset parser. Anything outside the subset is refused
// rather than repaired: DOCTYPE, entities (any `&`), CDATA, processing instructions (except a
// leading XML declaration), unknown elements (so <defs>, <filter> and every fe* element),
// unknown attributes, colours outside the palette, text content, and `url(` anywhere except in
// the one filter form below. Harmless metadata is dropped: comments, <title>/<desc> with their
// text, and the attributes xmlns (svg namespace only), version, role, aria-label, aria-hidden,
// id. The output is a normalised document: `<svg xmlns=… viewBox="0 0 256 256">` + children,
// every attribute value re-serialised from its parsed form, self-closing empty elements.
//
// Watercolour pictures (image-v2): g, path, circle, ellipse, rect, polygon and polyline may
// carry filter="url(#line)" or filter="url(#wash)", nothing else. The filters themselves are
// never taken from the input: the output gets the fixed IMAGE_WC_DEFS block right after the
// root start tag when (and only when) a filter is used. An input whose root starts with that
// exact block (a stored picture sanitised again by the client) has it removed before parsing,
// so sanitizeSvg(sanitizeSvg(x).svg) equals sanitizeSvg(x). Any other <defs> is refused.

import {
  IMAGE_ALLOWED_COLORS,
  IMAGE_MAX_BYTES,
  IMAGE_PALETTE,
  IMAGE_VIEWBOX,
  IMAGE_WC_DEFS,
  type SanitizeResult,
} from './image-contract.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that may appear (svg only as the root). */
const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
]);

/** Elements dropped together with their (text-only) content. */
const DROPPED_ELEMENTS = new Set(['title', 'desc']);

/** Attributes dropped without a trace (metadata that changes nothing in the picture). */
const DROPPED_ATTRS = new Set(['version', 'role', 'aria-label', 'aria-hidden', 'id']);

type Kind =
  | 'number'
  | 'length'
  | 'unit'
  | 'paint'
  | 'path'
  | 'points'
  | 'transform'
  | 'linecap'
  | 'linejoin'
  | 'fillrule'
  | 'filter'
  | 'viewbox';

/** Attribute allowlist (Annex A.4, plus fill-rule and stroke-opacity: decision 0030). */
const ATTRS: Record<string, Kind> = {
  viewBox: 'viewbox',
  d: 'path',
  points: 'points',
  cx: 'number',
  cy: 'number',
  r: 'length',
  rx: 'length',
  ry: 'length',
  x: 'number',
  y: 'number',
  x1: 'number',
  y1: 'number',
  x2: 'number',
  y2: 'number',
  width: 'length',
  height: 'length',
  fill: 'paint',
  stroke: 'paint',
  'stroke-width': 'length',
  'stroke-linecap': 'linecap',
  'stroke-linejoin': 'linejoin',
  transform: 'transform',
  opacity: 'unit',
  'fill-opacity': 'unit',
  'stroke-opacity': 'unit',
  'fill-rule': 'fillrule',
  filter: 'filter',
};

/** Painted shapes per element: which attributes it may carry besides the shared ones. */
const SHARED = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'transform',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'fill-rule',
]);
const OWN: Record<string, ReadonlySet<string>> = {
  svg: new Set(['viewBox', 'width', 'height']),
  g: new Set(['filter']),
  path: new Set(['d', 'filter']),
  circle: new Set(['cx', 'cy', 'r', 'filter']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry', 'filter']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'filter']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points', 'filter']),
  polygon: new Set(['points', 'filter']),
};

const MAX_ELEMENTS = 600;
const MAX_DEPTH = 12;
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const PATH = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/;
const TRANSFORM_FN = /^\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*,?/;
const NAME = /^[A-Za-z_][-A-Za-z0-9_.:]*/;
/** The only filter values: a reference to one of the two fixed IMAGE_WC_DEFS filters. */
const FILTER = /^\s*url\(\s*#(line|wash)\s*\)\s*$/;
/** A filter attribute in the raw input (the parser checks its value, as `value:filter`). */
const FILTER_ATTR = /\sfilter\s*=\s*(?:"[^"<>]*"|'[^'<>]*')/g;
/** A filter reference in the output: the only `url(` that may remain there. */
const FILTER_REF = /\sfilter="url\(#(?:line|wash)\)"/g;
/** The root start tag (after an optional XML declaration), to find a stored defs block. */
const ROOT_START = /^﻿?\s*(?:<\?xml\s[^<>?]*\?>)?\s*<svg\b[^<>]*>/;
const DEFAULT_FILL = IMAGE_PALETTE.ink[0];

interface Node {
  name: string;
  attrs: [string, string][];
  children: Node[];
}

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Shortest decimal form, at most 3 decimals ("8.000" → "8", "-0.5" → "-0.5"). */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function numbers(raw: string): number[] | null {
  const parts = raw.trim() === '' ? [] : raw.trim().split(/[\s,]+/);
  const out: number[] = [];
  for (const p of parts) {
    if (!NUM.test(p)) return null;
    const n = Number(p);
    if (!Number.isFinite(n) || Math.abs(n) > 1e6) return null;
    out.push(n);
  }
  return out;
}

function normPaint(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'none') return 'none';
  let hex = v;
  if (/^#[0-9a-f]{3}$/.test(v)) hex = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
  return IMAGE_ALLOWED_COLORS.has(hex) ? hex : null;
}

function normTransform(raw: string): string | null {
  let rest = raw;
  const out: string[] = [];
  while (rest.trim() !== '') {
    const m = TRANSFORM_FN.exec(rest);
    if (!m) return null;
    const args = numbers(m[2]!);
    if (!args) return null;
    const fn = m[1]!;
    const arity: Record<string, number[]> = {
      matrix: [6],
      translate: [1, 2],
      scale: [1, 2],
      rotate: [1, 3],
      skewX: [1],
      skewY: [1],
    };
    if (!arity[fn]!.includes(args.length)) return null;
    out.push(`${fn}(${args.map(fmt).join(' ')})`);
    rest = rest.slice(m[0].length);
  }
  return out.join(' ');
}

/** Normalised attribute value, or null when it is not allowed. */
function normValue(kind: Kind, raw: string): string | null {
  switch (kind) {
    case 'number': {
      const n = numbers(raw);
      return n && n.length === 1 ? fmt(n[0]!) : null;
    }
    case 'length': {
      const n = numbers(raw);
      return n && n.length === 1 && n[0]! >= 0 ? fmt(n[0]!) : null;
    }
    case 'unit': {
      const n = numbers(raw);
      return n && n.length === 1 && n[0]! >= 0 && n[0]! <= 1 ? fmt(n[0]!) : null;
    }
    case 'paint':
      return normPaint(raw);
    case 'path': {
      if (!PATH.test(raw) || !/^\s*[Mm]/.test(raw)) return null;
      return raw.trim().replace(/\s+/g, ' ');
    }
    case 'points': {
      const n = numbers(raw);
      return n && n.length >= 2 && n.length % 2 === 0 ? n.map(fmt).join(' ') : null;
    }
    case 'transform':
      return normTransform(raw);
    case 'linecap':
      return ['butt', 'round', 'square'].includes(raw.trim()) ? raw.trim() : null;
    case 'linejoin':
      return ['miter', 'round', 'bevel'].includes(raw.trim()) ? raw.trim() : null;
    case 'fillrule':
      return ['nonzero', 'evenodd'].includes(raw.trim()) ? raw.trim() : null;
    case 'filter': {
      const m = FILTER.exec(raw);
      return m ? `url(#${m[1]})` : null;
    }
    case 'viewbox': {
      const n = numbers(raw);
      return n && n.map(fmt).join(' ') === IMAGE_VIEWBOX ? IMAGE_VIEWBOX : null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tokeniser / parser (XML subset)
// ---------------------------------------------------------------------------

interface Parsed {
  root: Node;
}

function parse(src: string): Parsed | Fail {
  let i = 0;
  const n = src.length;
  const stack: Node[] = [];
  let root: Node | null = null;
  let rootClosed = false;
  let count = 0;
  /** Depth inside a dropped element (<title>, <desc>); its text is skipped. */
  let dropDepth = 0;

  // A leading XML declaration is the only processing instruction allowed.
  const decl = /^﻿?\s*<\?xml\s[^<>?]*\?>/.exec(src);
  if (decl) i = decl[0].length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    const text = src.slice(i, textEnd);
    if (text.trim() !== '' && dropDepth === 0) return fail('text');
    if (text.includes('>') && dropDepth === 0) return fail('parse');
    i = textEnd;
    if (i >= n) break;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) return fail('parse');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', i))
      return fail(/^<!doctype/i.test(src.slice(i, i + 9)) ? 'doctype' : 'markup_declaration');
    if (src.startsWith('<?', i)) return fail('processing_instruction');

    if (src.startsWith('</', i)) {
      const m = NAME.exec(src.slice(i + 2));
      if (!m) return fail('parse');
      const name = m[0];
      let j = i + 2 + name.length;
      while (j < n && /\s/.test(src[j]!)) j++;
      if (src[j] !== '>') return fail('parse');
      i = j + 1;
      if (dropDepth > 0) {
        if (DROPPED_ELEMENTS.has(name)) dropDepth--;
        else return fail('parse');
        continue;
      }
      const top = stack.pop();
      if (!top || top.name !== name) return fail('parse');
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    // Start tag.
    const m = NAME.exec(src.slice(i + 1));
    if (!m) return fail('parse');
    const name = m[0];
    let j = i + 1 + name.length;
    const attrs: [string, string][] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const ws = j;
      while (j < n && /\s/.test(src[j]!)) j++;
      if (j >= n) return fail('parse');
      if (src[j] === '>') {
        j++;
        break;
      }
      if (src.startsWith('/>', j)) {
        selfClosing = true;
        j += 2;
        break;
      }
      if (j === ws) return fail('parse'); // attributes must be separated by whitespace
      const am = NAME.exec(src.slice(j));
      if (!am) return fail('parse');
      const an = am[0];
      j += an.length;
      while (j < n && /\s/.test(src[j]!)) j++;
      if (src[j] !== '=') return fail('parse');
      j++;
      while (j < n && /\s/.test(src[j]!)) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") return fail('parse');
      const close = src.indexOf(q, j + 1);
      if (close === -1) return fail('parse');
      const value = src.slice(j + 1, close);
      if (value.includes('<')) return fail('parse');
      j = close + 1;
      if (seen.has(an)) return fail(`duplicate_attribute:${an}`);
      seen.add(an);
      attrs.push([an, value]);
    }
    i = j;

    if (dropDepth > 0 || DROPPED_ELEMENTS.has(name)) {
      if (!DROPPED_ELEMENTS.has(name)) return fail(`element:${name.toLowerCase()}`);
      if (stack.length === 0) return fail('parse');
      if (!selfClosing) dropDepth++;
      continue;
    }
    if (!ELEMENTS.has(name)) return fail(`element:${name.toLowerCase()}`);
    if (rootClosed) return fail('parse');
    if (name === 'svg' && stack.length > 0) return fail('element:nested_svg');
    if (name !== 'svg' && stack.length === 0) return fail('root');
    if (++count > MAX_ELEMENTS) return fail('too_many_elements');
    if (stack.length >= MAX_DEPTH) return fail('too_deep');
    const node: Node = { name, attrs, children: [] };
    if (stack.length === 0) root = node;
    else stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
    else if (stack.length === 0) rootClosed = true;
  }
  if (!root || stack.length > 0 || dropDepth > 0) return fail('parse');
  return { root };
}

// ---------------------------------------------------------------------------
// Validation + serialisation
// ---------------------------------------------------------------------------

function cleanAttrs(node: Node, isRoot: boolean): [string, string][] | Fail {
  const out: [string, string][] = [];
  for (const [name, raw] of node.attrs) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) return fail(`attribute:${lower}`);
    if (name === 'xmlns') {
      if (!isRoot || raw !== SVG_NS) return fail('attribute:xmlns');
      continue;
    }
    if (DROPPED_ATTRS.has(name)) continue;
    if (!(name in ATTRS)) return fail(`attribute:${lower}`);
    if (!SHARED.has(name) && !OWN[node.name]!.has(name)) return fail(`attribute:${lower}`);
    if (isRoot && (name === 'width' || name === 'height')) continue; // the viewBox decides
    const v = normValue(ATTRS[name]!, raw);
    if (v === null) {
      if (ATTRS[name] === 'paint') return fail(`color:${raw.trim().slice(0, 40)}`);
      if (ATTRS[name] === 'viewbox') return fail('viewbox');
      return fail(`value:${name}`);
    }
    out.push([name, v]);
  }
  return out;
}

function serialise(node: Node, isRoot: boolean): string | Fail {
  const attrs = cleanAttrs(node, isRoot);
  if (!Array.isArray(attrs)) return attrs;
  let head: string;
  if (isRoot) {
    if (!attrs.some(([k]) => k === 'viewBox')) return fail('viewbox');
    const rest = attrs.filter(([k]) => k !== 'viewBox');
    // Without a fill anywhere a shape paints black, which has no dark-theme twin: default to ink.
    if (!rest.some(([k]) => k === 'fill')) rest.unshift(['fill', DEFAULT_FILL]);
    head = `svg xmlns="${SVG_NS}" viewBox="${IMAGE_VIEWBOX}"${rest.map(([k, v]) => ` ${k}="${v}"`).join('')}`;
  } else {
    head = `${node.name}${attrs.map(([k, v]) => ` ${k}="${v}"`).join('')}`;
  }
  if (node.children.length === 0) return `<${head}/>`;
  let inner = '';
  for (const c of node.children) {
    const s = serialise(c, false);
    if (typeof s !== 'string') return s;
    inner += s;
  }
  return `<${head}>${inner}</${node.name}>`;
}

/**
 * Checks an SVG against the picture allowlist and returns it normalised, or the first reason
 * it was refused. Never throws.
 */
export function sanitizeSvg(svg: string): SanitizeResult {
  if (typeof svg !== 'string' || svg.trim() === '') return fail('empty');
  if (utf8Length(svg) > IMAGE_MAX_BYTES) return fail('too_large');
  if (svg.includes('&')) return fail('entity');
  // `url(` only inside a filter attribute, whose value the parser then checks strictly.
  if (/url\s*\(/i.test(svg.replace(FILTER_ATTR, ' '))) return fail('url');
  if (/<!\[CDATA\[/i.test(svg)) return fail('cdata');
  // A stored watercolour picture carries the fixed defs block: take it out (it is put back below).
  const start = ROOT_START.exec(svg)?.[0].length ?? -1;
  const src =
    start > 0 && svg.startsWith(IMAGE_WC_DEFS, start)
      ? svg.slice(0, start) + svg.slice(start + IMAGE_WC_DEFS.length)
      : svg;
  const parsed = parse(src);
  if ('ok' in parsed) return parsed;
  if (parsed.root.name !== 'svg') return fail('root');
  let out = serialise(parsed.root, true);
  if (typeof out !== 'string') return out;
  if (parsed.root.children.length === 0) return fail('empty');
  // Defence in depth: the only `url(` left is a reference to one of the fixed filters.
  const refs = out.match(FILTER_REF)?.length ?? 0;
  if (/url\s*\(/i.test(out.replace(FILTER_REF, ''))) return fail('url');
  if (refs > 0) {
    const end = out.indexOf('>') + 1;
    out = out.slice(0, end) + IMAGE_WC_DEFS + out.slice(end);
  }
  if (utf8Length(out) > IMAGE_MAX_BYTES) return fail('too_large');
  return { ok: true, svg: out };
}

/** Light hex colours used by a (sanitised) SVG, in first-use order. */
export function svgColors(svg: string): string[] {
  const seen = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)) seen.add(m[1]!);
  return [...seen];
}
