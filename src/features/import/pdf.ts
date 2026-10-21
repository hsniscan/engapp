// PDF → clean text. pdf.js parses in its own Web Worker (pdf.worker, bundled by Vite as a
// separate asset); only the page strings come back to the main thread. Cleanup (repeated
// headers/footers, hyphenation, line joins) is cleanPdfText from src/domain/chunking.ts.
import { cleanPdfText } from '@/domain/chunking';

export const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** reader_unavailable: pdf.js or its worker could not be downloaded (offline before first use). */
export type PdfErrorCode =
  'not_pdf' | 'too_big' | 'encrypted' | 'no_text' | 'reader_unavailable' | 'failed';

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string = code) {
    super(message);
    this.name = 'PdfError';
    this.code = code;
  }
}

export interface PdfText {
  pages: string[];
  pageCount: number;
  /** Cleaned text, ready for chunkText. */
  text: string;
}

/** Minimal shape of pdf.js text items used here. */
export interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/** Page text from pdf.js text items: items in reading order, hasEOL → line break. */
export function pageTextFromItems(items: readonly TextItemLike[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

/** Fewer letters than this in the whole document means a scanned (image-only) PDF. */
const MIN_LETTERS = 40;

export function hasReadableText(text: string): boolean {
  return (text.match(/\p{L}/gu)?.length ?? 0) >= MIN_LETTERS;
}

type PdfJs = typeof import('pdfjs-dist');

let loaded: Promise<{ pdfjs: PdfJs; workerUrl: string }> | null = null;

/** Loads pdf.js lazily (it is large) together with the URL of its module worker. */
function loadPdfJs() {
  loaded ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(
    ([pdfjs, w]) => ({ pdfjs, workerUrl: w.default }),
    (e: unknown) => {
      loaded = null; // try again next time (e.g. back online)
      throw new PdfError('reader_unavailable', e instanceof Error ? e.message : String(e));
    },
  );
  return loaded;
}

export interface ExtractOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Injected in tests (Node uses the legacy build). */
  pdfjs?: Pick<PdfJs, 'getDocument'>;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KB (some files have a few junk bytes first).
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/**
 * Extracts and cleans the text of a PDF.
 * @throws PdfError not_pdf | too_big | encrypted | no_text | failed
 */
export async function extractPdfText(
  data: ArrayBuffer | Uint8Array,
  opts: ExtractOptions = {},
): Promise<PdfText> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfError('too_big');
  if (!looksLikePdf(bytes)) throw new PdfError('not_pdf');
  // A fresh worker per document: parsing runs off the main thread, and it is terminated
  // afterwards so a large PDF does not keep memory alive.
  let port: Worker | null = null;
  let worker: InstanceType<PdfJs['PDFWorker']> | null = null;
  let getDocument: PdfJs['getDocument'];
  // The worker file is cached on first use, not precached (docs/decisions/0008): offline before
  // the first PDF it cannot load, and pdf.js would wait for it forever.
  let workerFailed: Promise<never> | null = null;
  if (opts.pdfjs) {
    getDocument = opts.pdfjs.getDocument;
  } else {
    const { pdfjs, workerUrl } = await loadPdfJs();
    port = new Worker(workerUrl, { type: 'module' });
    const p = port;
    workerFailed = new Promise<never>((_, reject) =>
      p.addEventListener('error', () => reject(new PdfError('reader_unavailable')), {
        once: true,
      }),
    );
    workerFailed.catch(() => {});
    worker = pdfjs.PDFWorker.create({ port });
    getDocument = pdfjs.getDocument;
  }
  // pdf.js transfers (detaches) the buffer it gets: give it a copy.
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    ...(worker ? { worker } : {}),
  });
  const release = async () => {
    // destroy() waits for the worker's answer: never longer than a moment (a worker that did
    // not load never answers).
    await Promise.race([task.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
    worker?.destroy();
    port?.terminate();
  };
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await (workerFailed ? Promise.race([task.promise, workerFailed]) : task.promise);
  } catch (e) {
    await release();
    if (e instanceof PdfError) throw e;
    const name = (e as { name?: string } | null)?.name;
    if (name === 'PasswordException') throw new PdfError('encrypted');
    if (name === 'InvalidPDFException') throw new PdfError('not_pdf');
    throw new PdfError('failed', e instanceof Error ? e.message : String(e));
  }
  try {
    const pages: string[] = [];
    opts.onProgress?.(0, doc.numPages);
    for (let i = 1; i <= doc.numPages; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageTextFromItems(content.items as TextItemLike[]));
      page.cleanup();
      opts.onProgress?.(i, doc.numPages);
    }
    const text = cleanPdfText(pages);
    if (!hasReadableText(text)) throw new PdfError('no_text');
    return { pages, pageCount: doc.numPages, text };
  } finally {
    await release();
  }
}
