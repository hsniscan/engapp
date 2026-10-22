// ai-report pipeline (v0.3 İP7, docs/decisions/0027): 3–4 Turkish sentences about a weekly
// report whose numbers the device already computed.
//
//   request validation (numbers and fixed-list names only) -> daily limit -> one model call
//   -> per sentence: clean Turkish text, every number one of the request's -> response
//
// Privacy: the request cannot carry a word, a sentence or any other user text (every string
// in it is an enum value, report-contracts.ts). Nothing is stored: the device keeps the comment
// in the user's own weekly_reports row.
//
// The AI never produces a number: a sentence with a number that is not in the request is
// dropped (numbersMatch); the device runs the same check again before it stores the comment.

import { AiError } from './ai-provider.ts';
import { ApiError } from './errors.ts';
import { cleanExampleText, isCleanSentence } from './examples.ts';
import type { PipelineDeps } from './extract.ts';
import { isTurkishText } from './mnemonic.ts';
import {
  allowedNumbers,
  MAX_REPORT_SENTENCE_CHARS,
  MAX_REPORT_SENTENCES,
  MIN_REPORT_SENTENCES,
  numbersMatch,
  REPORT_PROMPT_VERSION,
  reportRequest,
  type ReportRequest,
  type ReportResponse,
  splitSentences,
} from './report-contracts.ts';
import {
  buildReportUserPrompt,
  REPORT_RESPONSE_SCHEMA,
  REPORT_SYSTEM_PROMPT,
  reportModelOutput,
} from './report-prompt.ts';

export const REPORT_MAX_OUTPUT_TOKENS = 1024;
export const REPORT_TIMEOUT_MS = 30_000;

export type ReportDropReason =
  'invalid_shape' | 'bad_text' | 'too_long' | 'not_turkish' | 'numbers' | 'duplicate' | 'extra';

const URL_RE = /(?:https?:\/\/|www\.)/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/**
 * The sentences that may be shown, in order (at most MAX_REPORT_SENTENCES). A model item may
 * hold two sentences; it is split first. Never throws: a bad sentence is dropped and counted.
 */
export function validateReportSentences(
  items: readonly unknown[],
  req: ReportRequest,
  onDrop: (reason: ReportDropReason) => void = () => {},
): string[] {
  const allowed = allowedNumbers(req);
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== 'string') {
      onDrop('invalid_shape');
      continue;
    }
    for (const part of splitSentences(raw)) {
      const s = cleanExampleText(part);
      if (!s || !isCleanSentence(s) || URL_RE.test(s) || EMOJI_RE.test(s) || /[\n#*]/.test(s)) {
        onDrop('bad_text');
        continue;
      }
      if (s.length > MAX_REPORT_SENTENCE_CHARS) {
        onDrop('too_long');
        continue;
      }
      if (!isTurkishText(s, '')) {
        onDrop('not_turkish');
        continue;
      }
      if (!numbersMatch(s, allowed)) {
        onDrop('numbers');
        continue;
      }
      if (out.some((o) => o.toLocaleLowerCase('tr') === s.toLocaleLowerCase('tr'))) {
        onDrop('duplicate');
        continue;
      }
      if (out.length >= MAX_REPORT_SENTENCES) {
        onDrop('extra');
        continue;
      }
      out.push(/[.!?…]$/.test(s) ? s : `${s}.`);
    }
  }
  return out;
}

export async function runReport(body: unknown, deps: PipelineDeps): Promise<ReportResponse> {
  const parsed = reportRequest.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'invalid_input',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  const req = parsed.data;

  const usage = await deps.store.consumeAi(deps.userId, deps.dailyLimit);
  if (!usage.allowed)
    throw new ApiError('daily_limit', `Daily AI limit reached (${usage.used}/${usage.limit}).`);

  let result;
  try {
    result = await deps.provider().generateJson({
      system: REPORT_SYSTEM_PROMPT,
      user: buildReportUserPrompt(req),
      schema: REPORT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      validate: (d) =>
        reportModelOutput.safeParse(d).success ? null : 'expected {sentences: [...]}',
      maxOutputTokens: REPORT_MAX_OUTPUT_TOKENS,
      timeoutMs: REPORT_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof AiError) throw new ApiError(e.code, e.message, e.retryAfterS);
    throw e;
  }

  const dropped: Record<string, number> = {};
  const sentences = validateReportSentences(
    reportModelOutput.parse(result.data).sentences,
    req,
    (reason) => {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
    },
  );
  deps.log?.('ai-report model call', {
    model: result.model,
    attempts: result.attempts,
    kept: sentences.length,
    dropped,
    usage: result.usage,
  });
  if (sentences.length < MIN_REPORT_SENTENCES)
    throw new ApiError('ai_failed', `Only ${sentences.length} usable sentences`);
  return {
    prompt_version: REPORT_PROMPT_VERSION,
    model: result.model,
    comment: sentences.join(' '),
    counts: { sentences: sentences.length, dropped },
    usage: { used: usage.used, limit: usage.limit },
  };
}
