// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfText, hasReadableText, pageTextFromItems, PdfError } from './pdf';

/** A minimal valid PDF: one page per entry, each line drawn with Helvetica. */
function makePdf(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) - 1 + 1; // 1-based object number
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const lines of pages) {
    const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
    const ops = lines
      .map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${esc(l)}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('pageTextFromItems', () => {
  it('joins items and turns hasEOL into line breaks', () => {
    expect(
      pageTextFromItems([
        { str: 'After years of ', hasEOL: false },
        { str: 'trying, she', hasEOL: true },
        { str: 'gave up.' },
        { hasEOL: false },
      ]),
    ).toBe('After years of trying, she\ngave up.');
  });
  it('detects scanned PDFs by the amount of letters', () => {
    expect(hasReadableText('  12 \n 3 ')).toBe(false);
    expect(hasReadableText('A real paragraph of English text has plenty of letters in it.')).toBe(
      true,
    );
  });
});

describe('extractPdfText (pdf.js legacy build in Node)', () => {
  it('extracts pages, drops repeated headers/footers and joins hyphenated lines', async () => {
    const bodies = [
      [
        'Farmers rely heavily on state subsidies.',
        'The committee was reluctant to approve the bud-',
        'get, but by and large the reforms were popular.',
        'Clean water is becoming scarce.',
      ],
      [
        'Many small towns struggle to cope with crowds.',
        'Some plants thrive in poor, sandy soil.',
        'Heavy snow continued to hinder rescue efforts.',
      ],
      [
        'The species is on the verge of extinction.',
        'Wages have failed to keep up with prices.',
        'The plan to raise parking fees backfired.',
      ],
    ];
    const bytes = makePdf(bodies.map((b, i) => ['Annual Report 2026', ...b, `Page ${i + 1}`]));
    const progress: number[] = [];
    const res = await extractPdfText(bytes, { pdfjs, onProgress: (d) => progress.push(d) });
    expect(res.pageCount).toBe(3);
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(res.text).not.toContain('Annual Report');
    expect(res.text).not.toMatch(/Page \d/);
    expect(res.text).toContain('approve the budget, but by and large');
  });

  it('reports a PDF without text as no_text', async () => {
    const bytes = makePdf([[], [], ['7']]);
    await expect(extractPdfText(bytes, { pdfjs })).rejects.toMatchObject({ code: 'no_text' });
  });

  it('rejects files that are not PDFs', async () => {
    await expect(
      extractPdfText(new TextEncoder().encode('hello'), { pdfjs }),
    ).rejects.toBeInstanceOf(PdfError);
    await expect(
      extractPdfText(new TextEncoder().encode('hello'), { pdfjs }),
    ).rejects.toMatchObject({ code: 'not_pdf' });
  });

  it('extracts a 20-page document quickly', async () => {
    const page = (n: number) =>
      Array.from(
        { length: 40 },
        (_, i) => `Line ${i} of page ${n}: the committee was reluctant to approve it.`,
      );
    const bytes = makePdf(Array.from({ length: 20 }, (_, i) => page(i + 1)));
    const t0 = performance.now();
    const res = await extractPdfText(bytes, { pdfjs });
    const ms = performance.now() - t0;
    console.info(`[pdf timing] 20 pages, ${res.text.length} chars in ${Math.round(ms)} ms`);
    expect(res.pageCount).toBe(20);
    expect(ms).toBeLessThan(10_000);
  });
});
