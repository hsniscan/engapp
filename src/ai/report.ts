// Client of the ai-report edge function (v0.3 İP7, docs/ai-report.md). Only the summary numbers,
// group names from fixed lists and the focus key are sent (domain/weeklyReport.ts
// toReportRequest); the request schema has no field a word or a text could go into.
import {
  keepMatchingSentences,
  REPORT_PROMPT_VERSION,
  reportRequest,
  reportResponse,
  type ReportRequest,
  type ReportResponse,
} from '../../supabase/functions/_shared/report-contracts';
import { type AiClientDeps, AiClientError, call } from './client';

export { REPORT_PROMPT_VERSION };
export type { ReportRequest, ReportResponse };

/**
 * The comment of one weekly report. The device checks the numbers once more: a sentence with
 * a number the app did not compute never reaches the screen.
 */
export async function requestReportComment(
  input: ReportRequest,
  deps: AiClientDeps = {},
): Promise<ReportResponse> {
  const body = reportRequest.parse(input);
  const res = await call('ai-report', body, (x) => reportResponse.parse(x), {
    timeoutMs: 60_000,
    ...deps,
  });
  const comment = keepMatchingSentences(res.comment, body);
  if (!comment)
    throw new AiClientError('bad_response', 'The comment has numbers the app did not compute');
  return { ...res, comment };
}
