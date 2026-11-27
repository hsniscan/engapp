import { describe, expect, it } from 'vitest';
import { decodeTextBytes, detectTextEncoding } from './textEncoding';

/** "İngilizce;Türkçe\ngelişmek;büyümek" as Turkish Excel saves it (Windows-1254). */
const CP1254: Record<string, number> = { İ: 0xdd, ü: 0xfc, ç: 0xe7, ş: 0xfe, ğ: 0xf0, ı: 0xfd };
function cp1254(s: string): Uint8Array {
  return Uint8Array.from([...s].map((ch) => CP1254[ch] ?? ch.charCodeAt(0)));
}
function utf16(s: string, order: 'le' | 'be', bom = true): Uint8Array {
  const out: number[] = bom ? (order === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(...(order === 'le' ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
  }
  return Uint8Array.from(out);
}
const utf8 = (s: string) => new TextEncoder().encode(s);

const SAMPLE = 'İngilizce;Türkçe\nthrive;gelişmek, büyümek\nshore;kıyı';

describe('detectTextEncoding / decodeTextBytes', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(detectTextEncoding(utf8(SAMPLE))).toBe('utf-8');
    expect(decodeTextBytes(utf8(SAMPLE))).toBe(SAMPLE);
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(SAMPLE)]);
    expect(decodeTextBytes(bom)).toBe(SAMPLE);
  });

  it('reads a Turkish Excel CSV (Windows-1254), not "geli�mek" or "Ýstanbul"', () => {
    expect(detectTextEncoding(cp1254(SAMPLE))).toBe('windows-1254');
    expect(decodeTextBytes(cp1254(SAMPLE))).toBe(SAMPLE);
    expect(decodeTextBytes(cp1254('1\n00:00:01,000 --> 00:00:02,000\nİstanbul'))).toContain(
      'İstanbul',
    );
  });

  it('reads UTF-16 with a byte-order mark, both byte orders', () => {
    expect(detectTextEncoding(utf16(SAMPLE, 'le'))).toBe('utf-16le');
    expect(decodeTextBytes(utf16(SAMPLE, 'le'))).toBe(SAMPLE);
    expect(detectTextEncoding(utf16(SAMPLE, 'be'))).toBe('utf-16be');
    expect(decodeTextBytes(utf16(SAMPLE, 'be'))).toBe(SAMPLE);
  });

  it('reads UTF-16 without a byte-order mark', () => {
    expect(decodeTextBytes(utf16(SAMPLE, 'le', false))).toBe(SAMPLE);
    expect(decodeTextBytes(utf16(SAMPLE, 'be', false))).toBe(SAMPLE);
  });

  it('plain ASCII and an empty file stay as they are', () => {
    expect(decodeTextBytes(utf8('bank;shore'))).toBe('bank;shore');
    expect(decodeTextBytes(new Uint8Array())).toBe('');
  });
});
