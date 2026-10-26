import type { ErrorCode } from './contracts.ts';

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  invalid_input: 400,
  daily_limit: 429,
  quota_exceeded: 503,
  ai_failed: 502,
  method_not_allowed: 405,
  internal: 500,
  blocked_url: 400,
  robots_disallowed: 422,
  not_html: 422,
  too_large: 422,
  fetch_failed: 502,
  paywalled: 422,
  extract_failed: 422,
};

/** An error that is sent to the client as {error: {code, message}}. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterS?: number;
  constructor(code: ErrorCode, message: string, retryAfterS?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.retryAfterS = retryAfterS;
  }
}
