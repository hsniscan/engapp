// WAV helpers for the tts function. Gemini TTS answers either a complete WAV file (the 3.8
// TTS models' default) or headerless 16-bit little-endian PCM ("audio/L16;codec=pcm;rate=24000",
// older models). Both end up as WAV, which every browser's <audio> plays. Web-standard APIs only.

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** Gemini's PCM: 24 kHz, mono, 16-bit. */
export const GEMINI_PCM: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 };

/** Wraps raw little-endian PCM in a 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Uint8Array, fmt: PcmFormat = GEMINI_PCM): Uint8Array {
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8;
  // A WAV holds whole sample frames; drop a trailing partial frame.
  const dataLen = pcm.length - (pcm.length % blockAlign);
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, fmt.channels, true);
  v.setUint32(24, fmt.sampleRate, true);
  v.setUint32(28, fmt.sampleRate * blockAlign, true); // byte rate
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, fmt.bitsPerSample, true);
  ascii(36, 'data');
  v.setUint32(40, dataLen, true);
  out.set(pcm.subarray(0, dataLen), 44);
  return out;
}

/** True when the bytes start with a RIFF/WAVE header. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
}

/** Sample rate from a mime type such as "audio/L16;codec=pcm;rate=24000"; null when absent. */
export function pcmRateFromMime(mime: string | undefined | null): number | null {
  const m = /(?:^|;)\s*rate=(\d{4,6})\b/i.exec(mime ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The provider's audio as a WAV file: passed through when it already is one, otherwise
 * treated as 16-bit mono PCM at the mime type's rate (default 24 kHz).
 */
export function toWav(bytes: Uint8Array, mime?: string | null): Uint8Array {
  if (isWav(bytes)) return bytes;
  return pcmToWav(bytes, {
    ...GEMINI_PCM,
    sampleRate: pcmRateFromMime(mime) ?? GEMINI_PCM.sampleRate,
  });
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}
