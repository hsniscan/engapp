/**
 * Tiny PDF writer for fixtures: one Helvetica text line per string (ASCII only), or a page
 * with a drawing and no text at all (what a scanned document looks like to pdf.js).
 */
function esc(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

function build(pageContents: string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number
  const catalog = add(''); // placeholder, filled below
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const content of pageContents) {
    const stream = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Each page: lines of text, top to bottom. */
export function textPdf(pages: string[][]): Buffer {
  return build(
    pages.map((lines) => {
      const ops = lines.map((l, i) => `BT /F1 11 Tf 56 ${780 - i * 16} Td (${esc(l)}) Tj ET`);
      return ops.join('\n');
    }),
  );
}

/** Pages with only graphics: no extractable text (like a scanned document). */
export function imageOnlyPdf(pageCount = 2): Buffer {
  return build(
    Array.from(
      { length: pageCount },
      () => '0.8 0.8 0.8 rg 56 400 480 300 re f 0 0 0 RG 56 400 480 300 re S',
    ),
  );
}
