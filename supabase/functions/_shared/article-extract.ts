// HTML → plain article text for fetch-article (decision 0044): linkedom builds the DOM,
// Mozilla Readability finds the article (drops menus, ads, comments, footers), and this file
// turns the article element into plain paragraphs. No HTML ever leaves this module.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { MAX_ARTICLE_TEXT_CHARS, MIN_ARTICLE_WORDS } from './article-contract.ts';

/** On a page with paywall markup, fewer words than this is the teaser, not the article. */
export const PAYWALL_TEASER_WORDS = 250;

export interface ExtractedArticle {
  title: string;
  byline: string | null;
  site: string | null;
  lang: string | null;
  paragraphs: string[];
  truncated: boolean;
}

export type ExtractOutcome =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; reason: 'paywalled' | 'extract_failed'; detail: string };

/** Elements whose text is never article prose. */
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'MATH',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'VIDEO',
  'AUDIO',
  'PICTURE',
  'IMG',
  'FIGURE',
  'FIGCAPTION',
  'TABLE',
  'PRE',
  'BUTTON',
  'FORM',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'NAV',
  'ASIDE',
  'FOOTER',
  'SUP',
]);

/** Bits of page furniture Readability leaves inside the article (wiki edit links, share bars). */
const NOISE_CLASSES = [
  'mw-editsection',
  'editsection',
  'reference',
  'share-bar',
  'social-share',
  'sr-only',
  'visually-hidden',
];
const NOISE_CLASS = new RegExp(`(^|\\s)(${NOISE_CLASSES.join('|')})(\\s|$)`, 'i');

/** Elements that start a new paragraph. */
const BLOCK = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'BLOCKQUOTE',
  'HR',
  'BR',
  'ADDRESS',
  'DETAILS',
  'SUMMARY',
]);

interface DomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
  getAttribute?: (name: string) => string | null;
}

const clean = (s: string) =>
  s
    .replace(/\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff/g, '') // soft hyphen, zero-width
    .replace(/\s+/g, ' ')
    .trim();

/** Plain paragraphs of an element, in reading order. */
export function blockTexts(root: DomNode): string[] {
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    const t = clean(buf);
    if (t) out.push(t);
    buf = '';
  };
  const walk = (n: DomNode) => {
    if (n.nodeType === 3) {
      buf += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== 1) return;
    const name = n.nodeName.toUpperCase();
    if (SKIP.has(name)) return;
    if (n.getAttribute?.('hidden') !== null && n.getAttribute?.('hidden') !== undefined) return;
    if (n.getAttribute?.('aria-hidden') === 'true') return;
    if (NOISE_CLASS.test(n.getAttribute?.('class') ?? '')) return;
    const block = BLOCK.has(name);
    if (block) flush();
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i]!);
    if (block) flush();
    else if (name === 'TD' || name === 'TH') buf += ' ';
  };
  walk(root);
  flush();
  return out;
}

const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

/** schema.org `isAccessibleForFree: false` in the page's JSON-LD (Google's paywall markup). */
export function declaresPaywall(doc: {
  querySelectorAll(sel: string): ArrayLike<DomNode>;
}): boolean {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const raw = scripts[i]!.textContent ?? '';
    if (/"isAccessibleForFree"\s*:\s*(false|"false"|"False")/.test(raw)) return true;
  }
  return false;
}

/** Collapses repeats, drops the heading that repeats the title, caps the total length. */
/** "By Ana Lima" as the first paragraph: a byline Readability did not recognise. */
const BYLINE_RE = /^by\s+\p{Lu}[\p{L}.'’-]*(\s+\p{Lu}[\p{L}.'’-]*){0,3}$/iu;

function tidy(paragraphs: string[], title: string): { paragraphs: string[]; truncated: boolean } {
  const out: string[] = [];
  const titleKey = title.toLowerCase();
  let total = 0;
  let truncated = false;
  for (const p of paragraphs) {
    if (out.length === 0 && (p.toLowerCase() === titleKey || BYLINE_RE.test(p))) continue;
    if (out[out.length - 1] === p) continue;
    if (total + p.length > MAX_ARTICLE_TEXT_CHARS) {
      truncated = true;
      break;
    }
    out.push(p);
    total += p.length + 2;
  }
  return { paragraphs: out, truncated };
}

function bylineOf(found: string | null | undefined, blocks: string[]): string | null {
  const own = clean(found ?? '').replace(/^by\s+/i, '');
  if (own) return own.slice(0, 200);
  const first = blocks.find((b) => BYLINE_RE.test(b));
  return first ? first.replace(/^by\s+/i, '').slice(0, 200) : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function extractArticle(html: string, url: string): ExtractOutcome {
  // linkedom's document, typed as Readability expects it (Deno has no DOM lib types).
  const { document } = parseHTML(html) as unknown as {
    document: { documentElement: DomNode | null; querySelectorAll(s: string): ArrayLike<DomNode> };
  };
  const doc = document as unknown as ConstructorParameters<typeof Readability>[0];
  const lang = clean(document.documentElement?.getAttribute?.('lang') ?? '').toLowerCase() || null;
  const paywall = declaresPaywall(document);

  let parsed: ReturnType<Readability<DomNode>['parse']> = null;
  try {
    parsed = new Readability<DomNode>(doc, {
      serializer: (node) => node as unknown as DomNode,
      charThreshold: 400,
      // Readability strips class names; keep these so blockTexts can drop the elements.
      classesToPreserve: NOISE_CLASSES,
    }).parse();
  } catch (e) {
    return { ok: false, reason: 'extract_failed', detail: `readability: ${String(e)}` };
  }
  const content = parsed?.content;
  const blocks = content ? blockTexts(content) : [];
  const title = clean(parsed?.title ?? '') || hostOf(url) || '';
  const { paragraphs, truncated } = tidy(blocks, title);
  const n = paragraphs.reduce((s, p) => s + words(p), 0);

  // A page marked as paid that still shows a long text served it to everyone (metered or a
  // free article): keep it. A teaser is refused, and the wall is never worked around.
  if (paywall && n < PAYWALL_TEASER_WORDS)
    return { ok: false, reason: 'paywalled', detail: `paywall markup, ${n} words` };
  if (n < MIN_ARTICLE_WORDS) return { ok: false, reason: 'extract_failed', detail: `${n} words` };
  return {
    ok: true,
    article: {
      title: title.slice(0, 300),
      byline: bylineOf(parsed?.byline, blocks),
      site: clean(parsed?.siteName ?? '').slice(0, 120) || hostOf(url),
      lang,
      paragraphs,
      truncated,
    },
  };
}
