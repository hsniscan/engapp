// Hand-written Claude responses for the picture pipeline tests (no live calls anywhere).
// Shapes follow the Messages API: thinking block (empty under the default display) + one text
// block with the structured-output JSON, stop_reason, usage.

import { IMAGE_REFS } from '../image-refs.ts';
import type { CalledMessage } from '../image-pipeline.ts';

const usage = (input: number, output: number, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
});

export function drawing(
  o: Partial<{ drawable: boolean; svg: string; alt_tr: string; confidence: number }> = {},
  model = 'claude-opus-5-5',
): CalledMessage {
  return {
    model,
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', text: undefined },
      {
        type: 'text',
        text: JSON.stringify({
          drawable: true,
          svg: IMAGE_REFS[5]!.svg,
          alt_tr: 'Yağmurda açık mavi bir şemsiye',
          confidence: 0.86,
          ...o,
        }),
      },
    ],
    usage: usage(120, 2400, 5200),
  };
}

export const DECLINED = drawing({ drawable: false, svg: '', alt_tr: '', confidence: 0 });

export const REFUSAL: CalledMessage = {
  model: 'claude-opus-5-5',
  stop_reason: 'refusal',
  content: [],
  usage: usage(120, 0, 5200),
};

/** A drawing with markup the sanitizer refuses. */
export const BAD_SVG = drawing({
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><script>alert(1)</script></svg>',
});

/** Valid SVG, but pale colours only: fails the contrast check. */
export const PALE = drawing({
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><circle cx="128" cy="128" r="114" fill="#e6edf5"/><circle cx="128" cy="128" r="60" fill="#ffffff"/></svg>',
});

export function verdict(
  o: Partial<{
    depicts_sense: boolean;
    has_text: boolean;
    clutter: boolean;
    confidence: number;
  }> = {},
): CalledMessage {
  return {
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          depicts_sense: true,
          has_text: false,
          clutter: false,
          confidence: 0.9,
          ...o,
        }),
      },
    ],
    usage: usage(900, 300),
  };
}
