// Text files the user brings in (a CSV word list, a subtitle file) come in whatever encoding
// their program saved them in. Turkish Excel saves "CSV (noktalı virgülle ayrılmış)" in
// Windows-1254, Notepad may save UTF-16, everything newer writes UTF-8. Pure: bytes in, text out.

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1254';

/**
 * Which encoding the bytes are in: a byte-order mark first (UTF-8, UTF-16 LE/BE), then UTF-16
 * without a mark (every other byte zero in mostly-ASCII text), then valid UTF-8, else
 * Windows-1254 (Turkish Windows; any byte sequence decodes, so it is the last resort).
 */
export function detectTextEncoding(bytes: Uint8Array): TextEncodingName {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const sample = bytes.subarray(0, 1024 - (Math.min(bytes.length, 1024) % 2));
  if (sample.length >= 4) {
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < sample.length; i += 2) {
      if (sample[i] === 0) evenZeros++;
      if (sample[i + 1] === 0) oddZeros++;
    }
    const pairs = sample.length / 2;
    if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return 'utf-16le';
    if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return 'utf-16be';
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1254';
  }
}

/** The bytes as text, in the encoding detectTextEncoding finds (a byte-order mark is dropped). */
export function decodeTextBytes(bytes: Uint8Array): string {
  return new TextDecoder(detectTextEncoding(bytes)).decode(bytes);
}
